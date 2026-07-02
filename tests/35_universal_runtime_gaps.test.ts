import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { Logger } from "../src/index.js";
import type { IStackFrame } from "../src/interfaces.js";
import { jsonStringifyRecursive } from "../src/internal/jsonStringifyRecursive.js";

// Robustness suite: tslog must behave predictably across every runtime it claims to support
// (Node, browser, Deno, Bun, web workers, React Native/Hermes, and edge runtimes such as
// Cloudflare Workers). Each test asserts the *actual* current behavior of the source — where
// the source has a known limitation, the limitation itself is pinned down so regressions surface.

const globalAny = globalThis as Record<string, unknown>;

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

describe("Universal runtime robustness", () => {
  describe("React Native / Hermes stack frames (browser-style parsing)", () => {
    test("parses a Hermes '@'-style frame and ignores a 'native' frame without throwing", () => {
      withStubbedGlobals(() => {
        globalAny.window = {};
        globalAny.document = {};
        vi.stubGlobal("navigator", { userAgent: "Hermes ReactNative" });

        const env = createUniversalEnvironment();
        const error = { stack: "Error: boom\n    at apply (native)\nbar@/data/app.js:10:5" } as Error;

        let frames: IStackFrame[] = [];
        expect(() => {
          frames = env.getErrorTrace(error);
        }).not.toThrow();

        // "at apply (native)" has no parseable file path and is dropped; only the "@" frame survives.
        expect(frames).toHaveLength(1);
        expect(frames[0]?.filePath).toBe("/data/app.js");
        expect(frames[0]?.fileLine).toBe("10");
        expect(frames[0]?.fileColumn).toBe("5");
        expect(frames[0]?.fileName).toBe("app.js");
      });
    });

    test("Safari 'global code' frame is parsed; method stays undefined for browser frames", () => {
      withStubbedGlobals(() => {
        // Simulate a web worker so browser stack parsing is used.
        delete globalAny.window;
        delete globalAny.document;
        globalAny.importScripts = function importScripts() {};
        vi.stubGlobal("navigator", { userAgent: "Safari" });

        const env = createUniversalEnvironment();
        const error = { stack: "Error\nglobal code@https://example.com/app.js:5:1" } as Error;
        const frames = env.getErrorTrace(error);

        expect(frames).toHaveLength(1);
        expect(frames[0]?.fileLine).toBe("5");
        expect(frames[0]?.fileColumn).toBe("1");
        expect(frames[0]?.fileName).toBe("app.js");
        // parseBrowserStackLine never assigns a method.
        expect(frames[0]?.method).toBeUndefined();
      });
    });

    test("Firefox async frame yields path, line and column (host kept in path by current regex)", () => {
      withStubbedGlobals(() => {
        delete globalAny.window;
        delete globalAny.document;
        globalAny.importScripts = function importScripts() {};
        vi.stubGlobal("navigator", { userAgent: "Firefox" });

        const env = createUniversalEnvironment();
        const error = { stack: "Error\nasyncFn@https://example.com/script.js:42:15" } as Error;
        const frames = env.getErrorTrace(error);

        expect(frames).toHaveLength(1);
        // BROWSER_PATH_REGEX captures from the first slash after the scheme, so the host
        // ("example.com") is retained as the first path segment. This is the current behavior.
        expect(frames[0]?.filePath).toBe("/example.com/script.js");
        expect(frames[0]?.fileLine).toBe("42");
        expect(frames[0]?.fileColumn).toBe("15");
        expect(frames[0]?.fileName).toBe("script.js");
      });
    });
  });

  describe("Edge runtime (Cloudflare Worker-like: no process/window/Deno/Bun)", () => {
    test("runtime is 'unknown' and JSON transport still emits valid JSON", () => {
      withStubbedGlobals(() => {
        // Cloudflare Workers expose none of the runtime markers tslog probes for.
        delete globalAny.window;
        delete globalAny.document;
        delete globalAny.location;
        delete globalAny.Deno;
        delete globalAny.Bun;
        delete globalAny.importScripts;
        // process cannot truly be deleted under the Node test runner; explicitly nulling it
        // drives detectRuntimeInfo() down the "unknown" branch.
        globalAny.process = undefined;

        const calls: unknown[][] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
          calls.push(args);
        });

        let runtime: unknown;
        let output = "";
        try {
          const env = createUniversalEnvironment();
          const meta = env.getMeta(3, "INFO", Number.NaN, false) as { runtime?: unknown };
          runtime = meta.runtime;

          expect(() => {
            env.transportJSON({ msg: "hi", _meta: {} } as never);
          }).not.toThrow();

          output = String(calls[0]?.[0]);
        } finally {
          spy.mockRestore();
        }

        expect(runtime).toBe("unknown");
        expect(output).toContain("hi");
        // The transport output must be parseable JSON.
        expect(() => JSON.parse(output)).not.toThrow();
        expect(JSON.parse(output)).toMatchObject({ msg: "hi" });
      });
    });
  });

  describe("Binary and exotic values", () => {
    test("isBuffer(new Uint8Array()) is false and logging a Uint8Array does not crash", () => {
      const env = createUniversalEnvironment();
      expect(env.isBuffer(new Uint8Array())).toBe(false);

      const transports: Record<string, unknown>[] = [];
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport((logObj) => transports.push(logObj as Record<string, unknown>));

      expect(() => {
        logger.info(new Uint8Array([1, 2, 3]));
      }).not.toThrow();

      const captured = transports[0];
      expect(captured).toBeDefined();
      // A single non-Buffer Uint8Array is spread into indexed keys (like an array-like object).
      const serialized = jsonStringifyRecursive(captured);
      expect(() => JSON.parse(serialized)).not.toThrow();
      const parsed = JSON.parse(serialized) as Record<string, unknown>;
      expect(parsed["0"]).toBe(1);
      expect(parsed["1"]).toBe(2);
      expect(parsed["2"]).toBe(3);
    });

    test("WeakMap, WeakSet and a throwing Proxy can be logged without throwing", () => {
      const transports: Record<string, unknown>[] = [];
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport((logObj) => transports.push(logObj as Record<string, unknown>));

      const throwingProxy = new Proxy(
        {},
        {
          get() {
            throw new Error("trap");
          },
        },
      );

      expect(() => {
        logger.info({ wm: new WeakMap(), ws: new WeakSet(), px: throwingProxy });
      }).not.toThrow();

      const captured = transports[0];
      expect(captured).toBeDefined();
      expect(Object.keys(captured)).toEqual(expect.arrayContaining(["wm", "ws", "px"]));
    });

    test("jsonStringifyRecursive handles BigInt, Symbol, undefined and circular references", () => {
      const out = jsonStringifyRecursive({ big: 10n, sym: Symbol("s"), u: undefined });
      const parsed = JSON.parse(out) as Record<string, unknown>;

      // BigInt is rendered as its string form.
      expect(parsed.big).toBe("10");
      // undefined is preserved as an explicit marker rather than being dropped.
      expect(parsed.u).toBe("[undefined]");
      // JSON.stringify omits symbol-valued properties; the recursive helper keeps that behavior.
      expect("sym" in parsed).toBe(false);
      expect(typeof out).toBe("string");

      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      const circularOut = jsonStringifyRecursive(circular);
      expect(JSON.parse(circularOut)).toEqual({ a: 1, self: "[Circular]" });
    });
  });

  describe("Deeply nested structures", () => {
    test("a 500-level deep object renders in pretty mode quickly without stack overflow", () => {
      let nested: Record<string, unknown> = { value: 0 };
      for (let depth = 0; depth < 500; depth += 1) {
        nested = { child: nested, depth };
      }

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const logger = new Logger({ type: "pretty", stylePrettyLogs: false });

      const start = Date.now();
      let result: unknown;
      try {
        expect(() => {
          result = logger.info(nested);
        }).not.toThrow();
      } finally {
        spy.mockRestore();
      }

      expect(result).toBeDefined();
      expect(Date.now() - start).toBeLessThan(2000);
    });
  });

  describe("Error cause chains", () => {
    function buildCauseChain(length: number): Error {
      let error = new Error(`e${length}`);
      for (let index = length - 1; index >= 1; index -= 1) {
        error = new Error(`e${index}`, { cause: error });
      }
      return error;
    }

    function walkCauseMessages(top: { message?: string; cause?: { message?: string; cause?: unknown } }): string[] {
      const messages: string[] = [];
      let node: { message?: string; cause?: unknown } | undefined = top;
      while (node?.cause != null) {
        const cause = node.cause as { message?: string; cause?: unknown };
        messages.push(cause.message ?? "");
        node = cause;
      }
      return messages;
    }

    test("a 5-deep cause chain is fully present", () => {
      const transports: Record<string, unknown>[] = [];
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport((logObj) => transports.push(logObj as Record<string, unknown>));

      logger.error(buildCauseChain(5));

      const top = transports[0] as { message?: string; cause?: { message?: string } };
      expect(top.message).toBe("e1");
      // e1 plus four nested causes e2..e5 — all five errors present.
      expect(walkCauseMessages(top)).toEqual(["e2", "e3", "e4", "e5"]);
    });

    test("a 6-deep cause chain keeps the 6th error but caps deeper traversal", () => {
      const transports: Record<string, unknown>[] = [];
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport((logObj) => transports.push(logObj as Record<string, unknown>));

      logger.error(buildCauseChain(6));

      const top = transports[0] as { message?: string; cause?: { message?: string; cause?: unknown } };
      const messages = walkCauseMessages(top);
      // maxErrorCauseDepth === 5: the deepest error (e6) is still attached, but _toErrorObject
      // returns early at that depth so e6 carries no further cause.
      expect(messages).toEqual(["e2", "e3", "e4", "e5", "e6"]);

      let deepest = top.cause as { message?: string; cause?: unknown } | undefined;
      while (deepest?.cause != null) {
        deepest = deepest.cause as { message?: string; cause?: unknown };
      }
      expect(deepest?.message).toBe("e6");
      expect(deepest?.cause).toBeUndefined();
    });
  });

  describe("minLevel boundaries", () => {
    test("minLevel 0 logs silly", () => {
      const logger = new Logger({ type: "hidden", minLevel: 0 });
      expect(logger.silly("x")).toBeDefined();
    });

    test("minLevel 7 suppresses fatal (level 6)", () => {
      const logger = new Logger({ type: "hidden", minLevel: 7 });
      expect(logger.fatal("x")).toBeUndefined();
    });

    test("a level equal to minLevel is logged and a level below it is suppressed", () => {
      const logger = new Logger({ type: "hidden", minLevel: 3 });
      // logLevelId === minLevel → logged
      expect(logger.info("x")).toBeDefined();
      // logLevelId < minLevel → suppressed
      expect(logger.debug("x")).toBeUndefined();
    });
  });

  describe("Hostile process.cwd()", () => {
    test("a throwing process.cwd does not crash logging and paths still render", () => {
      withStubbedGlobals(() => {
        const realProcess = globalAny.process as Record<string, unknown>;
        // Preserve everything except cwd, which now throws like a sandboxed permission error.
        globalAny.process = {
          ...realProcess,
          cwd: () => {
            throw new Error("EACCES");
          },
        };

        // v5 (BC11): the cwd cache lives inside the provider closure and there is no public reset
        // hook anymore. Constructing a fresh provider AFTER stubbing process.cwd gives us a clean,
        // uncached cwd: the first stack parse calls safeGetCwd(), which catches the throwing cwd and
        // returns undefined.
        const env = createUniversalEnvironment();

        const error = new Error("server failure");
        let frames: IStackFrame[] = [];
        expect(() => {
          frames = env.getErrorTrace(error);
        }).not.toThrow();

        expect(frames.length).toBeGreaterThan(0);
        // safeGetCwd() returned undefined, so paths are not stripped to a relative form;
        // the absolute file path is still rendered.
        expect(frames[0]?.filePath).toBeTruthy();
        expect(frames.some((frame) => (frame.fileName ?? "").length > 0)).toBe(true);
      });
    });
  });

  describe("Concurrent sub-loggers", () => {
    test("50 sub-loggers keep isolated prefixes and names without leaking into the parent", () => {
      const parent = new Logger({ type: "hidden", name: "root", prefix: ["ROOT"] });

      const subLoggers: Logger<unknown>[] = [];
      for (let index = 0; index < 50; index += 1) {
        subLoggers.push(parent.getSubLogger({ name: `sub${index}`, prefix: [`P${index}`] }) as Logger<unknown>);
      }

      // Attach transports only AFTER all sub-loggers are created so each logger owns a
      // distinct transport set (sub-loggers copy already-attached transports at creation time).
      const parentCaptured: Record<string, unknown>[] = [];
      parent.attachTransport((logObj) => parentCaptured.push(logObj as Record<string, unknown>));

      const subCaptured: Record<string, unknown>[][] = [];
      for (let index = 0; index < 50; index += 1) {
        const captured: Record<string, unknown>[] = [];
        subLoggers[index].attachTransport((logObj) => captured.push(logObj as Record<string, unknown>));
        subCaptured.push(captured);
      }

      for (let index = 0; index < 50; index += 1) {
        subLoggers[index].info(`m${index}`);
      }

      for (let index = 0; index < 50; index += 1) {
        const captured = subCaptured[index];
        expect(captured).toHaveLength(1);
        const logObj = captured[0] as Record<string, unknown> & { _meta: { name?: string; parentNames?: string[] } };
        // Prefix order must be parent-prefix first, then this sub's prefix, then the message.
        expect(logObj["0"]).toBe("ROOT");
        expect(logObj["1"]).toBe(`P${index}`);
        expect(logObj["2"]).toBe(`m${index}`);
        expect(logObj._meta.name).toBe(`sub${index}`);
        expect(logObj._meta.parentNames).toEqual(["root"]);
      }

      // The parent received none of the sub-logger output.
      expect(parentCaptured).toHaveLength(0);

      // The parent still logs correctly with only its own prefix/name.
      parent.info("done");
      expect(parentCaptured).toHaveLength(1);
      const parentLog = parentCaptured[0] as Record<string, unknown> & { _meta: { name?: string } };
      expect(parentLog["0"]).toBe("ROOT");
      expect(parentLog["1"]).toBe("done");
      expect(parentLog["2"]).toBeUndefined();
      expect(parentLog._meta.name).toBe("root");
    });
  });
});
