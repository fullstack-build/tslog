import { createBrowserEnvironment } from "../src/env/environment.browser.js";
import {
  createRuntimeMeta,
  detectRuntimeInfo,
  formatErrorMessage,
  formatStackFrames,
  getEnvironmentHostname,
  getPrettyLogMethod,
  isNativeError,
  isWorkerEnvironment,
  normalizeFilePath,
  parseBrowserStackLine,
  parseReactNativeStackLine,
  parseServerStackLine,
  type RuntimeInfo,
  resolveDenoHostname,
  resolveHermesVersion,
  stringifyFallback,
  stripAnsi,
} from "../src/env/shared.js";
import {
  buildStackTrace as envBuildStackTrace,
  clampIndex as envClampIndex,
  findFirstExternalFrameIndex as envFindFirstExternalFrameIndex,
  getDefaultIgnorePatterns as envGetDefaultIgnorePatterns,
  sanitizeStackLines as envSanitizeStackLines,
  splitStackLines as envSplitStackLines,
  toStackFrames as envToStackFrames,
} from "../src/env/stackTrace.js";
import { Logger } from "../src/index.js";
import type { IMeta, ISettings, IStackFrame } from "../src/interfaces.js";

// ------------------------------------------------------------------------------------------------
// Global-stubbing harness (identical to tests/31-35): navigator is a getter-only property in Node,
// so it must be driven by vi.stubGlobal / restored by vi.unstubAllGlobals.
// ------------------------------------------------------------------------------------------------
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

/** Make the current global scope look like a real DOM browser (no CSS.supports -> Chrome-ish UA). */
function makeBrowser(userAgent = "Mozilla/5.0 (Macintosh) Chrome/120.0"): void {
  globalAny.window = {};
  globalAny.document = {};
  delete globalAny.Deno;
  delete globalAny.Bun;
  delete globalAny.importScripts;
  vi.stubGlobal("navigator", { userAgent });
}

/** Make the current global scope look like a CSS-capable browser (Chrome with CSS.supports). */
function makeCssBrowser(): void {
  globalAny.window = {};
  globalAny.document = {};
  delete globalAny.Deno;
  delete globalAny.Bun;
  delete globalAny.importScripts;
  globalAny.CSS = { supports: () => true };
  vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Chrome/120.0" });
}

/** Make the current global scope look like a React Native runtime (navigator.product === "ReactNative"). */
function makeReactNative(): void {
  delete globalAny.window;
  delete globalAny.document;
  delete globalAny.Deno;
  delete globalAny.Bun;
  delete globalAny.importScripts;
  vi.stubGlobal("navigator", { product: "ReactNative", userAgent: "Hermes" });
}

/**
 * Make the browser entry select the SERVER stack parser: neither browser/worker nor React Native,
 * but a process global is present. This is the branch a bundler hits when it forces the browser
 * condition on a Node-ish target.
 */
function makeServerFlavoredBrowserEntry(): void {
  delete globalAny.window;
  delete globalAny.document;
  delete globalAny.Deno;
  delete globalAny.Bun;
  delete globalAny.importScripts;
  vi.stubGlobal("navigator", undefined);
  globalAny.process = { env: {}, versions: { node: "20.0.0" }, cwd: () => "/repo/root" };
}

/** Real pretty-logger settings, with per-test overrides merged into the `pretty` group. */
function prettySettings(prettyOverrides: Partial<ISettings<unknown>["pretty"]> = {}): ISettings<unknown> {
  const settings = new Logger({ type: "pretty" }).settings as ISettings<unknown>;
  return { ...settings, pretty: { ...settings.pretty, ...prettyOverrides } };
}

