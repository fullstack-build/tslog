import { createNodeEnvironment } from "../src/env/environment.node.js";
import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { parseBrowserStackLine } from "../src/env/shared.js";
import type { IMeta, ISettings, IStackFrame } from "../src/interfaces.js";

// Shared global stubbing harness. navigator is a getter-only property in Node,
// so it must be set via vi.stubGlobal rather than direct assignment.
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
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) {
      delete globalAny[k];
    } else {
      globalAny[k] = v;
    }
  }
});

// Build a real Error, overwrite its stack with a synthetic server-style trace,
// and run it through the parser via env.getErrorTrace. The "Error: x" header
// line is stripped by buildStackTrace, leaving a single parsed frame.
function frameForServerStack(stackBody: string): IStackFrame {
  const env = createNodeEnvironment();
  const error = new Error("x");
  error.stack = `Error: x\n${stackBody}`;
  const frames = env.getErrorTrace(error);
  return frames[0];
}

// Browser frames (Chrome/Firefox/Safari/Vite) flow through parseBrowserStackLine, which is what the
// browser/worker providers select. Drive it directly — mirrors the frameForServerStack helper above
// but for the browser regex rather than the V8 server parser.
function frameForBrowserStack(frame: string): IStackFrame {
  const parsed = parseBrowserStackLine(frame);
  if (parsed === undefined) {
    throw new Error(`expected a parseable browser frame, got undefined for: ${frame}`);
  }
  return parsed;
}

describe("normalizeFilePath via getErrorTrace (node env, server frames)", () => {
  beforeEach(() => {
    // Ensure the server stack parser is selected: process present, no browser/worker/deno/bun globals.
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    globalAny.process = { env: {}, versions: { node: "20.0.0" } };
  });

  test("preserves windows drive prefix and converts backslashes to forward slashes", () => {
    const frame = frameForServerStack("    at fn (C:\\Users\\me\\proj\\file.ts:10:5)");
    // Drive letter is kept, every backslash becomes a forward slash.
    expect(frame.filePath).toBe("C:/Users/me/proj/file.ts");
    expect(frame.filePath?.startsWith("C:/")).toBe(true);
    expect(frame.filePath).not.toContain("\\");
    // Line and column are split off the trailing ":10:5".
    expect(frame.fileLine).toBe("10");
    expect(frame.fileColumn).toBe("5");
    expect(frame.fileName).toBe("file.ts");
    expect(frame.method).toBe("fn");
  });

  test("pops .. segments so /a/b/../c/file.ts normalizes to /a/c/file.ts", () => {
    const frame = frameForServerStack("    at fn (/a/b/../c/file.ts:3:1)");
    expect(frame.filePath).toBe("/a/c/file.ts");
    expect(frame.fileLine).toBe("3");
    expect(frame.fileColumn).toBe("1");
    expect(frame.fileNameWithLine).toBe("file.ts:3");
    expect(frame.filePathWithLine).toBe("/a/c/file.ts:3");
  });

  test("preserves UNC leading double slash", () => {
    const frame = frameForServerStack("    at fn (//server/share/file.ts:1:1)");
    expect(frame.filePath).toBe("//server/share/file.ts");
    expect(frame.filePath?.startsWith("//")).toBe(true);
    expect(frame.fileLine).toBe("1");
    expect(frame.fileColumn).toBe("1");
  });

  test("returns the original path when normalization collapses to empty (only .. segments)", () => {
    const frame = frameForServerStack("    at fn (../../:7:2)");
    // normalizeFilePath pops both ".." segments leaving "" and falls back to the original value.
    expect(frame.filePath).toBe("../../");
    expect(frame.filePath?.length).toBeGreaterThan(0);
    expect(frame.fileLine).toBe("7");
    expect(frame.fileColumn).toBe("2");
  });
});

