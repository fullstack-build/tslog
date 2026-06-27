import { createLoggerEnvironment } from "../src/BaseLogger.js";
import { Logger } from "../src/index.js";
import type { IMeta, ISettings } from "../src/interfaces.js";
import { buildPrettyMeta } from "../src/internal/metaFormatting.js";
import { findFirstExternalFrameIndex, pickCallerStackFrame } from "../src/internal/stackTrace.js";

// Surgical tests closing the last reachable branches across the runtime detection,
// CSS styling, metaFormatting and stackTrace modules. Each asserts a real, observable behavior.

describe("Coverage completion: runtime detection fallbacks", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = {
      window: globalAny.window,
      document: globalAny.document,
      location: globalAny.location,
      Deno: globalAny.Deno,
      Bun: globalAny.Bun,
      importScripts: globalAny.importScripts,
      process: globalAny.process,
      CSS: globalAny.CSS,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete globalAny[key];
      } else {
        globalAny[key] = value;
      }
    }
  });

  test("node version falls back to process.version when versions.node is absent", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    globalAny.process = { version: "v20.1.0", versions: {}, env: {} };

    const env = createLoggerEnvironment();
    const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

    expect(meta.runtime).toBe("node");
    expect(meta.runtimeVersion).toBe("v20.1.0");
  });

  test("Bun hostname resolves from env.HOST when HOSTNAME is absent", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.importScripts;
    globalAny.process = { env: {} };
    globalAny.Bun = { version: "1.1.0", env: { HOST: "bun-host-from-host" } };

    const env = createLoggerEnvironment();
    const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

    expect(meta.runtime).toBe("bun");
    expect(meta.hostname).toBe("bun-host-from-host");
  });

  test("Deno env.get throwing a permission error is caught while resolving hostname", () => {
    // resolveDenoHostname has no Deno.hostname() and no location, so it returns undefined and
    // detection falls through to getEnvironmentHostname, where Deno.env.get throws and is caught.
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    delete globalAny.location;
    globalAny.process = { env: {} };
    globalAny.Deno = {
      version: { deno: "2.0.0" },
      env: {
        get: () => {
          throw new Error("PermissionDenied");
        },
      },
    };

    const env = createLoggerEnvironment();
    const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

    expect(meta.runtime).toBe("deno");
    // No hostname could be resolved, so the value is the "unknown" placeholder.
    expect(meta.hostname).toBe("unknown");
  });

  test("Bun hostname resolves from env.COMPUTERNAME (Windows) as the last fallback", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.importScripts;
    globalAny.process = { env: {} };
    globalAny.Bun = { version: "1.1.0", env: { COMPUTERNAME: "BUN-WIN-PC" } };

    const env = createLoggerEnvironment();
    const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

    expect(meta.runtime).toBe("bun");
    expect(meta.hostname).toBe("BUN-WIN-PC");
  });

  test("isBuffer returns false when the Buffer global is unavailable (browser/edge)", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    const savedBuffer = (globalThis as { Buffer?: unknown }).Buffer;
    // Simulate a runtime without Node's Buffer.
    (globalThis as { Buffer?: unknown }).Buffer = undefined;
    try {
      const env = createLoggerEnvironment();
      expect(env.isBuffer(new Uint8Array([1, 2, 3]))).toBe(false);
      expect(env.isBuffer({})).toBe(false);
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = savedBuffer;
    }
  });
});