// ================================================================================================
// src/env/shared.ts — pure helpers driven directly with synthetic inputs
// ================================================================================================
describe("shared.ts stack-line parsers", () => {
  const noCwd = () => undefined;

  describe("parseServerStackLine", () => {
    test("returns undefined for a non-string / empty / non-frame line", () => {
      expect(parseServerStackLine(undefined, noCwd)).toBeUndefined();
      expect(parseServerStackLine("", noCwd)).toBeUndefined();
      // No " at " and does not start with "at " -> not a stack frame.
      expect(parseServerStackLine("just some text", noCwd)).toBeUndefined();
    });

    test("parses a method+location frame and splits line:col", () => {
      const frame = parseServerStackLine("    at doWork (/srv/app/handler.ts:12:34)", noCwd) as IStackFrame;
      expect(frame.method).toBe("doWork");
      expect(frame.filePath).toBe("/srv/app/handler.ts");
      expect(frame.fileLine).toBe("12");
      expect(frame.fileColumn).toBe("34");
      expect(frame.fileName).toBe("handler.ts");
      expect(frame.fileNameWithLine).toBe("handler.ts:12");
      expect(frame.filePathWithLine).toBe("/srv/app/handler.ts:12");
    });

    test("parses a location-only frame (single trailing :line, no column)", () => {
      // Exactly two segments where the last is numeric -> only fileLine is popped, no column.
      const frame = parseServerStackLine("at /srv/main.js:99", noCwd) as IStackFrame;
      expect(frame.method).toBeUndefined();
      expect(frame.fileLine).toBe("99");
      expect(frame.fileColumn).toBeUndefined();
      expect(frame.fileName).toBe("main.js");
    });

    test("strips the Hermes 'address at' prefix and a query string, popping position before the query", () => {
      const frame = parseServerStackLine("at fn (address at /bundles/index.android.bundle?platform=android:1:1234)", noCwd) as IStackFrame;
      expect(frame.fileLine).toBe("1");
      expect(frame.fileColumn).toBe("1234");
      // Query removed, "address at" prefix gone.
      expect(frame.filePath).toBe("/bundles/index.android.bundle");
      expect(frame.filePath).not.toContain("address at");
      expect(frame.filePath).not.toContain("?");
    });

    test("strips a leading cwd from the path and drops the separator", () => {
      const frame = parseServerStackLine("at fn (/repo/root/src/x.ts:5:6)", () => "/repo/root") as IStackFrame;
      // cwd + separator removed -> relative path.
      expect(frame.filePath).toBe("src/x.ts");
      expect(frame.fileLine).toBe("5");
    });

    test("keeps the original candidate when cwd stripping empties the path", () => {
      // path === cwd exactly -> after slicing, normalizedPath is "" -> falls back to filePathCandidate.
      const frame = parseServerStackLine("at fn (/repo/root:7:2)", () => "/repo/root") as IStackFrame;
      expect(frame.filePath).toBe("/repo/root");
      expect(frame.fileLine).toBe("7");
    });
  });

  describe("parseBrowserStackLine", () => {
    test("returns undefined when the line has no parseable path", () => {
      expect(parseBrowserStackLine("no path here at all")).toBeUndefined();
    });

    test("parses a Safari 'global code@' frame; method is always undefined", () => {
      const frame = parseBrowserStackLine("global code@https://host.example/assets/app.js:5:1") as IStackFrame;
      expect(frame.fileName).toBe("app.js");
      expect(frame.fileLine).toBe("5");
      expect(frame.fileColumn).toBe("1");
      expect(frame.method).toBeUndefined();
      // No location.origin stubbed -> fullFilePath equals the captured path.
      expect(frame.fullFilePath).toBe(frame.filePath);
    });

    test("prepends location.origin to fullFilePath when present", () => {
      globalAny.location = { origin: "https://cdn.example" };
      const frame = parseBrowserStackLine("fn@https://cdn.example/a/b/c.js:2:3") as IStackFrame;
      expect(frame.filePath).toBe("/cdn.example/a/b/c.js");
      expect(frame.fullFilePath).toBe("https://cdn.example/cdn.example/a/b/c.js");
    });

    test("drops a query string from the captured file path", () => {
      const frame = parseBrowserStackLine("fn@https://host.dev/a/bundle.js?v=9:4:2") as IStackFrame;
      expect(frame.filePath).toBe("/host.dev/a/bundle.js");
      expect(frame.filePath).not.toContain("?");
      expect(frame.fileLine).toBe("4");
    });
  });

  describe("parseReactNativeStackLine", () => {
    const noCwd = () => undefined;

    test("returns undefined for a non-string / empty line", () => {
      expect(parseReactNativeStackLine(undefined, noCwd)).toBeUndefined();
      expect(parseReactNativeStackLine("", noCwd)).toBeUndefined();
    });

    test("delegates a V8-style Hermes frame to the server parser", () => {
      const frame = parseReactNativeStackLine("    at render (/app/index.js:3:9)", noCwd) as IStackFrame;
      expect(frame.method).toBe("render");
      expect(frame.filePath).toBe("/app/index.js");
      expect(frame.fileLine).toBe("3");
    });

    test("parses a JSC 'fn@bareBundle:line:col' frame the server parser rejects", () => {
      // "main.jsbundle" is a single-segment path -> parseServerStackLine returns undefined (no " at "),
      // so the dedicated JSC regex handles it.
      const frame = parseReactNativeStackLine("dispatch@main.jsbundle:100:20", noCwd) as IStackFrame;
      expect(frame.method).toBe("dispatch");
      expect(frame.filePath).toBe("main.jsbundle");
      expect(frame.fileName).toBe("main.jsbundle");
      expect(frame.fileLine).toBe("100");
      expect(frame.fileColumn).toBe("20");
      expect(frame.filePathWithLine).toBe("main.jsbundle:100");
    });

    test("JSC frame with no method name leaves method undefined", () => {
      const frame = parseReactNativeStackLine("@app.bundle:1:2", noCwd) as IStackFrame;
      expect(frame.method).toBeUndefined();
      expect(frame.filePath).toBe("app.bundle");
      expect(frame.fileLine).toBe("1");
    });

    test("JSC frame whose location is a native-code marker is skipped, falling back to the browser parser", () => {
      // "[native code]" contains "[native" -> the JSC branch bails; the browser parser then finds
      // no valid 2-segment path either, so the whole line yields undefined.
      expect(parseReactNativeStackLine("foo@[native code]:0:0", noCwd)).toBeUndefined();
    });

    test("falls through to the browser parser for a multi-segment URL frame", () => {
      const frame = parseReactNativeStackLine("bar@http://localhost:8081/index.bundle:117:42", noCwd) as IStackFrame;
      expect(frame).toBeDefined();
      expect(frame.fileLine).toBe("117");
    });
  });
});