describe("parseBrowserStackLine — Windows drive-letter paths (Vite /@fs/, issue #323)", () => {
  test("Vite /@fs/C:/… frame keeps the drive path and pops :line:col", () => {
    const frame = frameForBrowserStack("http://localhost:5173/@fs/C:/Git/MyApp/src/main.js:12:3");
    // The drive-letter colon is absorbed into the path; only the trailing :line:col are split off.
    expect(frame.filePath).toContain("C:/Git/MyApp/src/main.js");
    expect(frame.fileName).toBe("main.js");
    expect(frame.fileLine).toBe("12");
    expect(frame.fileColumn).toBe("3");
    expect(frame.filePathWithLine?.endsWith("C:/Git/MyApp/src/main.js:12")).toBe(true);
    expect(frame.fileNameWithLine).toBe("main.js:12");
    // fullFilePath is re-derived from the frame's own URL, with :line:col and query stripped.
    expect(frame.fullFilePath).toBe("http://localhost:5173/@fs/C:/Git/MyApp/src/main.js");
    expect(frame.method).toBeUndefined();
  });

  test("Vite query suffix (?t=…) is stripped, line/col still parsed", () => {
    const frame = frameForBrowserStack("http://localhost:5173/@fs/C:/Git/MyApp/src/main.js?t=1712345678:12:3");
    expect(frame.filePath).toContain("C:/Git/MyApp/src/main.js");
    expect(frame.filePath).not.toContain("?");
    expect(frame.filePath).not.toContain("1712345678");
    expect(frame.fileName).toBe("main.js");
    expect(frame.fileLine).toBe("12");
    expect(frame.fileColumn).toBe("3");
    expect(frame.fullFilePath).not.toContain("?");
  });

  test("line-only drive-letter frame yields fileLine but no fileColumn", () => {
    const frame = frameForBrowserStack("http://localhost:5173/@fs/C:/Proj/a.js:7");
    expect(frame.filePath).toContain("C:/Proj/a.js");
    expect(frame.fileName).toBe("a.js");
    expect(frame.fileLine).toBe("7");
    expect(frame.fileColumn).toBeUndefined();
  });
});

describe("parseBrowserStackLine — non-Windows frames unchanged (regression guards for #323)", () => {
  test("plain http frame keeps host in path with line/col split off", () => {
    // Baseline before the drive-letter change: the port colon terminates the host run, so the host
    // is NOT part of the captured path here (differs from the no-port case below by design).
    const frame = frameForBrowserStack("http://localhost:3000/src/app.js:42:13");
    expect(frame.filePath).toBe("/src/app.js");
    expect(frame.fileLine).toBe("42");
    expect(frame.fileColumn).toBe("13");
    expect(frame.fileName).toBe("app.js");
  });

  test("Firefox fn@ frame parses path, line and column", () => {
    const frame = frameForBrowserStack("fn@http://localhost:3000/src/app.js:42:13");
    expect(frame.filePath).toBe("/src/app.js");
    expect(frame.fileLine).toBe("42");
    expect(frame.fileColumn).toBe("13");
    expect(frame.method).toBeUndefined();
  });

  test("no-port host is retained as the first path segment", () => {
    const frame = frameForBrowserStack("asyncFn@https://example.com/script.js:42:15");
    expect(frame.filePath).toBe("/example.com/script.js");
    expect(frame.fileLine).toBe("42");
    expect(frame.fileColumn).toBe("15");
  });

  test("bare React-Native bundle name is NOT captured by the browser regex", () => {
    // Single-segment bundle names must fall through to the JSC parser, so parseBrowserStackLine
    // returns undefined here — the {2,} path-segment guard still holds after the drive-letter change.
    expect(parseBrowserStackLine("main.jsbundle:1:2")).toBeUndefined();
  });
});