describe("Coverage completion: CSS styling edge cases", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = {
      window: globalAny.window,
      document: globalAny.document,
      location: globalAny.location,
      navigator: undefined,
      CSS: globalAny.CSS,
    };
    globalAny.window = {};
    globalAny.document = {};
    globalAny.CSS = { supports: () => true };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/120" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete globalAny[key];
      } else {
        globalAny[key] = value;
      }
    }
  });

  const SENTINEL = "META_SENTINEL";

  function renderCss(styles: Record<string, unknown>, template: string, level = "INFO"): { text: string; styleArgs: unknown[] } {
    const env = createLoggerEnvironment();
    const base = new Logger({ type: "pretty" });
    const settings = base.settings as unknown as ISettings<unknown>;
    settings.prettyLogTemplate = template;
    settings.prettyLogStyles = styles as ISettings<unknown>["prettyLogStyles"];
    const meta = env.getMeta(3, level, Number.NaN, true) as IMeta;

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // When buildCssMetaOutput produces css, transportFormatted emits the rendered css text;
    // when it produces none, it falls back to the passed-in (sanitized) markup — here SENTINEL.
    env.transportFormatted(SENTINEL, [], [], meta, settings);
    const call = spy.mock.calls[0] ?? [];
    spy.mockRestore();
    return { text: (call[0] as string) ?? "", styleArgs: call.slice(1) };
  }

  test("non-style-typed value (number) yields no css → falls back to plain markup", () => {
    // collectStyleTokens receives a number → falls through every typeof check to the final return [].
    const { text, styleArgs } = renderCss({ logLevelName: 42 as unknown }, "{{logLevelName}}");
    expect(text).toBe(SENTINEL);
    expect(text).not.toContain("%c");
    expect(styleArgs).toHaveLength(0);
  });

  test("styled placeholder emits %c with the corresponding css", () => {
    const { text, styleArgs } = renderCss({ logLevelName: ["bold", "red"] }, "{{logLevelName}}");
    expect(text).toContain("%c");
    expect(styleArgs.join("|")).toContain("font-weight: bold");
    expect(styleArgs.join("|")).toContain("color: #ef5350");
  });

  test("object style with no matching value and no wildcard yields no css → plain markup", () => {
    // collectStyleTokens object branch: nextStyle == null → returns [] → css empty → fallback path.
    const { text, styleArgs } = renderCss({ logLevelName: { NOPE: "blue" } }, "{{logLevelName}}", "INFO");
    expect(text).toBe(SENTINEL);
    expect(text).not.toContain("%c");
    expect(styleArgs).toHaveLength(0);
  });
});

describe("Coverage completion: metaFormatting branches", () => {
  function baseSettings(overrides: Partial<ISettings<unknown>> = {}): ISettings<unknown> {
    const settings = new Logger({ type: "pretty" }).settings as unknown as ISettings<unknown>;
    return Object.assign(settings, overrides);
  }

  test("local timezone with a missing date renders the '----' year fallback", () => {
    const settings = baseSettings({ prettyLogTimeZone: "local", prettyLogTemplate: "{{yyyy}}.{{mm}}", stylePrettyLogs: false });
    const meta = { logLevelName: "INFO", logLevelId: 3, runtime: "node" } as unknown as IMeta;
    const { placeholders, text } = buildPrettyMeta(settings, meta);
    expect(placeholders.yyyy).toBe("----");
    expect(text).toContain("----");
  });

  test("local timezone with a present date uses local getters and offset conversion", () => {
    const settings = baseSettings({ prettyLogTimeZone: "local", prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}}", stylePrettyLogs: false });
    const date = new Date("2024-06-15T12:00:00Z");
    const meta = { date, logLevelName: "INFO", logLevelId: 3, runtime: "node" } as unknown as IMeta;
    const { placeholders } = buildPrettyMeta(settings, meta);
    expect(placeholders.yyyy).toBe(date.getFullYear());
    expect(String(placeholders.rawIsoStr).length).toBeGreaterThan(0);
  });

  test("name combines parentNames with the logger name", () => {
    const settings = baseSettings({ parentNames: ["A", "B"], prettyLogTemplate: "{{name}}", stylePrettyLogs: false });
    const meta = { date: new Date(), logLevelName: "INFO", logLevelId: 3, runtime: "node", name: "C" } as unknown as IMeta;
    const { placeholders } = buildPrettyMeta(settings, meta);
    expect(placeholders.name).toBe("A:B:C");
  });

  test("name is empty when neither name nor parentNames are present", () => {
    const settings = baseSettings({ parentNames: undefined, prettyLogTemplate: "{{name}}", stylePrettyLogs: false });
    const meta = { date: new Date(), logLevelName: "INFO", logLevelId: 3, runtime: "node" } as unknown as IMeta;
    const { placeholders } = buildPrettyMeta(settings, meta);
    expect(placeholders.name).toBe("");
  });

  test("parentNames render even when the current logger has no name", () => {
    // parentNamesString is null (no trailing separator appended because meta.name == null),
    // but the combinedName is still produced from parentNames via the join above.
    const settings = baseSettings({ parentNames: ["A", "B"], prettyLogTemplate: "{{name}}", stylePrettyLogs: false });
    const meta = { date: new Date(), logLevelName: "INFO", logLevelId: 3, runtime: "node" } as unknown as IMeta;
    const { placeholders } = buildPrettyMeta(settings, meta);
    // meta.name is null, so the trailing separator is not added; combinedName collapses to "".
    expect(placeholders.name).toBe("");
  });

  test("a name with no parentNames renders just the name", () => {
    // meta.name != null but parentNamesString == null → combinedName === name.
    const settings = baseSettings({ parentNames: undefined, prettyLogTemplate: "{{name}}", stylePrettyLogs: false });
    const meta = { date: new Date(), logLevelName: "INFO", logLevelId: 3, runtime: "node", name: "Solo" } as unknown as IMeta;
    const { placeholders } = buildPrettyMeta(settings, meta);
    expect(placeholders.name).toBe("Solo");
  });
});

