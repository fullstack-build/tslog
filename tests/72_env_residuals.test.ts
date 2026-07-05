import { afterEach, describe, expect, test, vi } from "vitest";
import { createBrowserEnvironment } from "../src/env/environment.browser.js";
import { createNodeEnvironment } from "../src/env/environment.node.js";
import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { parseReactNativeStackLine, stripAnsi } from "../src/env/shared.js";
import { findFirstExternalFrameIndex } from "../src/env/stackTrace.js";
import { Logger } from "../src/index.node.js";
import type { IMeta, ISettings, IStackFrame } from "../src/interfaces.js";

// Residual-branch coverage for the environment providers, the stackTrace helpers, and a handful of
// tiny unowned branches (levels/settings/testing/box/worker). Every test drives a real, observable path.

// Bun lacks some node: fd/worker tricks; gate the worker mock suite. The provider/parse tests below are
// runtime-agnostic (they stub globals) and safe everywhere.
const isNode = typeof process !== "undefined" && process.versions?.node != null && (process.versions as Record<string, string | undefined>).bun == null;

const globalAny = globalThis as Record<string, unknown>;

/** Save/restore the globals the runtime probe reads, then unstub Vitest stubs. */
function withStubbedGlobals(run: () => void): void {
  const saved: Record<string, unknown> = {
    window: globalAny.window,
    document: globalAny.document,
    location: globalAny.location,
    Deno: globalAny.Deno,
    Bun: globalAny.Bun,
    importScripts: globalAny.importScripts,
    process: globalAny.process,
    CSS: globalAny.CSS,
  };
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete globalAny[key];
      } else {
        globalAny[key] = value;
      }
    }
  }
}

/** A full, defaulted pretty settings object obtained from a real Logger. */
function prettySettings(overrides?: ConstructorParameters<typeof Logger>[0]): ISettings<Record<string, unknown>> {
  const logger = new Logger<Record<string, unknown>>({ type: "pretty", minLevel: "FATAL", ...overrides });
  return logger.settings as unknown as ISettings<Record<string, unknown>>;
}

/** Capture the arguments passed to console.log while `run` executes. */
function captureConsoleLog(run: () => void): unknown[][] {
  const calls: unknown[][] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    calls.push(args);
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return calls;
}

/* -------------------------------------------------------------------------------------------------- */
/* Universal provider — collectStyleTokens null/other branches, and prettyFormatLogObj error split    */
/* -------------------------------------------------------------------------------------------------- */