describe("formatWithOptionsSafe / stringifyFallback via transportFormatted", () => {
  beforeEach(() => {
    // Node, non-browser: shouldUseCss() is false so the plain text branch runs and uses formatWithOptionsSafe.
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    globalAny.process = { env: {}, versions: { node: "20.0.0" } };
  });

  test("a hostile ownKeys proxy degrades to empty braces while sibling args keep their rich rendering", () => {
    // v5 inspect strategy (M0.5/2.2): the universal provider resolves inspect via resolveInspect() —
    // the bundled polyfill whenever native node:util is not reachable through a global require (as in
    // this vitest ESM run). The polyfill is TOTAL: a Proxy whose ownKeys trap throws is contained
    // inside formatValue (the proxy renders as an empty object) instead of aborting the whole line,
    // so the sibling args keep their inspected rendering rather than degrading to JSON strings.
    // The formatWithOptionsSafe -> stringifyFallback cascade still exists for a THROWING native
    // inspect and is pinned in tests/69, tests/72 and tests/73.
    const env = createUniversalEnvironment();
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const throwingInspectArg = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("inspection blew up");
        },
      },
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    // M3a grouped settings: stylePrettyLogs -> pretty.style, prettyInspectOptions -> pretty.inspectOptions
    const settings = { pretty: { style: false, inspectOptions: {} } } as unknown as ISettings<unknown>;

    env.transportFormatted("META ", ["plain", { a: 1 }, 10n, circular, throwingInspectArg], [], undefined, settings);

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    spy.mockRestore();

    // string passed through unchanged; object and bigint keep the polyfill's rich rendering
    expect(output).toContain("plain");
    expect(output).toContain("a: 1");
    expect(output).toContain("10n");
    // the circular reference is contained by the [Circular] marker, not a crash
    expect(output).toContain("[Circular]");
    // the hostile proxy itself is the only casualty: it degrades to an empty object
    expect(output).toContain("{\n\n}");
  });
});

describe("detectRuntimeInfo / getEnvironmentHostname fallbacks", () => {
  function metaFor(): IMeta {
    const env = createNodeEnvironment();
    return env.getMeta(3, "INFO", 0, true) as IMeta;
  }

  test("process present without versions.node/version reports node runtime with unknown version", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    globalAny.process = { env: {} };

    const meta = metaFor() as IMeta & { runtime?: string; runtimeVersion?: string; hostname?: string };
    expect(meta.runtime).toBe("node");
    expect(meta.runtimeVersion).toBe("unknown");
    // env has no HOSTNAME/HOST/COMPUTERNAME and there is no location -> defaults to "unknown".
    expect(meta.hostname).toBe("unknown");
  });

  test("getEnvironmentHostname falls back to location.hostname for node runtime", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    globalAny.process = { env: {} };
    globalAny.location = { hostname: "edge-host" };

    const meta = metaFor() as IMeta & { runtime?: string; hostname?: string };
    expect(meta.runtime).toBe("node");
    expect(meta.hostname).toBe("edge-host");
  });

  test("getEnvironmentHostname swallows a throwing Deno.hostname() and falls back to location.hostname", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    delete globalAny.process;
    globalAny.Deno = {
      version: { deno: "2.0.0" },
      hostname: () => {
        throw new Error("denied");
      },
    };
    globalAny.location = { hostname: "deno-fallback" };

    const meta = metaFor() as IMeta & { runtime?: string; runtimeVersion?: string; hostname?: string };
    expect(meta.runtime).toBe("deno");
    expect(meta.runtimeVersion).toBe("deno/2.0.0");
    expect(meta.hostname).toBe("deno-fallback");
  });
});

describe("isNativeError via env.isError", () => {
  test("recognises native Error and subclass instances", () => {
    const env = createNodeEnvironment();
    expect(env.isError(new Error("boom"))).toBe(true);
    expect(env.isError(new TypeError("nope"))).toBe(true);
  });

  test("recognises plain objects whose name ends with Error", () => {
    const env = createNodeEnvironment();
    expect(env.isError({ name: "ValidationError", message: "x" })).toBe(true);
  });

  test("recognises objects whose toString tag matches [object ...Error]", () => {
    const env = createNodeEnvironment();
    const tagged = {
      get [Symbol.toStringTag]() {
        return "DOMError";
      },
    };
    // Sanity check the tag the detector keys off of.
    expect(Object.prototype.toString.call(tagged)).toBe("[object DOMError]");
    expect(env.isError(tagged)).toBe(true);
  });

  test("rejects non-error names, primitives, and null", () => {
    const env = createNodeEnvironment();
    expect(env.isError({ name: "Warning" })).toBe(false);
    expect(env.isError("string")).toBe(false);
    expect(env.isError(null)).toBe(false);
  });
});