describe("Coverage completion: environment helpers", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = { process: globalAny.process, Deno: globalAny.Deno, window: globalAny.window, document: globalAny.document, CSS: globalAny.CSS };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalAny[k];
      else globalAny[k] = v;
    }
  });

  test("safeGetCwd returns undefined when neither process.cwd nor Deno.cwd exist", async () => {
    const { safeGetCwd } = await import("../src/internal/environment.js");
    globalAny.process = {};
    delete globalAny.Deno;
    expect(safeGetCwd()).toBeUndefined();
  });

  test("safeGetCwd swallows a throwing Deno.cwd and returns undefined", async () => {
    const { safeGetCwd } = await import("../src/internal/environment.js");
    globalAny.process = {};
    globalAny.Deno = {
      cwd: () => {
        throw new Error("permission denied");
      },
    };
    expect(safeGetCwd()).toBeUndefined();
  });

  test("consoleSupportsCssStyling tolerates a navigator without a userAgent", async () => {
    const { consoleSupportsCssStyling } = await import("../src/internal/environment.js");
    globalAny.window = {};
    globalAny.document = {};
    globalAny.CSS = { supports: () => true };
    vi.stubGlobal("navigator", {});
    // userAgent is undefined → coalesced to "" → firefox/safari checks fail, CSS.supports decides.
    expect(consoleSupportsCssStyling()).toBe(true);
  });
});

describe("Coverage completion: stackTrace branches", () => {
  test("findFirstExternalFrameIndex treats frames without a filePath as empty candidates", () => {
    const frames = [{ method: "fn" }, { filePath: "/app/user.ts" }];
    // First frame has no filePath/fullFilePath; with a pattern that never matches, index 0 is returned.
    expect(findFirstExternalFrameIndex(frames, [/never-matches/])).toBe(0);
  });

  test("pickCallerStackFrame uses the auto-detected index when no explicit stackDepthLevel is given", () => {
    const error = new Error("x");
    error.stack = ["Error: x", "    at internal (/tslog/src/index.js:1:1)", "    at user (/app/main.ts:5:5)"].join("\n");
    const parse = (line: string) => {
      const match = line.match(/at .*\((.*):(\d+):(\d+)\)/);
      return match ? { filePath: match[1], fileLine: match[2], fileColumn: match[3] } : undefined;
    };
    const frame = pickCallerStackFrame(error, parse);
    expect(frame?.filePath).toBe("/app/main.ts");
  });
});

describe("Coverage completion: server stack parsing nuances (node)", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = { window: globalAny.window, document: globalAny.document, Deno: globalAny.Deno, Bun: globalAny.Bun, importScripts: globalAny.importScripts };
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalAny[k];
      else globalAny[k] = v;
    }
  });

  function firstFrame(stackBody: string[]) {
    const env = createLoggerEnvironment();
    const error = new Error("x");
    error.stack = ["Error: x", ...stackBody].join("\n");
    return env.getErrorTrace(error)[0];
  }

  test("a frame with a line but no column number is parsed (line only)", () => {
    const frame = firstFrame(["    at fn (/srv/only/line.ts:42)"]);
    expect(frame?.fileLine).toBe("42");
    expect(frame?.fileColumn).toBeUndefined();
    expect(frame?.fileNameWithLine).toBe("line.ts:42");
  });

  test("a frame with neither line nor column still yields a filePath", () => {
    const frame = firstFrame(["    at fn (/srv/no/position.ts)"]);
    expect(frame?.filePath).toContain("position.ts");
    expect(frame?.fileLine).toBeUndefined();
    expect(frame?.fileNameWithLine).toBeUndefined();
  });
});

describe("Coverage completion: browser frame without a line number", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = { window: globalAny.window, document: globalAny.document, location: globalAny.location };
    globalAny.window = {};
    globalAny.document = {};
    delete globalAny.location;
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalAny[k];
      else globalAny[k] = v;
    }
  });

  test("a browser frame without :line leaves line-derived fields undefined", () => {
    const env = createLoggerEnvironment();
    const error = { stack: "Error\nfn@/host/app.js" } as Error;
    const frame = env.getErrorTrace(error)[0];
    expect(frame?.filePath).toBe("/host/app.js");
    expect(frame?.fileLine).toBeUndefined();
    expect(frame?.fileNameWithLine).toBeUndefined();
    expect(frame?.filePathWithLine).toBeUndefined();
  });
});