describe("universal provider residual branches", () => {
  test("collectStyleTokens: a nested object that resolves to null yields no CSS (styles.ts null branch)", () => {
    withStubbedGlobals(() => {
      // Browser + Firefox UA → CSS `%c` path runs, so buildCssMetaOutput → collectStyleTokens is reached.
      globalAny.window = {};
      globalAny.document = {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

      const env = createUniversalEnvironment();
      // A style object where neither the value-keyed entry NOR the "*" wildcard exists → nextStyle == null → [].
      const settings = prettySettings({
        pretty: { styles: { logLevelName: { NOPE: "red" } as never } },
      });
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      const calls = captureConsoleLog(() => {
        env.transportFormatted(settings.pretty.template, ["no-style"], [], meta, settings);
      });
      expect(calls).toHaveLength(1);
      // No style resolved for INFO → the placeholder is emitted as plain text (no %c wrapping around it).
      expect(String(calls[0][0])).toContain("no-style");
    });
  });

  test("collectStyleTokens: a non-string/array/object style token (number) yields no CSS (final return [])", () => {
    withStubbedGlobals(() => {
      globalAny.window = {};
      globalAny.document = {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

      const env = createUniversalEnvironment();
      // A numeric style token is neither string, array, nor object → collectStyleTokens returns [] (line 123).
      const settings = prettySettings({
        pretty: { styles: { logLevelName: 42 as never } },
      });
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      const calls = captureConsoleLog(() => {
        env.transportFormatted(settings.pretty.template, ["numeric-style"], [], meta, settings);
      });
      expect(calls).toHaveLength(1);
      expect(String(calls[0][0])).toContain("numeric-style");
    });
  });

  test("prettyFormatLogObj splits an Error out of the plain args and renders it (universal error push)", () => {
    // No global stubbing needed: prettyFormatLogObj is runtime-agnostic. Under the Node runner the
    // universal provider still routes an Error arg through prettyFormatErrorObj (line 241).
    const env = createUniversalEnvironment();
    const settings = prettySettings();
    const { args, errors } = env.prettyFormatLogObj(["keep", new Error("split-me")], settings);
    expect(args).toEqual(["keep"]);
    expect(errors).toHaveLength(1);
    expect(stripAnsi(errors[0])).toContain("split-me");
  });

  test("isBuffer returns false when Buffer.isBuffer is not a function (line 235 ternary else)", () => {
    withStubbedGlobals(() => {
      // Stub a Buffer global that lacks a callable isBuffer → the `typeof ... === "function"` guard is
      // false → the provider returns `false` without calling it (line 235 `: false`).
      vi.stubGlobal("Buffer", {} as never);
      const env = createUniversalEnvironment();
      expect(env.isBuffer(new Uint8Array([1, 2, 3]))).toBe(false);
      expect(env.isBuffer("not a buffer")).toBe(false);
    });
  });

  test("prettyFormatLine joins an Error and a plain arg with a newline, and style:false strips ANSI (lines 274-275)", () => {
    const env = createUniversalEnvironment();
    // Errors present AND args present → the `logErrors.length > 0 && logArgs.length > 0` guard is true →
    // the separator is "\n" (line 274). style:false → metaMarkupForText is the ANSI-stripped markup (line 275).
    const settings = prettySettings({ pretty: { style: false } });
    const meta = env.getMeta(5, "ERROR", Number.NaN, false) as IMeta;
    const line = env.prettyFormatLine(["plain-arg", new Error("boom-err")], meta, settings);
    expect(stripAnsi(line)).toContain("plain-arg");
    expect(stripAnsi(line)).toContain("boom-err");
    // No ANSI escapes when style is false.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence of ANSI escapes
    expect(/\[/.test(line)).toBe(false);
  });

  test("transportFormatted joins an Error and a plain arg with a newline on a server runtime (line 283)", () => {
    // Under the Node runner the universal provider detects a server runtime → the plain-text path in
    // transportFormatted runs; errors + args exercise the `"\n"` separator branch (line 283).
    const env = createUniversalEnvironment();
    const settings = prettySettings();
    const meta = env.getMeta(5, "ERROR", Number.NaN, false) as IMeta;
    const errorMarkup = env.prettyFormatErrorObj(new Error("dispatched-err"), settings);
    const calls = captureConsoleLog(() => {
      env.transportFormatted(settings.pretty.template, ["keep-arg"], [errorMarkup], meta, settings);
    });
    expect(calls).toHaveLength(1);
    const out = stripAnsi(String(calls[0][0]));
    expect(out).toContain("keep-arg");
    expect(out).toContain("dispatched-err");
  });

  test("buildCssMetaOutput renders an unknown template placeholder as empty text (line 159 else)", () => {
    withStubbedGlobals(() => {
      globalAny.window = {};
      globalAny.document = {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

      const env = createUniversalEnvironment();
      // A custom template with a placeholder that buildPrettyMeta never fills → placeholders[key] is
      // undefined → the CSS meta builder uses "" for it (line 159 `: ""`).
      const settings = prettySettings({ pretty: { template: "[{{logLevelName}}]{{unknownPlaceholder}} " } });
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      const calls = captureConsoleLog(() => {
        env.transportFormatted(settings.pretty.template, ["css-unknown"], [], meta, settings);
      });
      expect(calls).toHaveLength(1);
      expect(String(calls[0][0])).toContain("css-unknown");
    });
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* Browser provider — formatWithOptionsSafe catch → stringifyFallback                                  */
/* -------------------------------------------------------------------------------------------------- */

describe.runIf(isNode)("browser provider residual branches", () => {
  afterEach(() => {
    vi.resetModules();
  });

  test("formatWithOptionsSafe falls back to stringify when inspect throws (catch path, lines 302-304)", async () => {
    // resolveInspect() memoizes native-vs-polyfill the first time it runs. Earlier tests here stub
    // `window`, which would poison that memo toward the polyfill (which swallows a throwing
    // custom-inspect). Reset modules and import a FRESH browser env so resolveInspect re-probes under
    // the Node runner (no window) → native util.formatWithOptions, which DOES throw on a throwing
    // custom-inspect hook → the browser provider's catch → stringifyFallback runs.
    vi.resetModules();
    const { createBrowserEnvironment: freshCreate } = await import("../src/env/environment.browser.js");
    const env = freshCreate();
    const settings = prettySettings();
    const hostile = {
      [Symbol.for("nodejs.util.inspect.custom")]() {
        throw new Error("inspect trap");
      },
    };
    const line = env.prettyFormatLine(["carrier", { plain: 1 }, hostile], undefined, settings);
    // string passes through the fallback map; the JSON-able object serializes.
    expect(line).toContain("carrier");
    expect(line).toContain('"plain":1');
  });

  test("prettyFormatErrorObj renders a cause with NO message without a ': ' suffix (line 135 else)", () => {
    withStubbedGlobals(() => {
      // Browser globals so createBrowserEnvironment detects a browser runtime.
      globalAny.window = {};
      globalAny.document = {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

      const env = createBrowserEnvironment();
      const settings = prettySettings();
      // A cause whose message is "" → `causeMessage` is falsy → the header omits the ": <msg>" suffix (line 135).
      const cause = new Error("");
      cause.name = "NamedCause";
      const rendered = env.prettyFormatErrorObj(new Error("outer", { cause }), settings);
      expect(stripAnsi(rendered)).toContain("Caused by (1): NamedCause");
      // No trailing ": " with a message after the cause name.
      expect(stripAnsi(rendered)).not.toContain("NamedCause: ");
    });
  });

  test("transportFormatted uses the CSS `%c` path on a WORKER runtime (line 204 worker branch)", () => {
    withStubbedGlobals(() => {
      // A worker runtime: importScripts is a function and Firefox-like UA → shouldUseCss's
      // `runtimeInfo.name === "worker"` sibling is true and consoleSupportsCssStyling() returns true.
      vi.stubGlobal("importScripts", () => {});
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

      const env = createBrowserEnvironment();
      const settings = prettySettings();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;
      const calls = captureConsoleLog(() => {
        env.transportFormatted(settings.pretty.template, ["worker-css"], [], meta, settings);
      });
      expect(calls).toHaveLength(1);
      expect(String(calls[0][0])).toContain("worker-css");
    });
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* Node provider — the browser/worker CSS guard true branch (transportFormatted, line 141 branch)     */
/* -------------------------------------------------------------------------------------------------- */

describe.runIf(isNode)("node provider residual branches", () => {
  test("transportFormatted takes the CSS `%c` guard when the detected runtime looks like a browser", () => {
    withStubbedGlobals(() => {
      // Force the Node provider to detect a browser/worker console that supports CSS so the `useCss`
      // guard (browser/worker + consoleSupportsCssStyling) evaluates true — the branch is dead in
      // production (the Node provider only runs under Node) but the code path exists for parity.
      globalAny.window = {};
      globalAny.document = {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

      const env = createNodeEnvironment();
      const settings = prettySettings();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      const calls = captureConsoleLog(() => {
        env.transportFormatted(settings.pretty.template, ["css-guard"], [], meta, settings);
      });
      expect(calls).toHaveLength(1);
      // The CSS branch strips ANSI from the meta markup and logs the single formatted string.
      expect(String(calls[0][0])).toContain("css-guard");
    });
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* shared.ts — parseReactNativeStackLine JSC frame with an empty file name (line 486 undefined branch) */
/* -------------------------------------------------------------------------------------------------- */

describe("shared React Native JSC parser residual branch", () => {
  test("a JSC frame whose path ends with '/' has an empty file name and no fileNameWithLine", () => {
    // "fn@app/:10:5" is not a server-style frame, so it falls to the JSC regex. The path "app/" splits
    // to a trailing "" segment → fileName is "" (falsy) → fileNameWithLine is omitted (line 486 else).
    const frame = parseReactNativeStackLine("fn@app/:10:5", () => undefined);
    expect(frame).toBeDefined();
    expect(frame?.fileName).toBe("");
    expect(frame?.fileNameWithLine).toBeUndefined();
    expect(frame?.filePath).toBe("app/");
    expect(frame?.method).toBe("fn");
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* env/stackTrace.ts — findFirstExternalFrameIndex with a frame missing filePath (?? "" fallback)    */
/* -------------------------------------------------------------------------------------------------- */

describe("env/stackTrace findFirstExternalFrameIndex residual branch", () => {
  test("a frame with no filePath falls back to '' and is matched on fullFilePath only", () => {
    // frame.filePath is undefined → `frame.filePath ?? ""` takes the "" fallback. The pattern
    // matches the fullFilePath, so this internal frame is skipped and the next (external) frame wins.
    const frames: IStackFrame[] = [{ fullFilePath: "/node_modules/tslog/dist/x.js" }, { filePath: "/app/user.ts", fullFilePath: "/app/user.ts" }];
    const index = findFirstExternalFrameIndex(frames, [/node_modules[\\/].*tslog/i]);
    expect(index).toBe(1);
  });

  test("all frames internal (filePath undefined, fullFilePath matches) clamps to index 0", () => {
    const frames: IStackFrame[] = [{ fullFilePath: "/node_modules/tslog/dist/a.js" }, { fullFilePath: "/node_modules/tslog/dist/b.js" }];
    const index = findFirstExternalFrameIndex(frames, [/node_modules[\\/].*tslog/i]);
    expect(index).toBe(0);
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* core/levels.ts — resolveLogLevelId returns undefined for a wholly unknown name (line 58 : branch)   */
/* -------------------------------------------------------------------------------------------------- */

describe("core/levels resolveLogLevelId residual branch", () => {
  test("an unknown level name resolves to undefined (not in customLevels, table, or the enum)", async () => {
    const { resolveLogLevelId } = await import("../src/core/levels.js");
    expect(resolveLogLevelId("definitely-not-a-level")).toBeUndefined();
  });

  test("a known enum name still resolves via the enum fallback", async () => {
    const { resolveLogLevelId } = await import("../src/core/levels.js");
    expect(resolveLogLevelId("warn")).toBe(4);
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* core/settings.ts — UNKNOWN_SETTING report with no near-miss suggestion (lines 350-351 else branch)  */
/* -------------------------------------------------------------------------------------------------- */

describe("core/settings unknown-setting residual branch", () => {
  test("an unknown group key with no close match reports without a 'did you mean' suggestion", async () => {
    const { validateSettingsParam } = await import("../src/core/settings.js");
    const { TslogConfigError } = await import("../src/core/config.js");
    // A group key far from every known json key → nearestKey returns undefined → the message has no
    // "did you mean" clause and the suggestion is the "Remove ..." variant (lines 350-351 else sides).
    // strictConfig throws a typed error carrying message/suggestion, so we assert on the thrown value.
    let thrown: InstanceType<typeof TslogConfigError> | undefined;
    try {
      validateSettingsParam({
        strictConfig: true,
        // @ts-expect-error deliberately unknown group key with no near neighbor
        json: { zzzqqxxwww: true },
      });
    } catch (error) {
      thrown = error as InstanceType<typeof TslogConfigError>;
    }
    expect(thrown).toBeInstanceOf(TslogConfigError);
    expect(thrown?.code).toBe("UNKNOWN_SETTING");
    expect(thrown?.setting).toBe("json.zzzqqxxwww");
    expect(thrown?.message).not.toContain("did you mean");
    expect(thrown?.suggestion).toContain("Remove");
  });

  test("an unknown group key with a close match DOES suggest a rename (the truthy sibling branch)", async () => {
    const { validateSettingsParam } = await import("../src/core/settings.js");
    const { TslogConfigError } = await import("../src/core/config.js");
    // "messageKe" is one deletion from the real "messageKey" → nearestKey resolves → rename suggestion.
    let thrown: InstanceType<typeof TslogConfigError> | undefined;
    try {
      validateSettingsParam({
        strictConfig: true,
        // @ts-expect-error deliberate near-miss group key
        json: { messageKe: "m" },
      });
    } catch (error) {
      thrown = error as InstanceType<typeof TslogConfigError>;
    }
    expect(thrown?.message).toContain('did you mean "json.messageKey"');
    expect(thrown?.suggestion).toContain("Rename");
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* subpaths/testing.ts — normalizeRecord: top-level time value that is NOT a string/number (line 121)  */
/* and the non-string/number time value on a parsed line (line 225)                                    */
/* -------------------------------------------------------------------------------------------------- */

describe("subpaths/testing normalize residual branches", () => {
  test("createTestLogger's clock accepts a numeric epoch and coerces it to a Date (line 121 else)", async () => {
    // options.now returning a NUMBER (not a Date) exercises the `value instanceof Date ? value : new Date(value)`
    // false branch (line 121 in testing.ts).
    const { createTestLogger } = await import("../src/subpaths/testing.js");
    const epoch = Date.UTC(2020, 0, 1);
    // Default hidden type keeps the runner quiet; the record (and its clock-stamped _meta.date) is still captured.
    const { logger, logs } = createTestLogger<Record<string, unknown>>(undefined, { now: () => epoch });
    logger.info("timed");
    // A captured log is `LogObj & ILogObjMeta`; its _meta.date came from the injected clock.
    const meta = (logs[0] as Record<string, unknown>)._meta as { date?: Date };
    expect(meta.date instanceof Date).toBe(true);
    expect(meta.date?.getTime()).toBe(epoch);
  });

  test("createTestLogger's clock accepts a Date directly and uses it as-is (line 121 truthy side)", async () => {
    // options.now returning a Date exercises the `value instanceof Date ? value : ...` TRUE branch (line 121).
    const { createTestLogger } = await import("../src/subpaths/testing.js");
    const when = new Date("2021-03-04T05:06:07.000Z");
    const { logger, logs } = createTestLogger<Record<string, unknown>>(undefined, { now: () => when });
    logger.info("dated");
    const meta = (logs[0] as Record<string, unknown>)._meta as { date?: Date };
    expect(meta.date?.getTime()).toBe(when.getTime());
  });

  test("normalizeMeta leaves a non-string/number top-level time value on a parsed line untouched (line 225 guard)", async () => {
    // A JSON line whose top-level time key holds an object (not a string/number) must NOT be replaced:
    // normalizeRecord's `typeof value === "string" || typeof value === "number"` guard is false (line 225).
    const { normalizeMeta } = await import("../src/subpaths/testing.js");
    const line = JSON.stringify({ time: { nested: true }, message: "m" });
    const out = JSON.parse(normalizeMeta(line, { metaProperty: "_meta", timeKey: "time" })) as Record<string, unknown>;
    expect(out.time).toEqual({ nested: true });
    expect(out.message).toBe("m");
  });

  test("normalizeMeta DOES pin a string top-level time value on a parsed line (the truthy sibling)", async () => {
    const { normalizeMeta } = await import("../src/subpaths/testing.js");
    const line = JSON.stringify({ time: "2024-05-06T07:08:09.000Z", message: "m" });
    const out = JSON.parse(normalizeMeta(line, { metaProperty: "_meta", timeKey: "time" })) as Record<string, unknown>;
    expect(out.time).toBe("1970-01-01T00:00:00.000Z");
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* subpaths/pretty/box.ts — tree() leaf branches: anonymous function, symbol; renderTree non-container  */
/* early return; and the object depth-limit collapse ({…})                                              */
/* -------------------------------------------------------------------------------------------------- */

describe("subpaths/pretty/box tree residual branches", () => {
  test("formatLeaf renders a named function, an anonymous one (line 143 else), and a symbol (line 144)", async () => {
    const { tree } = await import("../src/subpaths/pretty/box.js");
    function named(): void {}
    // Force an empty `name` so the `value.name ? ... : ""` ternary takes its falsy side (line 143).
    const anon = Object.defineProperty(() => {}, "name", { value: "" });
    const out = tree({ named, anon, sym: Symbol("s") });
    expect(out).toContain("named: [Function: named]");
    expect(out).toContain("anon: [Function]");
    expect(out).toContain("sym: Symbol(s)");
  });

  test("tree(non-container) returns a single leaf; renderTree's non-container guard is a no-op", async () => {
    const { tree } = await import("../src/subpaths/pretty/box.js");
    // A top-level non-container renders as a leaf (never descends); renderTree is not entered.
    expect(tree(42)).toBe("42");
  });

  test("a nested OBJECT past maxDepth collapses to {…} (line 173 object side)", async () => {
    const { tree } = await import("../src/subpaths/pretty/box.js");
    // maxDepth 0: the nested object value is a container but depth is not < maxDepth, so it collapses.
    const out = tree({ outer: { inner: 1 } }, { maxDepth: 0 });
    expect(out).toContain("outer {…}");
    expect(out).not.toContain("inner");
  });

  test("a nested ARRAY past maxDepth collapses to […] (line 173 array side, for contrast)", async () => {
    const { tree } = await import("../src/subpaths/pretty/box.js");
    const out = tree({ list: [1, 2] }, { maxDepth: 0 });
    expect(out).toContain("list […]");
  });
});