describe("shared.ts runtime detection", () => {
  test("detectRuntimeInfo reports a browser with its user agent when window+document exist", () => {
    makeBrowser("MyUA/1.0");
    const info = detectRuntimeInfo();
    expect(info.name).toBe("browser");
    expect(info.userAgent).toBe("MyUA/1.0");
  });

  test("detectRuntimeInfo reports react-native when navigator.product === 'ReactNative'", () => {
    makeReactNative();
    const info = detectRuntimeInfo();
    expect(info.name).toBe("react-native");
  });

  test("detectRuntimeInfo reports a worker (importScripts function) with its user agent", () => {
    delete globalAny.window;
    delete globalAny.document;
    globalAny.importScripts = function importScripts() {};
    vi.stubGlobal("navigator", { userAgent: "WorkerUA" });
    const info = detectRuntimeInfo();
    expect(info.name).toBe("worker");
    expect(info.userAgent).toBe("WorkerUA");
  });

  test("resolveHermesVersion returns hermes/<v> when HermesInternal exposes an OSS release version", () => {
    vi.stubGlobal("HermesInternal", {
      getRuntimeProperties: () => ({ "OSS Release Version": "0.12.0" }),
    });
    expect(resolveHermesVersion()).toBe("hermes/0.12.0");
  });

  test("resolveHermesVersion returns undefined when the version is missing or the accessor throws", () => {
    vi.stubGlobal("HermesInternal", { getRuntimeProperties: () => ({}) });
    expect(resolveHermesVersion()).toBeUndefined();

    vi.stubGlobal("HermesInternal", {
      getRuntimeProperties: () => {
        throw new Error("no runtime props");
      },
    });
    expect(resolveHermesVersion()).toBeUndefined();
  });

  test("createRuntimeMeta emits a runtimeVersion for a Hermes react-native and omits it on JSC", () => {
    const withVersion: RuntimeInfo = { name: "react-native", version: "hermes/1.2.3" };
    expect(createRuntimeMeta(withVersion)).toEqual({ runtime: "react-native", runtimeVersion: "hermes/1.2.3" });

    const withoutVersion: RuntimeInfo = { name: "react-native" };
    expect(createRuntimeMeta(withoutVersion)).toEqual({ runtime: "react-native" });
  });

  test("resolveDenoHostname returns the hostname and swallows a throwing Deno.hostname()", () => {
    expect(resolveDenoHostname({ hostname: () => "deno-box" })).toBe("deno-box");

    delete globalAny.location;
    expect(
      resolveDenoHostname({
        hostname: () => {
          throw new Error("denied");
        },
      }),
    ).toBeUndefined();
  });

  test("resolveDenoHostname falls back to location.hostname when Deno has no hostname()", () => {
    globalAny.location = { hostname: "loc-host" };
    expect(resolveDenoHostname({})).toBe("loc-host");
  });
});

describe("shared.ts error / value formatting", () => {
  test("stringifyFallback passes strings through and JSON-stringifies other values", () => {
    expect(stringifyFallback("plain")).toBe("plain");
    expect(stringifyFallback({ a: 1 })).toBe('{"a":1}');
    expect(stringifyFallback(42)).toBe("42");
  });

  test("formatErrorMessage joins own enumerable non-function props, skipping stack/cause and functions", () => {
    const error = new Error("boom") as Error & { code?: string; run?: () => void };
    error.code = "E_BAD";
    error.run = () => undefined; // function -> skipped
    const message = formatErrorMessage(error);
    expect(message).toContain("boom");
    expect(message).toContain("E_BAD");
    expect(message).not.toContain("=>");
  });

  test("formatErrorMessage skips a property whose getter throws without crashing", () => {
    const error = new Error("outer");
    Object.defineProperty(error, "hostile", {
      enumerable: true,
      get() {
        throw new Error("cannot read");
      },
    });
    // The throwing getter is caught and skipped; the safe message survives.
    expect(() => formatErrorMessage(error)).not.toThrow();
    expect(formatErrorMessage(error)).toContain("outer");
  });

  test("formatStackFrames renders each frame through the pretty errorStackTemplate", () => {
    const settings = prettySettings();
    const frames: IStackFrame[] = [{ fileName: "a.ts", fileLine: "10", method: "run", filePathWithLine: "/a.ts:10" }];
    const rendered = formatStackFrames(frames, settings);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain("a.ts");
  });

  test("stripAnsi removes SGR escape sequences", () => {
    expect(stripAnsi("[31mred[39m")).toBe("red");
    expect(stripAnsi("plain")).toBe("plain");
  });

  test("isNativeError matches instances, cross-realm tags and *Error names; rejects the rest", () => {
    expect(isNativeError(new Error("x"))).toBe(true);
    expect(isNativeError({ name: "ValidationError" })).toBe(true);
    const tagged = {
      get [Symbol.toStringTag]() {
        return "DOMException";
      },
    };
    // toString tag is "[object DOMException]" -> does NOT match "[object ...Error]", and name is absent.
    expect(isNativeError(tagged)).toBe(false);
    expect(isNativeError({ name: "Warning" })).toBe(false);
    expect(isNativeError("nope")).toBe(false);
    expect(isNativeError(null)).toBe(false);
  });
});

