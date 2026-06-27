import { createLoggerEnvironment } from "../src/BaseLogger.js";
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
  const env = createLoggerEnvironment();
  const error = new Error("x");
  error.stack = `Error: x\n${stackBody}`;
  const frames = env.getErrorTrace(error);
  return frames[0];
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

  test("falls back to stringifyFallback for each arg when inspection throws", () => {
    const env = createLoggerEnvironment();
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    // A Proxy whose ownKeys trap throws makes Object.keys() throw deep inside
    // formatWithOptions -> inspect -> formatValue, which is NOT guarded, so the
    // exception escapes formatWithOptions and triggers the catch in formatWithOptionsSafe.
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

    const settings = { stylePrettyLogs: false, prettyInspectOptions: {} } as unknown as ISettings<unknown>;

    env.transportFormatted("META ", ["plain", { a: 1 }, 10n, circular, throwingInspectArg], [], undefined, settings);

    expect(spy).toHaveBeenCalledTimes(1);
    const output = spy.mock.calls[0][0] as string;
    spy.mockRestore();

    // string passed through unchanged
    expect(output).toContain("plain");
    // plain object serialized via JSON.stringify
    expect(output).toContain('{"a":1}');
    // BigInt is not JSON-serializable -> stringifyFallback catch -> String(10n) === "10"
    expect(output).toContain(" 10 ");
    // circular object is not JSON-serializable -> String() === "[object Object]"
    expect(output).toContain("[object Object]");
  });
});

describe("detectRuntimeInfo / getEnvironmentHostname / resolveDenoHostname fallbacks", () => {
  function metaFor(): IMeta {
    const env = createLoggerEnvironment();
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

  test("resolveDenoHostname swallows a throwing Deno.hostname() and falls back to location.hostname", () => {
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
    const env = createLoggerEnvironment();
    expect(env.isError(new Error("boom"))).toBe(true);
    expect(env.isError(new TypeError("nope"))).toBe(true);
  });

  test("recognises plain objects whose name ends with Error", () => {
    const env = createLoggerEnvironment();
    expect(env.isError({ name: "ValidationError", message: "x" })).toBe(true);
  });

  test("recognises objects whose toString tag matches [object ...Error]", () => {
    const env = createLoggerEnvironment();
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
    const env = createLoggerEnvironment();
    expect(env.isError({ name: "Warning" })).toBe(false);
    expect(env.isError("string")).toBe(false);
    expect(env.isError(null)).toBe(false);
  });
});
