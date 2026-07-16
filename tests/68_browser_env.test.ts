import { createBrowserEnvironment } from "../src/env/environment.browser.js";
import {
  createRuntimeMeta,
  detectOwnBrowserFilePattern,
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
  resolveHermesVersion,
  stringifyFallback,
  stripAnsi,
} from "../src/env/shared.js";
import {
  buildStackTrace as envBuildStackTrace,
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

/** Make the current global scope look like a React Native runtime (navigator.product === "ReactNative"). */
function makeReactNative(): void {
  delete globalAny.window;
  delete globalAny.document;
  delete globalAny.Deno;
  delete globalAny.Bun;
  delete globalAny.importScripts;
  vi.stubGlobal("navigator", { product: "ReactNative", userAgent: "Hermes" });
}

/** Real pretty-logger settings, with per-test overrides merged into the `pretty` group. */
function prettySettings(prettyOverrides: Partial<ISettings<unknown>["pretty"]> = {}): ISettings<unknown> {
  const settings = new Logger({ type: "pretty" }).settings as ISettings<unknown>;
  // These suites assert rendered-string/CSS-markup mechanics, so the browser default of
  // passObjectsNatively is pinned off (native-arg behavior has its own tests).
  return { ...settings, pretty: { ...settings.pretty, passObjectsNatively: false, ...prettyOverrides } };
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
      // The frame carries its own absolute URL, so fullFilePath is that URL (position stripped) even
      // without a location.origin; filePath is the origin-relative path (host stripped before matching).
      expect(frame.fullFilePath).toBe("https://host.example/assets/app.js");
      expect(frame.filePath).toBe("/assets/app.js");
    });

    test("the frame's own URL wins over location.origin — no doubled or cross-origin host", () => {
      // The frame URL is authoritative: a page-origin prefix is only for scheme-less frames.
      globalAny.location = { origin: "https://page.example" };
      const frame = parseBrowserStackLine("fn@https://cdn.example/a/b/c.js:2:3") as IStackFrame;
      expect(frame.filePath).toBe("/a/b/c.js");
      expect(frame.fullFilePath).toBe("https://cdn.example/a/b/c.js");
    });

    test("keeps the port in fullFilePath while only line/column are stripped", () => {
      const frame = parseBrowserStackLine("fn@http://localhost:8080/assets/app.js:7:11") as IStackFrame;
      expect(frame.fullFilePath).toBe("http://localhost:8080/assets/app.js");
      expect(frame.fileLine).toBe("7");
      expect(frame.fileColumn).toBe("11");
    });

    test("parses a root-level script on a host:port origin (dev-server case) in all three engine formats", () => {
      // A `host:port` authority used to break path matching entirely, and a single-segment path was
      // rejected by the old `{2,}` repetition — so nothing at http://localhost:5173/app.js ever parsed.
      const lines = {
        chromium: "    at http://localhost:5173/app.js:3:9",
        firefox: "@http://localhost:5173/app.js:3:9",
        webkit: "global code@http://localhost:5173/app.js:3:9",
      };
      for (const line of Object.values(lines)) {
        const frame = parseBrowserStackLine(line) as IStackFrame;
        expect(frame).toBeDefined();
        expect(frame.filePath).toBe("/app.js");
        expect(frame.fileNameWithLine).toBe("app.js:3");
        expect(frame.fileLine).toBe("3");
        expect(frame.fileColumn).toBe("9");
        expect(frame.fullFilePath).toBe("http://localhost:5173/app.js");
      }
    });

    test("keeps the Vite /@fs/C:/ Windows drive-letter path intact behind a host:port origin", () => {
      const frame = parseBrowserStackLine("run@http://localhost:5173/@fs/C:/Users/dev/src/app.ts:12:5") as IStackFrame;
      expect(frame.filePath).toBe("/@fs/C:/Users/dev/src/app.ts");
      expect(frame.fileLine).toBe("12");
    });

    test("prepends location.origin to a scheme-less origin-relative frame", () => {
      globalAny.location = { origin: "https://page.example" };
      const frame = parseBrowserStackLine("fn@/assets/app.js:1:2") as IStackFrame;
      expect(frame.filePath).toBe("/assets/app.js");
      expect(frame.fullFilePath).toBe("https://page.example/assets/app.js");
    });

    test("a scheme-less frame without location.origin keeps the bare path as fullFilePath", () => {
      const frame = parseBrowserStackLine("fn@/assets/app.js:1:2") as IStackFrame;
      expect(frame.fullFilePath).toBe("/assets/app.js");
    });

    test("drops a query string from both the captured file path and fullFilePath", () => {
      const frame = parseBrowserStackLine("fn@https://host.dev/a/bundle.js?v=9:4:2") as IStackFrame;
      expect(frame.filePath).toBe("/a/bundle.js");
      expect(frame.filePath).not.toContain("?");
      expect(frame.fullFilePath).toBe("https://host.dev/a/bundle.js");
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

  test("detectOwnBrowserFilePattern derives an exact-match pattern from the topmost parseable frame", () => {
    const error = { stack: "Error\nfn@http://localhost:5173/vendor/tslog.js:1:100\nuser@http://localhost:5173/app.js:2:1" } as Error;
    const pattern = detectOwnBrowserFilePattern(error) as RegExp;
    expect(pattern).toBeDefined();
    // exact file match only — the app served from the same origin must not be skipped
    expect(pattern.test("http://localhost:5173/vendor/tslog.js")).toBe(true);
    expect(pattern.test("http://localhost:5173/app.js")).toBe(false);
    expect(pattern.test("http://localhost:5173/vendor/tslog.js.map")).toBe(false);
  });

  test("detectOwnBrowserFilePattern returns undefined when no frame parses", () => {
    expect(detectOwnBrowserFilePattern({ stack: "Error\n    at <anonymous>" } as Error)).toBeUndefined();
    expect(detectOwnBrowserFilePattern({ stack: undefined } as unknown as Error)).toBeUndefined();
  });

  test("browser provider skips frames from tslog's own served file when locating the caller", () => {
    // Simulate the script-tag/CDN layout: tslog served as its own file, app code in another. The
    // provider's construction-time own-file pattern only helps the real bundle; here we exercise the
    // same mechanism through getCallerStackFrame with the detected pattern applied explicitly.
    const ownPattern = detectOwnBrowserFilePattern({
      stack: "Error\ninit@http://localhost:4444/tslog.js:24:1000",
    } as Error) as RegExp;
    const frames = [
      { fullFilePath: "http://localhost:4444/tslog.js", filePath: "/tslog.js" },
      { fullFilePath: "http://localhost:4444/app.js", filePath: "/app.js" },
    ];
    expect(envFindFirstExternalFrameIndex(frames, [ownPattern])).toBe(1);
  });

  test("formatErrorMessage excludes engine-stamped position props (Firefox/WebKit)", () => {
    // Firefox stamps fileName/lineNumber/columnNumber and WebKit stamps line/column/sourceURL as own
    // properties on every Error; without the exclusion the default message rendered as
    // "http://host/app.js, 3, 14, test" on those engines.
    const firefoxLike = new Error("ff-msg") as Error & Record<string, unknown>;
    firefoxLike.fileName = "http://localhost:5173/app.js";
    firefoxLike.lineNumber = 3;
    firefoxLike.columnNumber = 14;
    expect(formatErrorMessage(firefoxLike)).toBe("ff-msg");

    const webkitLike = new Error("wk-msg") as Error & Record<string, unknown>;
    webkitLike.line = 3;
    webkitLike.column = 23;
    webkitLike.sourceURL = "http://localhost:5173/app.js";
    expect(formatErrorMessage(webkitLike)).toBe("wk-msg");

    // custom props still join the message line
    const custom = new Error("base") as Error & Record<string, unknown>;
    custom.code = "E_X";
    expect(formatErrorMessage(custom)).toBe("base, E_X");
  });

  test("formatErrorMessage excludes an own `name` (subclass pattern) — the badge already shows it", () => {
    class HttpError extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.name = "HttpError"; // own property, unlike built-ins where name lives on the prototype
        this.status = status;
      }
    }
    expect(formatErrorMessage(new HttpError("Not Found", 404))).toBe("Not Found, 404");
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

  test("a 'DOMException' toString tag does NOT read as an error (tag must end in 'Error')", () => {
    // The positive cases (instances, *Error names, error-suffixed tags) and the plain rejections are
    // pinned in tests/33 via env.isError, which delegates to this same shared isNativeError.
    const tagged = {
      get [Symbol.toStringTag]() {
        return "DOMException";
      },
    };
    // toString tag is "[object DOMException]" -> does NOT match "[object ...Error]", and name is absent.
    expect(isNativeError(tagged)).toBe(false);
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
  test("falls back through the process env key chain HOST -> COMPUTERNAME", () => {
    // The HOSTNAME-wins precedence is pinned in tests/59; the HOST and COMPUTERNAME arms of the
    // process-env key chain are only exercised here.
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
});

describe("shared.ts normalizeFilePath (direct)", () => {
  test("returns the value unchanged for a non-string / empty input", () => {
    expect(normalizeFilePath("")).toBe("");
    expect(normalizeFilePath(undefined as unknown as string)).toBeUndefined();
  });

  test("a drive-only windows path keeps just the drive prefix (no trailing slash appended)", () => {
    // The general drive-prefix + backslash conversion, UNC, '..' and collapse-to-empty cases are
    // pinned in tests/33 via server frames; the bare-drive edge is only reachable directly.
    expect(normalizeFilePath("C:\\")).toBe("C:");
  });

  test("preserves a single leading slash and resolves '.' segments alongside '..'", () => {
    // tests/33 pins '..' popping; the '.' segment skip is only exercised here.
    expect(normalizeFilePath("/a/b/../c/./d.ts")).toBe("/a/c/d.ts");
  });

  test("normalizes a relative path with no leading slash or drive", () => {
    expect(normalizeFilePath("a/b/c.ts")).toBe("a/b/c.ts");
  });
});

describe("shared.ts detectRuntimeInfo (residual node/unknown branches, direct via stubbed globals)", () => {
  // Bun/Deno detection (with and without version), worker detection, and the bare-process -> node
  // fallback are pinned in tests/31 and tests/33 through the providers (same shared detectRuntimeInfo).
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

  // clampIndex bounds are pinned in tests/19 (the owner of env/stackTrace.ts); only the fresh-copy
  // mutation-isolation contract below is not asserted there.
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
    test("eagerly sets name + parentNames and stamps runtime, level and date", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      // Frame parsing/path attachment is pinned by the getCallerStackFrame tests below; this test
      // covers the name/parentNames/runtime/date contract (hideLogPosition false still exercises
      // the capture-on path).
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
    // The empty-stack -> {} return of the shared resolveCallerStackFrame is pinned in tests/69
    // through the node provider (same providerBase implementation).
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

  describe("isBuffer without a Buffer global", () => {
    // isError contracts (native instances, duck-typed names, rejections) are pinned in tests/33 and
    // tests/69 through the shared providerBase isError; the real-Buffer delegation arm is pinned in
    // tests/69 through the node provider. Only the missing-global arm is exercised here.
    test("isBuffer is false when no Buffer global exists", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const savedBuffer = (globalThis as Record<string, unknown>).Buffer;
      vi.stubGlobal("Buffer", undefined);
      expect(env.isBuffer(new Uint8Array())).toBe(false);
      vi.stubGlobal("Buffer", savedBuffer);
    });
  });

  describe("lazy inspect resolution (browser-provider difference)", () => {
    // The browser entry memoizes resolveInspect() PER PROVIDER INSTANCE on the first pretty format
    // call (node uses the static node:util import; universal resolves once at construction). Two
    // calls on the SAME instance pin both memo arms: first call resolves, second call reuses.
    test("the first format call resolves the inspect impl and a second call reuses the memo", () => {
      makeBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({ template: "{{logLevelName}} ", styles: {} });
      const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;

      const first = env.prettyFormatLine(["first-call", { a: 1 }], meta, settings);
      expect(first).toContain("INFO");
      expect(first).toContain("first-call");

      const second = env.prettyFormatLine(["second-call", { b: 2 }], meta, settings);
      expect(second).toContain("second-call");
      expect(second).toContain("b");
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

    // The style:false ANSI strip + the args/errors newline join of the shared plain-text path are
    // pinned in tests/69 through a real node-provider Logger (identical providerBase implementation).
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
});