describe("shared.ts getPrettyLogMethod", () => {
  test("prefers the per-level override, then '*', then falls back to console.log", () => {
    const perLevel = vi.fn();
    const star = vi.fn();

    // Per-level override wins.
    expect(getPrettyLogMethod("WARN", { WARN: perLevel, "*": star })).toBe(perLevel);
    // No per-level entry -> '*' override.
    expect(getPrettyLogMethod("WARN", { "*": star })).toBe(star);
    // Neither -> default console.log (a real function).
    const fallback = getPrettyLogMethod("WARN", undefined);
    expect(typeof fallback).toBe("function");
    // Undefined level name never indexes levelMethod, so '*' still applies.
    expect(getPrettyLogMethod(undefined, { "*": star })).toBe(star);
  });
});

describe("shared.ts getEnvironmentHostname (direct)", () => {
  test("prefers the process env HOSTNAME/HOST/COMPUTERNAME override", () => {
    expect(getEnvironmentHostname({ env: { HOSTNAME: "from-hostname" } })).toBe("from-hostname");
    expect(getEnvironmentHostname({ env: { HOST: "from-host" } })).toBe("from-host");
    expect(getEnvironmentHostname({ env: { COMPUTERNAME: "from-computername" } })).toBe("from-computername");
  });

  test("swallows a process.env read that throws (Deno NotCapable) and continues", () => {
    // A proxy whose property GETs throw simulates Deno's permission-checked process.env.
    const throwingEnv = new Proxy(
      {},
      {
        get() {
          throw new Error("NotCapable");
        },
      },
    ) as Record<string, string | undefined>;
    expect(getEnvironmentHostname({ env: throwingEnv }, undefined, undefined, { hostname: "loc" })).toBe("loc");
  });

  test("falls back to the Bun env bag when process env is empty", () => {
    expect(getEnvironmentHostname({ env: {} }, undefined, { env: { HOST: "bun-host" } })).toBe("bun-host");
  });

  test("swallows a throwing Bun env read", () => {
    const throwingEnv = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    ) as Record<string, string | undefined>;
    expect(getEnvironmentHostname({ env: {} }, undefined, { env: throwingEnv }, { hostname: "loc" })).toBe("loc");
  });

  test("reads HOSTNAME via Deno.env.get and swallows a throwing get", () => {
    expect(getEnvironmentHostname({ env: {} }, { env: { get: (k) => (k === "HOSTNAME" ? "deno-env" : undefined) } })).toBe("deno-env");

    const throwing = getEnvironmentHostname(
      { env: {} },
      {
        env: {
          get: () => {
            throw new Error("NotCapable");
          },
        },
      },
      undefined,
      { hostname: "loc" },
    );
    expect(throwing).toBe("loc");
  });

  test("uses Deno.hostname() and swallows a throwing hostname()", () => {
    expect(getEnvironmentHostname({ env: {} }, { hostname: () => "deno-host-fn" })).toBe("deno-host-fn");

    const throwing = getEnvironmentHostname(
      { env: {} },
      {
        hostname: () => {
          throw new Error("NotCapable");
        },
      },
      undefined,
      { hostname: "loc" },
    );
    expect(throwing).toBe("loc");
  });

  test("uses node:os via process.getBuiltinModule and swallows a throwing accessor", () => {
    const proc = {
      env: {},
      getBuiltinModule: (id: string) => (id === "node:os" ? { hostname: () => "os-host" } : undefined),
    };
    expect(getEnvironmentHostname(proc)).toBe("os-host");

    const throwingProc = {
      env: {},
      getBuiltinModule: () => {
        throw new Error("NotCapable");
      },
    };
    expect(getEnvironmentHostname(throwingProc, undefined, undefined, { hostname: "loc" })).toBe("loc");
  });

  test("returns undefined when nothing resolves", () => {
    expect(getEnvironmentHostname({ env: {} })).toBeUndefined();
    // getBuiltinModule present but os.hostname returns an empty string -> not accepted.
    expect(
      getEnvironmentHostname({
        env: {},
        getBuiltinModule: () => ({ hostname: () => "" }),
      }),
    ).toBeUndefined();
  });
});

