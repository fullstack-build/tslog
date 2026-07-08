import { describe, expect, test, vi } from "vitest";
import { createBrowserEnvironment } from "../src/env/environment.browser.js";
import { createNodeEnvironment } from "../src/env/environment.node.js";
import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { parseReactNativeStackLine } from "../src/env/shared.js";
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
/* providerBase residual branches driven through the universal provider                                 */
/* -------------------------------------------------------------------------------------------------- */

describe("universal provider residual branches", () => {
  test("collectStyleTokens: a non-string/array/object style token (number) yields no CSS (final return [])", () => {
    withStubbedGlobals(() => {
      globalAny.window = {};
      globalAny.document = {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

      const env = createUniversalEnvironment();
      // A numeric style token is neither string, array, nor object → collectStyleTokens' final `return []` runs.
      const settings = prettySettings({
        pretty: { styles: { logLevelName: 42 as never } },
      });
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      const calls = captureConsoleLog(() => {
        env.transportFormatted(settings.pretty.template, ["numeric-style"], [], meta, settings);
      });
      expect(calls).toHaveLength(1);
      // No CSS resolved → a single console arg with no %c directives and no style arguments.
      expect(calls[0]).toHaveLength(1);
      expect(String(calls[0][0])).toContain("numeric-style");
      expect(String(calls[0][0])).not.toContain("%c");
    });
  });

  test("isBuffer returns false when Buffer.isBuffer is not a function", () => {
    withStubbedGlobals(() => {
      // Stub a Buffer global that lacks a callable isBuffer → the `typeof ... === "function"` guard in
      // the shared providerBase isBuffer is false → it returns `false` without calling it.
      vi.stubGlobal("Buffer", {} as never);
      const env = createUniversalEnvironment();
      expect(env.isBuffer(new Uint8Array([1, 2, 3]))).toBe(false);
      expect(env.isBuffer("not a buffer")).toBe(false);
    });
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* providerBase worker arm of the CSS gate, driven through the browser provider                         */
/* -------------------------------------------------------------------------------------------------- */

describe.runIf(isNode)("browser provider residual branches", () => {
  test("transportFormatted uses the CSS `%c` path on a WORKER runtime (usesBrowserStack worker arm)", () => {
    withStubbedGlobals(() => {
      // A worker runtime: importScripts is a function and Firefox-like UA → the `runtimeInfo.name ===
      // "worker"` sibling of providerBase's usesBrowserStack gate is true and
      // consoleSupportsCssStyling() returns true.
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
      // The CSS path is observable: %c directives in the format string with style args following.
      expect(String(calls[0][0])).toContain("%c");
      expect(calls[0].length).toBeGreaterThan(1);
    });
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* Node provider — formatWithOptionsSafe catch → stringifyFallback whose own JSON.stringify throws     */
/* -------------------------------------------------------------------------------------------------- */

describe.runIf(isNode)("node provider residual branches", () => {
  test("stringifyFallback falls back to String(value) when JSON.stringify also throws (BigInt after an inspect trap)", () => {
    // Native util.formatWithOptions invokes the throwing custom-inspect hook and propagates the error →
    // formatWithOptionsSafe's catch maps every arg through stringifyFallback. The hostile object then
    // makes JSON.stringify throw too (BigInt property) → stringifyFallback's catch returns String(value).
    const env = createNodeEnvironment();
    const settings = prettySettings();
    const hostile = {
      [Symbol.for("nodejs.util.inspect.custom")]() {
        throw new Error("inspect trap");
      },
      big: 1n,
    };
    const line = env.prettyFormatLine(["carrier", hostile], undefined, settings);
    // The string arg passes through the fallback untouched; the hostile object renders via String().
    expect(line).toContain("carrier");
    expect(line).toContain("[object Object]");
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
/* core/levels.ts — resolveLogLevelId returns undefined for a wholly unknown name                      */
/* -------------------------------------------------------------------------------------------------- */

describe("core/levels resolveLogLevelId residual branch", () => {
  test("an unknown level name resolves to undefined (not in customLevels or the name table)", async () => {
    const { resolveLogLevelId } = await import("../src/core/levels.js");
    expect(resolveLogLevelId("definitely-not-a-level")).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* core/settings.ts — UNKNOWN_SETTING report with no near-miss suggestion (nearestKey-miss else side)  */
/* -------------------------------------------------------------------------------------------------- */

describe("core/settings unknown-setting residual branch", () => {
  test("an unknown group key with no close match reports without a 'did you mean' suggestion", async () => {
    const { validateSettingsParam } = await import("../src/core/settings.js");
    const { TslogConfigError } = await import("../src/core/config.js");
    // A group key far from every known json key → nearestKey returns undefined → the message has no
    // "did you mean" clause and the suggestion is the "Remove ..." variant.
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
    // Default hidden type keeps the runner quiet; the record (and its clock-stamped _logMeta.date) is still captured.
    const { logger, logs } = createTestLogger<Record<string, unknown>>(undefined, { now: () => epoch });
    logger.info("timed");
    // A captured log is `LogObj & ILogObjMeta`; its _logMeta.date came from the injected clock.
    const meta = (logs[0] as Record<string, unknown>)._logMeta as { date?: Date };
    expect(meta.date instanceof Date).toBe(true);
    expect(meta.date?.getTime()).toBe(epoch);
  });

  test("createTestLogger's clock accepts a Date directly and uses it as-is (line 121 truthy side)", async () => {
    // options.now returning a Date exercises the `value instanceof Date ? value : ...` TRUE branch (line 121).
    const { createTestLogger } = await import("../src/subpaths/testing.js");
    const when = new Date("2021-03-04T05:06:07.000Z");
    const { logger, logs } = createTestLogger<Record<string, unknown>>(undefined, { now: () => when });
    logger.info("dated");
    const meta = (logs[0] as Record<string, unknown>)._logMeta as { date?: Date };
    expect(meta.date?.getTime()).toBe(when.getTime());
  });

  test("normalizeMeta leaves a non-string/number top-level time value on a parsed line untouched (line 225 guard)", async () => {
    // A JSON line whose top-level time key holds an object (not a string/number) must NOT be replaced:
    // normalizeRecord's `typeof value === "string" || typeof value === "number"` guard is false (line 225).
    const { normalizeMeta } = await import("../src/subpaths/testing.js");
    const line = JSON.stringify({ time: { nested: true }, message: "m" });
    const out = JSON.parse(normalizeMeta(line, { metaProperty: "_logMeta", timeKey: "time" })) as Record<string, unknown>;
    expect(out.time).toEqual({ nested: true });
    expect(out.message).toBe("m");
  });

  test("normalizeMeta DOES pin a string top-level time value on a parsed line (the truthy sibling)", async () => {
    const { normalizeMeta } = await import("../src/subpaths/testing.js");
    const line = JSON.stringify({ time: "2024-05-06T07:08:09.000Z", message: "m" });
    const out = JSON.parse(normalizeMeta(line, { metaProperty: "_logMeta", timeKey: "time" })) as Record<string, unknown>;
    expect(out.time).toBe("1970-01-01T00:00:00.000Z");
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* subpaths/pretty/box.ts — tree() leaf branches: anonymous function, symbol; and the array            */
/* depth-limit collapse ([…])                                                                          */
/* -------------------------------------------------------------------------------------------------- */

describe("subpaths/pretty/box tree residual branches", () => {
  test("formatLeaf renders a named function, an anonymous one (empty-name else side), and a symbol", async () => {
    const { tree } = await import("../src/subpaths/pretty/box.js");
    function named(): void {}
    // Force an empty `name` so formatLeaf's `value.name ? ... : ""` ternary takes its falsy side.
    const anon = Object.defineProperty(() => {}, "name", { value: "" });
    const out = tree({ named, anon, sym: Symbol("s") });
    expect(out).toContain("named: [Function: named]");
    expect(out).toContain("anon: [Function]");
    expect(out).toContain("sym: Symbol(s)");
  });

  test("a nested ARRAY past maxDepth collapses to […] (the array side of the collapse marker)", async () => {
    const { tree } = await import("../src/subpaths/pretty/box.js");
    const out = tree({ list: [1, 2] }, { maxDepth: 0 });
    expect(out).toContain("list […]");
  });
});