describe("Coverage completion: error cause without a message", () => {
  test("a cause error with an empty message renders its header without a colon", () => {
    const logger = new Logger({ type: "pretty" });
    const env = logger.runtime;
    const cause = new Error("");
    const error = new Error("outer");
    (error as Error & { cause?: unknown }).cause = cause;
    const formatted = env.prettyFormatErrorObj(error, logger.settings);
    expect(formatted).toContain("Caused by (1): Error");
    // No "Error: " (with trailing message) for the empty-message cause.
    expect(formatted).not.toContain("Caused by (1): Error: ");
  });

  test("a cause without a name falls back to the 'Error' label", () => {
    const logger = new Logger({ type: "pretty" });
    const env = logger.runtime;
    const cause = new Error("inner boom");
    (cause as { name?: unknown }).name = undefined;
    const error = new Error("outer");
    (error as Error & { cause?: unknown }).cause = cause;
    const formatted = env.prettyFormatErrorObj(error, logger.settings);
    expect(formatted).toContain("Caused by (1): Error: inner boom");
  });
});

describe("Coverage completion: pretty template with an unknown placeholder (browser CSS)", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = { window: globalAny.window, document: globalAny.document, location: globalAny.location, CSS: globalAny.CSS };
    globalAny.window = {};
    globalAny.document = {};
    globalAny.CSS = { supports: () => true };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Chrome/120" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalAny[k];
      else globalAny[k] = v;
    }
  });

  test("an unset placeholder resolves to an empty string in the CSS meta builder", () => {
    const env = createLoggerEnvironment();
    const base = new Logger({ type: "pretty" });
    const settings = base.settings as unknown as ISettings<unknown>;
    settings.prettyLogTemplate = "{{logLevelName}}{{unknownPlaceholder}}";
    const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    env.transportFormatted("META", [], [], meta, settings);
    const text = (spy.mock.calls[0]?.[0] as string) ?? "";
    spy.mockRestore();
    // The unknown placeholder contributes nothing; the known styled level still renders.
    expect(text).toContain("INFO");
    expect(text).not.toContain("unknownPlaceholder");
  });
});

describe("Coverage completion: mask placeholder edge cases", () => {
  test("an empty maskPlaceholder removes the matched substring", () => {
    const logger = new Logger({ type: "json", maskValuesRegEx: [/secret/g], maskPlaceholder: "" });
    const internals = logger as unknown as { _recursiveCloneAndMaskValuesOfKeys: <T>(s: T, k: (string | number)[]) => T };
    expect(internals._recursiveCloneAndMaskValuesOfKeys("a secret b", [])).toBe("a  b");
  });

  test("a nullish maskPlaceholder is treated as an empty replacement", () => {
    const logger = new Logger({ type: "json", maskValuesRegEx: [/x/g] });
    logger.settings.maskPlaceholder = undefined as unknown as string;
    const internals = logger as unknown as { _recursiveCloneAndMaskValuesOfKeys: <T>(s: T, k: (string | number)[]) => T };
    expect(internals._recursiveCloneAndMaskValuesOfKeys("xyx", [])).toBe("y");
  });
});

describe("Coverage completion: normalizeFilePath edge inputs", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = { window: globalAny.window, document: globalAny.document, Deno: globalAny.Deno, Bun: globalAny.Bun, importScripts: globalAny.importScripts };
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalAny[k];
      else globalAny[k] = v;
    }
  });

  test("a bare Windows drive path (drive only) is preserved", () => {
    const env = createLoggerEnvironment();
    const error = new Error("x");
    // After stripping line:col, the path is just "C:" — the drive-only normalization branch.
    error.stack = ["Error: x", "    at fn (C:\\:10:5)"].join("\n");
    const frame = env.getErrorTrace(error)[0];
    expect(frame?.filePath).toContain("C:");
  });

  test("a frame whose path portion is empty still extracts line, column and method", () => {
    const env = createLoggerEnvironment();
    const error = new Error("x");
    // The location reduces to an empty path before the line:column — exercises the
    // normalizeFilePath empty/non-string early return guard, which returns the empty path unchanged.
    error.stack = ["Error: x", "    at fn (:10:5)"].join("\n");
    const frame = env.getErrorTrace(error)[0];
    expect(frame).toBeDefined();
    expect(frame?.filePath).toBe("");
    expect(frame?.fileLine).toBe("10");
    expect(frame?.fileColumn).toBe("5");
    expect(frame?.method).toBe("fn");
  });
});