describe("shared.ts normalizeFilePath (direct)", () => {
  test("returns the value unchanged for a non-string / empty input", () => {
    expect(normalizeFilePath("")).toBe("");
    expect(normalizeFilePath(undefined as unknown as string)).toBeUndefined();
  });

  test("collapses backslashes to forward slashes and preserves a windows drive prefix", () => {
    expect(normalizeFilePath("C:\\a\\b\\c.ts")).toBe("C:/a/b/c.ts");
    // Drive-only input keeps just the drive prefix (no trailing slash appended).
    expect(normalizeFilePath("C:\\")).toBe("C:");
  });

  test("preserves a UNC leading double slash", () => {
    expect(normalizeFilePath("//server/share/x.ts")).toBe("//server/share/x.ts");
  });

  test("preserves a single leading slash and resolves . and .. segments", () => {
    expect(normalizeFilePath("/a/b/../c/./d.ts")).toBe("/a/c/d.ts");
  });

  test("normalizes a relative path with no leading slash or drive", () => {
    expect(normalizeFilePath("a/b/c.ts")).toBe("a/b/c.ts");
  });

  test("returns the original value when normalization collapses to empty", () => {
    // Only '..' segments with no leading slash -> normalizedSegments empty -> original returned.
    expect(normalizeFilePath("../..")).toBe("../..");
  });
});

describe("shared.ts detectRuntimeInfo (Bun/Deno/Node branches, direct via stubbed globals)", () => {
  test("detects Bun with a version and resolves its hostname", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.importScripts;
    vi.stubGlobal("navigator", undefined);
    globalAny.Bun = { version: "1.2.0", env: { HOSTNAME: "bun-host" } };
    const info = detectRuntimeInfo();
    expect(info.name).toBe("bun");
    expect(info.version).toBe("bun/1.2.0");
    expect(info.hostname).toBe("bun-host");
  });

  test("detects Bun without a version (version stays undefined)", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.importScripts;
    vi.stubGlobal("navigator", undefined);
    globalAny.Bun = {};
    const info = detectRuntimeInfo();
    expect(info.name).toBe("bun");
    expect(info.version).toBeUndefined();
  });

  test("detects Deno with and without a version string", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    delete globalAny.process;
    vi.stubGlobal("navigator", undefined);
    globalAny.Deno = { version: { deno: "2.1.0" } };
    expect(detectRuntimeInfo().version).toBe("deno/2.1.0");

    globalAny.Deno = {};
    const info = detectRuntimeInfo();
    expect(info.name).toBe("deno");
    expect(info.version).toBeUndefined();
  });

  test("detects Node from process.versions.node", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    vi.stubGlobal("navigator", undefined);
    globalAny.process = { versions: { node: "20.9.0" }, env: {} };
    const info = detectRuntimeInfo();
    expect(info.name).toBe("node");
    expect(info.version).toBe("20.9.0");
  });

  test("detects Node from process.version alone", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    vi.stubGlobal("navigator", undefined);
    globalAny.process = { version: "v20.0.0", env: {} };
    const info = detectRuntimeInfo();
    expect(info.name).toBe("node");
    expect(info.version).toBe("v20.0.0");
  });

  test("detects a bare process global as node with an 'unknown' version", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    vi.stubGlobal("navigator", undefined);
    globalAny.process = { env: {} };
    const info = detectRuntimeInfo();
    expect(info.name).toBe("node");
    expect(info.version).toBe("unknown");
  });

  test("reports 'unknown' when no runtime marker is present", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    vi.stubGlobal("navigator", undefined);
    globalAny.process = undefined;
    expect(detectRuntimeInfo().name).toBe("unknown");
  });
});

describe("shared.ts isWorkerEnvironment (direct)", () => {
  test("true only when importScripts is a function", () => {
    delete globalAny.importScripts;
    expect(isWorkerEnvironment()).toBe(false);
    globalAny.importScripts = function importScripts() {};
    expect(isWorkerEnvironment()).toBe(true);
  });
});

// ================================================================================================
// src/env/stackTrace.ts — shared stack helpers
// ================================================================================================
describe("env/stackTrace.ts helpers", () => {
  test("splitStackLines yields [] for a missing/empty stack and a throwing getter", () => {
    expect(envSplitStackLines({})).toEqual([]);
    expect(envSplitStackLines({ stack: "" })).toEqual([]);
    const hostile = {
      get stack(): string {
        throw new Error("no stack for you");
      },
    };
    expect(envSplitStackLines(hostile)).toEqual([]);
  });

  test("sanitizeStackLines drops blanks and error-header lines", () => {
    expect(envSanitizeStackLines(["Error: boom", "", "    at fn (/a.js:1:1)"])).toEqual(["    at fn (/a.js:1:1)"]);
  });

  test("toStackFrames skips lines the parser rejects", () => {
    const parse = (line: string): IStackFrame | undefined => (line.includes("keep") ? { fileName: line } : undefined);
    expect(envToStackFrames(["keep-a", "drop", "keep-b"], parse)).toEqual([{ fileName: "keep-a" }, { fileName: "keep-b" }]);
  });

  test("buildStackTrace splits, sanitizes and parses in one call", () => {
    const error = { stack: "Error: x\nfn@/host/app.js:10:5" } as Error;
    const frames = envBuildStackTrace(error, (line) => parseBrowserStackLine(line));
    expect(frames).toHaveLength(1);
    expect(frames[0]?.fileLine).toBe("10");
  });

  test("findFirstExternalFrameIndex returns the first non-ignored frame, else 0 for all-internal", () => {
    const frames: IStackFrame[] = [{ filePath: "/node_modules/tslog/dist/x.js" }, { filePath: "/app/user.ts" }];
    expect(envFindFirstExternalFrameIndex(frames)).toBe(1);

    // Every frame matches an ignore pattern -> falls back to index 0.
    const allInternal: IStackFrame[] = [{ filePath: "/node_modules/tslog/a.js" }, { fullFilePath: "/deps/tslog/b.js" }];
    expect(envFindFirstExternalFrameIndex(allInternal)).toBe(0);

    // Empty frames array -> 0.
    expect(envFindFirstExternalFrameIndex([])).toBe(0);
  });

  test("clampIndex clamps below 0, above max, and passes through valid indexes", () => {
    expect(envClampIndex(-5, 3)).toBe(0);
    expect(envClampIndex(10, 3)).toBe(2);
    expect(envClampIndex(1, 3)).toBe(1);
    // maxExclusive 0 -> Math.max(0, -1) === 0.
    expect(envClampIndex(4, 0)).toBe(0);
  });

  test("getDefaultIgnorePatterns returns a fresh copy each call", () => {
    const a = envGetDefaultIgnorePatterns();
    const b = envGetDefaultIgnorePatterns();
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
    a.push(/extra/);
    expect(b.length).toBe(a.length - 1);
  });
});

// ================================================================================================
// src/env/environment.browser.ts — the provider itself, driven with stubbed browser globals
// ================================================================================================
describe("createBrowserEnvironment provider", () => {
  describe("getMeta", () => {
    test("attaches path (capture on) and eagerly sets name + parentNames", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const error = { stack: "Error\nfn@http://localhost/app.js:10:5" } as Error;
      // callerFrame 0 with a real Error captured inside getMeta -> path is present.
      const meta = env.getMeta(3, "INFO", Number.NaN, false, "svc", ["root"]) as IMeta & {
        name?: string;
        parentNames?: string[];
        runtime?: string;
      };
      expect(meta.runtime).toBe("browser");
      expect(meta.logLevelId).toBe(3);
      expect(meta.logLevelName).toBe("INFO");
      expect(meta.date).toBeInstanceOf(Date);
      expect(meta.name).toBe("svc");
      expect(meta.parentNames).toEqual(["root"]);
      // hideLogPosition === false -> a path object is present.
      expect(meta.path).toBeDefined();
      // dropped-through mock stack has no origin; browser parsing still gives a frame.
      void error;
    });

    test("omits path when hideLogPosition is true and omits name/parentNames when unset", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const meta = env.getMeta(4, "WARN", Number.NaN, true) as IMeta & { name?: string; parentNames?: string[] };
      expect(meta.path).toBeUndefined();
      expect("name" in meta).toBe(false);
      expect("parentNames" in meta).toBe(false);
    });
  });

  describe("getCallerStackFrame", () => {
    test("returns {} for an error with no stack frames", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const empty = { stack: "" } as Error;
      expect(env.getCallerStackFrame(Number.NaN, empty)).toEqual({});
    });

    test("honours a manual callerFrame index", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const error = {
        stack: "Error\nfirst@http://h/a/one.js:1:1\nsecond@http://h/a/two.js:2:2",
      } as Error;
      const frame = env.getCallerStackFrame(1, error);
      expect(frame.fileName).toBe("two.js");
    });

    test("extends the ignore list with caller-supplied internalFramePatterns for auto detection", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const error = {
        stack: "Error\nwrap@http://h/wrapper/lib.js:1:1\nuser@http://h/app/main.js:2:2",
      } as Error;
      // Skip the wrapper frame so auto-detection lands on the user frame.
      const frame = env.getCallerStackFrame(Number.NaN, error, [/wrapper\/lib\.js/]);
      expect(frame.fileName).toBe("main.js");
    });
  });

  describe("isError / isBuffer", () => {
    test("isError recognises errors; isBuffer is false without a real Buffer", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      expect(env.isError(new TypeError("x"))).toBe(true);
      expect(env.isError({ name: "MyError" })).toBe(true);
      expect(env.isError(123)).toBe(false);
      // No Buffer global under the browser stub -> false.
      const savedBuffer = (globalThis as Record<string, unknown>).Buffer;
      vi.stubGlobal("Buffer", undefined);
      expect(env.isBuffer(new Uint8Array())).toBe(false);
      vi.stubGlobal("Buffer", savedBuffer);
    });
  });

  describe("prettyFormatLine (non-transport pretty rendering)", () => {
    test("prepends stripped meta markup and appends formatted args plus a separated error block", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({ template: "{{logLevelName}} ", styles: {} });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;
      const err = new Error("kaboom");
      const line = env.prettyFormatLine(["payload", err], meta, settings);
      expect(line).toContain("INFO");
      expect(line).toContain("payload");
      // The error is pretty-formatted into the trailing error block.
      expect(line).toContain("kaboom");
    });

    test("with styling disabled (style:false) the meta markup is ANSI-stripped", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({ style: false, template: "{{logLevelName}} " });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;
      const line = env.prettyFormatLine(["hello"], meta, settings);
      // No raw ANSI escape bytes survive.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence of ANSI escapes
      expect(/\[/.test(line)).toBe(false);
      expect(line).toContain("hello");
    });
  });

  describe("prettyFormatErrorObj cause chains", () => {
    test("renders a Caused by section for each nested cause", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings();
      const root = new Error("root-cause");
      const top = new Error("top-level", { cause: root });
      const rendered = env.prettyFormatErrorObj(top, settings);
      expect(rendered).toContain("top-level");
      expect(rendered).toContain("Caused by (1)");
      expect(rendered).toContain("root-cause");
    });
  });

  describe("transportFormatted — plain-text branch (no CSS)", () => {
    test("a browser without CSS.supports and a non-Firefox/Safari UA takes the plain-text path", () => {
      // Chrome-like UA but NO CSS global and NO chrome global -> consoleSupportsCssStyling() is false.
      makeBrowser("Mozilla/5.0 (X11) AppleWebKit/537.36 (KHTML) Chrome/120.0.0.0");
      delete globalAny.CSS;
      const env = createBrowserEnvironment();
      const settings = prettySettings({ template: "{{logLevelName}} ", styles: {} });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("META ", ["body"], [], meta, settings);
      const call = spy.mock.calls[0] as unknown[];
      spy.mockRestore();

      // Plain-text branch: a single string argument, no %c markers, no extra style args.
      expect(call.length).toBe(1);
      expect(String(call[0])).not.toContain("%c");
      expect(String(call[0])).toContain("body");
    });

    test("with style:false the plain-text branch strips ANSI and joins errors after args", () => {
      makeBrowser("Mozilla/5.0 (X11) Chrome/120.0.0.0");
      delete globalAny.CSS;
      const env = createBrowserEnvironment();
      const settings = prettySettings({ style: false });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      // Both args and errors present -> a leading newline separates them.
      env.transportFormatted("[31mMETA[39m ", ["arg"], ["ERR-BLOCK"], meta, settings);
      const call = spy.mock.calls[0] as unknown[];
      spy.mockRestore();

      const out = String(call[0]);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting ANSI was stripped
      expect(/\[/.test(out)).toBe(false);
      expect(out).toContain("arg");
      expect(out).toContain("\nERR-BLOCK");
    });

    test("uses a per-level console method override when supplied", () => {
      makeBrowser("Mozilla/5.0 (X11) Chrome/120.0.0.0");
      delete globalAny.CSS;
      const env = createBrowserEnvironment();
      const levelSpy = vi.fn();
      const settings = prettySettings({ style: false, levelMethod: { INFO: levelSpy } });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      env.transportFormatted("META ", ["x"], [], meta, settings);
      expect(levelSpy).toHaveBeenCalledTimes(1);
      expect(String(levelSpy.mock.calls[0][0])).toContain("x");
    });
  });

  describe("transportJSON", () => {
    test("writes a single JSON line via the native console", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportJSON({ msg: "hi", _meta: { logLevelId: 3, logLevelName: "INFO" } } as never);
      const out = String(spy.mock.calls[0]?.[0]);
      spy.mockRestore();
      expect(() => JSON.parse(out)).not.toThrow();
      expect(JSON.parse(out)).toMatchObject({ msg: "hi" });
    });
  });

  describe("transportFormatted — CSS %c styling branch", () => {
    test("emits %c markers and css style args for a styled placeholder", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({ template: "{{logLevelName}}", styles: { logLevelName: "blue" } });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("", ["hello"], [], meta, settings);
      const call = spy.mock.calls[0] as unknown[];
      spy.mockRestore();

      const text = call[0] as string;
      expect(text).toContain("%c");
      expect(text).toContain("INFO");
      expect(text).toContain("hello");
      // blue -> a color css value passed as a separate console argument.
      expect(call.slice(1)).toContain("color: #42a5f5");
    });

    test("collectStyleTokens resolves string, array/nested-array and object (level-map) styles; tokensToCss dedupes", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      function styleArgsFor(style: unknown): string[] {
        const settings = prettySettings({
          template: "{{logLevelName}}",
          styles: { logLevelName: style } as ISettings<unknown>["pretty"]["styles"],
        });
        const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        env.transportFormatted("FALLBACK", [], [], meta, settings);
        const call = spy.mock.calls[0] as unknown[];
        spy.mockRestore();
        return call.slice(1).filter((arg) => typeof arg === "string" && arg.length > 0) as string[];
      }

      // string token
      expect(styleArgsFor("red")).toContain("color: #ef5350");
      // array + nested array -> joined into one css string
      expect(styleArgsFor(["bold", ["red"]])).toEqual(["font-weight: bold; color: #ef5350"]);
      // object level-map: exact-level match wins
      expect(styleArgsFor({ INFO: "blue", "*": "white" })).toEqual(["color: #42a5f5"]);
      // object level-map: no exact match -> '*' fallback
      expect(styleArgsFor({ WARN: "blue", "*": "white" })).toEqual(["color: #fafafa"]);
      // duplicate tokens collapse to a single css declaration (tokensToCss `seen` set)
      expect(styleArgsFor(["red", "red"])).toEqual(["color: #ef5350"]);
    });

    test("a placeholder whose style resolves to no css falls back to sanitized meta markup", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      // Empty styles -> collectStyleTokens returns [] -> no css produced.
      const settings = prettySettings({ template: "{{logLevelName}}", styles: {} });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("SANITIZED-META", ["body"], [], meta, settings);
      const call = spy.mock.calls[0] as unknown[];
      spy.mockRestore();

      // No css -> single argument, no %c, falls back to the passed-in sanitized markup.
      expect(call.length).toBe(1);
      expect(String(call[0])).not.toContain("%c");
      expect(String(call[0])).toContain("SANITIZED-META");
    });

    test("literal template text before/after a placeholder is preserved in the css output", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({ template: "PRE {{logLevelName}} POST", styles: { logLevelName: "blue" } });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("", [], [], meta, settings);
      const text = spy.mock.calls[0]?.[0] as string;
      spy.mockRestore();

      expect(text).toContain("PRE ");
      expect(text).toContain(" POST");
    });

    test("null meta in the CSS branch uses the sanitized fallback markup", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings();

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("", ["only-args"], [], undefined, settings);
      const call = spy.mock.calls[0] as unknown[];
      spy.mockRestore();

      expect(call.length).toBe(1);
      expect(String(call[0])).not.toContain("%c");
      expect(String(call[0])).toContain("only-args");
    });
  });

  describe("isBuffer with a real Buffer", () => {
    test("returns true for a Node Buffer and false for a plain Uint8Array", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      // Buffer exists in the Node test runtime; the browser provider still delegates to Buffer.isBuffer.
      expect(env.isBuffer(Buffer.from("hi"))).toBe(true);
      expect(env.isBuffer(new Uint8Array([1]))).toBe(false);
    });
  });

  describe("formatWithOptionsSafe fallback", () => {
    test("a throwing-inspect arg falls back to per-arg stringifyFallback without crashing", () => {
      makeBrowser("Mozilla/5.0 (X11) Chrome/120.0.0.0");
      delete globalAny.CSS;
      const env = createBrowserEnvironment();
      const settings = prettySettings({ style: false });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      // A Proxy whose ownKeys trap throws makes the bundled inspect polyfill throw deep inside,
      // triggering the formatWithOptionsSafe catch -> stringifyFallback per arg.
      const throwing = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("inspection blew up");
          },
        },
      );

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      let out = "";
      expect(() => {
        env.transportFormatted("META ", ["plain", throwing], [], meta, settings);
        out = String(spy.mock.calls[0]?.[0]);
      }).not.toThrow();
      spy.mockRestore();

      expect(out).toContain("plain");
    });
  });

  describe("getWorkingDirectory when no cwd is resolvable", () => {
    test("server frames keep their absolute path when process.cwd is unavailable", () => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;
      vi.stubGlobal("navigator", undefined);
      // process exists (so the server parser is selected) but exposes no cwd -> safeGetCwd() === undefined.
      globalAny.process = { env: {}, versions: { node: "20.0.0" } };
      const env = createBrowserEnvironment();

      const error = { stack: "Error\n    at fn (/abs/no/cwd/mod.ts:3:4)" } as Error;
      const frames = env.getErrorTrace(error);
      // No cwd resolved -> the absolute path is not stripped.
      expect(frames[0]?.filePath).toBe("/abs/no/cwd/mod.ts");
    });
  });

  describe("React Native selection in the browser entry", () => {
    test("uses React Native stack parsing when navigator.product is ReactNative", () => {
      makeReactNative();
      const env = createBrowserEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta & { runtime?: string };
      expect(meta.runtime).toBe("react-native");

      // A JSC bare-bundle frame is parsed via the RN path (server parser rejects it).
      const error = { stack: "Error\ntick@main.jsbundle:5:9" } as Error;
      const frames = env.getErrorTrace(error);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.filePath).toBe("main.jsbundle");
      expect(frames[0]?.fileLine).toBe("5");
    });
  });

  describe("Server stack selection + cwd handling in the browser entry", () => {
    test("uses the server parser and strips the cached cwd when not browser/worker/RN", () => {
      makeServerFlavoredBrowserEntry();
      const env = createBrowserEnvironment();
      // process.cwd() === "/repo/root" -> the cwd prefix is stripped from server-style frames.
      const error = { stack: "Error\n    at fn (/repo/root/src/deep/mod.ts:12:3)" } as Error;
      const frames = env.getErrorTrace(error);
      expect(frames).toHaveLength(1);
      expect(frames[0]?.filePath).toBe("src/deep/mod.ts");
      expect(frames[0]?.method).toBe("fn");

      // Second call reuses the cached cwd (getWorkingDirectory memoizes) and still strips it.
      const error2 = { stack: "Error\n    at other (/repo/root/lib/x.ts:1:1)" } as Error;
      const frames2 = env.getErrorTrace(error2);
      expect(frames2[0]?.filePath).toBe("lib/x.ts");
    });
  });

  describe("getErrorTrace", () => {
    test("returns [] for an error with an empty stack", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      expect(env.getErrorTrace({ stack: "" } as Error)).toEqual([]);
    });
  });
});
