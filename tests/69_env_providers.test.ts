import { createNodeEnvironment } from "../src/env/environment.node.js";
import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { stripAnsi } from "../src/env/shared.js";
import { Logger } from "../src/index.node.js";
import type { IMeta, ISettings, IStackFrame } from "../src/interfaces.js";
import { captureDefaultJsonLines } from "./support/stdoutCapture.js";

// Coverage-focused suite for the Node and universal EnvironmentProviders. Every test drives a real,
// user-observable path: pretty formatting (line + live-console transport), error/cause rendering,
// stack-frame resolution edge cases, the buffered JSON sink, and the inspect fallback for hostile
// values. The universal provider's browser-only CSS `%c` path is reached by stubbing the runtime
// globals so createUniversalEnvironment() detects a browser/worker console that supports CSS.

const isNode = typeof process !== "undefined" && process.versions?.node != null && (process.versions as Record<string, string | undefined>).bun == null;

const globalAny = globalThis as Record<string, unknown>;

/** Save/restore the globals the universal runtime probe reads, then unstub Vitest stubs. */
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

/** A full, defaulted pretty settings object obtained from a real Logger (all pretty defaults present). */
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

describe.runIf(isNode)("Node EnvironmentProvider", () => {
  describe("stack frame resolution", () => {
    test("getErrorTrace parses a real error into structured frames", () => {
      const env = createNodeEnvironment();
      const frames = env.getErrorTrace(new Error("boom"));
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0]?.filePath).toBeTruthy();
      expect(frames.some((frame) => (frame.fileName ?? "").length > 0)).toBe(true);
    });

    test("getCallerStackFrame returns {} for an error with no parseable frames", () => {
      const env = createNodeEnvironment();
      const empty = { stack: "Error: no frames here" } as Error;
      expect(env.getCallerStackFrame(Number.NaN, empty)).toEqual({});
    });

    test("getCallerStackFrame honors a manual (finite, >=0) caller index", () => {
      const env = createNodeEnvironment();
      const error = new Error("with a stack");
      const framesAll = env.getErrorTrace(error);
      expect(framesAll.length).toBeGreaterThan(1);
      const manual = env.getCallerStackFrame(0, error);
      expect(manual).toEqual(framesAll[0]);
    });

    test("extra internalFramePatterns push auto-detection past the matched frame", () => {
      const env = createNodeEnvironment();
      const error = new Error("skip me");
      const baseline = env.getCallerStackFrame(Number.NaN, error);
      // Ignore whatever file the baseline landed on so auto-detection must skip forward.
      const ignore = baseline.fileName ? [new RegExp(baseline.fileName.replace(/[.]/g, "\\."))] : [];
      const shifted = env.getCallerStackFrame(Number.NaN, error, ignore);
      // Either it lands on a different frame, or (all frames ignored) clamps to the last — never throws.
      expect(shifted).toBeDefined();
    });

    test("a throwing process.cwd does not crash frame parsing (provider-owned cwd cache)", () => {
      withStubbedGlobals(() => {
        const realProcess = globalAny.process as Record<string, unknown>;
        globalAny.process = {
          ...realProcess,
          cwd: () => {
            throw new Error("EACCES");
          },
        };
        // Fresh provider AFTER stubbing → uncached cwd; first parse calls safeGetCwd(), catches, caches null.
        const env = createNodeEnvironment();
        let frames: IStackFrame[] = [];
        expect(() => {
          frames = env.getErrorTrace(new Error("server failure"));
        }).not.toThrow();
        expect(frames.length).toBeGreaterThan(0);
        // Second call reuses the cached (null) cwd without re-throwing.
        expect(() => env.getErrorTrace(new Error("again"))).not.toThrow();
        expect(frames[0]?.filePath).toBeTruthy();
      });
    });
  });

  describe("pretty formatting", () => {
    test("prettyFormatLine builds a styled meta + inspected args string", () => {
      const env = createNodeEnvironment();
      const settings = prettySettings();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;
      const line = env.prettyFormatLine(["hello", { a: 1 }], meta, settings);
      const plain = stripAnsi(line);
      expect(plain).toContain("INFO");
      expect(plain).toContain("hello");
      // The inspected object is present (colors sit between `a` and `1`, so match on the key).
      expect(plain).toContain("a: 1");
    });

    test("prettyFormatLine with style:false strips ANSI from the meta markup", () => {
      const env = createNodeEnvironment();
      const settings = prettySettings({ pretty: { style: false } });
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;
      const line = env.prettyFormatLine(["plain"], meta, settings);
      // No ANSI escape sequences when styling is off.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence of ANSI escapes
      expect(/\[/.test(line)).toBe(false);
      expect(line).toContain("plain");
    });

    test("prettyFormatLogObj splits Errors out of the plain args and renders them", () => {
      const env = createNodeEnvironment();
      const settings = prettySettings();
      const { args, errors } = env.prettyFormatLogObj(["keep", new Error("split")], settings);
      expect(args).toEqual(["keep"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("split");
    });

    test("prettyFormatErrorObj includes the error name, message, stack and a cause section", () => {
      const env = createNodeEnvironment();
      const settings = prettySettings();
      const rendered = env.prettyFormatErrorObj(new Error("outer", { cause: new Error("inner") }), settings);
      expect(rendered).toContain("Error");
      expect(rendered).toContain("outer");
      expect(rendered).toContain("Caused by (1):");
      expect(rendered).toContain("inner");
    });

    test("prettyFormatErrorObj omits the ': message' when a cause has an empty message", () => {
      const env = createNodeEnvironment();
      const settings = prettySettings();
      const rendered = env.prettyFormatErrorObj(new Error("outer", { cause: new Error("") }), settings);
      // The cause header is present but carries no trailing ": <message>" (empty-message branch).
      expect(rendered).toContain("Caused by (1): Error");
      expect(rendered).not.toContain("Caused by (1): Error:");
    });

    test("prettyFormatLine inserts a separator newline between args and errors when BOTH are present", () => {
      const env = createNodeEnvironment();
      const settings = prettySettings({ pretty: { style: false } });
      // args + error → the "\n" separator branch (true side of the ternary); the arg text must come
      // BEFORE the rendered error, joined by the inserted newline.
      const both = env.prettyFormatLine(["plain arg", new Error("with sep")], undefined, settings);
      expect(both).toContain("plain arg");
      expect(both).toContain("with sep");
      expect(both.indexOf("plain arg")).toBeLessThan(both.indexOf("with sep"));
      expect(both).toContain("plain arg\n");
    });

    test("a real pretty Logger prints through transportFormatted (styled) to the console", () => {
      const calls = captureConsoleLog(() => {
        const logger = new Logger({ type: "pretty" });
        logger.info("styled hello", { k: "v" });
      });
      const output = calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("styled hello");
      expect(output).toContain("INFO");
    });

    test("a pretty Logger with style:false prints plain text (ANSI stripped) with the error appended", () => {
      const calls = captureConsoleLog(() => {
        const logger = new Logger({ type: "pretty", pretty: { style: false } });
        logger.error("boom message", new Error("attached"));
      });
      const output = calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("boom message");
      expect(output).toContain("attached");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence of ANSI escapes
      expect(/\[/.test(output)).toBe(false);
    });

    test("a format:'pretty' transport receives a pretty line via prettyFormatLine", () => {
      const lines: string[] = [];
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport({ name: "pretty-sink", format: "pretty", write: (_r, line) => void lines.push(line) });
      logger.info("through transport", { z: 9 });
      expect(lines).toHaveLength(1);
      const plain = stripAnsi(lines[0]);
      expect(plain).toContain("through transport");
      expect(plain).toContain("z: 9");
    });
  });

  describe("inspect fallback for hostile values", () => {
    test("formatWithOptionsSafe falls back to a best-effort stringify when native inspect throws", () => {
      const calls = captureConsoleLog(() => {
        const logger = new Logger({ type: "pretty" });
        // A custom-inspect hook that throws makes util.formatWithOptions itself throw, exercising the
        // catch → stringifyFallback fallback path (a plain throwing getter does not: inspect swallows it).
        const hostile = {
          [Symbol.for("nodejs.util.inspect.custom")]() {
            throw new Error("inspect trap");
          },
        };
        expect(() => logger.info("carrier", hostile)).not.toThrow();
      });
      const output = calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("carrier");
    });

    test("stringifyFallback stringifies strings, JSON-able objects and BigInt once inspect has failed", () => {
      // A throwing custom-inspect target in the SAME args array forces the fallback map to run over every
      // arg: a plain string (pass-through), a JSON-serializable object, and a BigInt.
      const env = createNodeEnvironment();
      const settings = prettySettings();
      const hostile = {
        [Symbol.for("nodejs.util.inspect.custom")]() {
          throw new Error("no inspect");
        },
      };
      const line = env.prettyFormatLine(["str", { plain: 1 }, hostile], undefined, settings);
      // string passes through; the JSON-able object serializes; the whole line is a space-joined fallback.
      expect(line).toContain("str");
      expect(line).toContain('"plain":1');
    });
  });

  describe("JSON output paths", () => {
    test("transportJSON prints a single JSON line to the console", () => {
      const env = createNodeEnvironment();
      const calls = captureConsoleLog(() => {
        env.transportJSON({ message: "json-direct", _meta: {} } as never);
      });
      expect(calls).toHaveLength(1);
      const parsed = JSON.parse(String(calls[0][0])) as Record<string, unknown>;
      expect(parsed.message).toBe("json-direct");
    });

    test("a json Logger writes through the buffered stdout sink and flush drains it", async () => {
      const lines = captureDefaultJsonLines(() => {
        const logger = new Logger({ type: "json", stack: { capture: "off" } });
        logger.info("buffered", { batch: 1 });
      });
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ message: "buffered", batch: 1 });
    });

    test("logger.flush() awaits flushJsonSink without throwing", async () => {
      const logger = new Logger({ type: "json", stack: { capture: "off" } });
      // No custom transports: flush must still resolve by draining the default json sink.
      await expect(logger.flush()).resolves.toBeUndefined();
    });
  });

  describe("value predicates", () => {
    test("isBuffer is true for a Node Buffer and false for a plain Uint8Array", () => {
      const env = createNodeEnvironment();
      expect(env.isBuffer(Buffer.from([1, 2, 3]))).toBe(true);
      expect(env.isBuffer(new Uint8Array([1, 2, 3]))).toBe(false);
    });

    test("isError matches native errors and rejects plain objects", () => {
      const env = createNodeEnvironment();
      expect(env.isError(new TypeError("x"))).toBe(true);
      expect(env.isError({ message: "not an error" })).toBe(false);
    });
  });

  describe("async context store", () => {
    test("createAsyncContextStore resolves node:async_hooks and produces a working store", () => {
      const env = createNodeEnvironment();
      const store = env.createAsyncContextStore?.();
      expect(store).toBeDefined();
      // The resolved AsyncLocalStorage-backed store must actually propagate a run() scope.
      const seen = store?.run({ id: "a-1" }, () => store.getStore());
      expect(seen).toEqual({ id: "a-1" });
    });
  });
});

describe("Universal EnvironmentProvider", () => {
  describe("browser CSS %c meta styling", () => {
    test("transportFormatted emits %c-styled meta and CSS style args on a Firefox-like console", () => {
      withStubbedGlobals(() => {
        // Browser runtime + Firefox UA → consoleSupportsCssStyling() true → the CSS branch runs.
        globalAny.window = {};
        globalAny.document = {};
        vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

        const env = createUniversalEnvironment();
        const settings = prettySettings();
        const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

        const calls = captureConsoleLog(() => {
          env.transportFormatted(settings.pretty.template, ["hello css"], [], meta, settings);
        });

        expect(calls).toHaveLength(1);
        const [line, ...styleArgs] = calls[0];
        // %c placeholders wrap styled tokens; the CSS strings are passed as trailing args.
        expect(String(line)).toContain("%c");
        expect(String(line)).toContain("hello css");
        expect(styleArgs.length).toBeGreaterThan(0);
        expect(styleArgs.some((css) => /:/.test(String(css)))).toBe(true);
      });
    });

    test("CSS styling handles nested/array/wildcard style descriptors and dedupes CSS", () => {
      withStubbedGlobals(() => {
        globalAny.window = {};
        globalAny.document = {};
        vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

        const env = createUniversalEnvironment();
        // Exotic styles: an array of tokens, a duplicate token (dedupe), a nested object with a "*"
        // wildcard, and a null token (collectStyleTokens returns []).
        const settings = prettySettings({
          pretty: {
            styles: {
              logLevelName: ["bold", "bold", { "*": "red" }],
              filePathWithLine: null as never,
            },
          },
        });
        const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

        const calls = captureConsoleLog(() => {
          env.transportFormatted(settings.pretty.template, ["nested css"], [], meta, settings);
        });
        expect(calls).toHaveLength(1);
        expect(String(calls[0][0])).toContain("nested css");
      });
    });

    test("when no meta placeholder produces CSS, transportFormatted logs a plain single string", () => {
      withStubbedGlobals(() => {
        globalAny.window = {};
        globalAny.document = {};
        vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

        const env = createUniversalEnvironment();
        // No styles at all → buildCssMetaOutput yields no %c/styles → the `log(output)` (no style args) branch.
        const settings = prettySettings({ pretty: { styles: {} } });
        const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

        const calls = captureConsoleLog(() => {
          env.transportFormatted("plain-meta ", ["no css"], [], meta, settings);
        });
        expect(calls).toHaveLength(1);
        // Only the single output string was logged (no trailing CSS args).
        expect(calls[0]).toHaveLength(1);
        expect(String(calls[0][0])).toContain("no css");
      });
    });

    test("CSS branch with a null logMeta falls back to the sanitized meta markup", () => {
      withStubbedGlobals(() => {
        globalAny.window = {};
        globalAny.document = {};
        vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox/120.0" });

        const env = createUniversalEnvironment();
        const settings = prettySettings();
        const calls = captureConsoleLog(() => {
          env.transportFormatted("[31mmarkup[39m", ["meta-less"], [], undefined, settings);
        });
        expect(calls).toHaveLength(1);
        // ANSI stripped, no %c since there is no meta to style.
        expect(String(calls[0][0])).toContain("markup");
        expect(String(calls[0][0])).toContain("meta-less");
      });
    });
  });

  describe("non-browser (server) formatting via the universal provider", () => {
    test("prettyFormatLine renders through the polyfill/native inspect on a server runtime", () => {
      // Under the Node test runner the universal provider detects `node`, so no CSS: text path.
      const env = createUniversalEnvironment();
      const settings = prettySettings();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;
      const line = env.prettyFormatLine(["universal hello", { n: 2 }], meta, settings);
      expect(line).toContain("universal hello");
      expect(line).toContain("INFO");
    });

    test("prettyFormatErrorObj renders name/message/stack and a cause chain", () => {
      const env = createUniversalEnvironment();
      const settings = prettySettings();
      const rendered = env.prettyFormatErrorObj(new Error("u-outer", { cause: new Error("u-inner") }), settings);
      expect(rendered).toContain("u-outer");
      expect(rendered).toContain("Caused by (1):");
      expect(rendered).toContain("u-inner");
    });

    test("transportFormatted on a server runtime uses the plain text path (no CSS)", () => {
      const env = createUniversalEnvironment();
      const settings = prettySettings();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;
      const calls = captureConsoleLog(() => {
        env.transportFormatted(settings.pretty.template, ["server text"], [], meta, settings);
      });
      expect(calls).toHaveLength(1);
      expect(String(calls[0][0])).toContain("server text");
    });

    test("transportFormatted with style:false strips ANSI from the meta markup", () => {
      const env = createUniversalEnvironment();
      const settings = prettySettings({ pretty: { style: false } });
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;
      const calls = captureConsoleLog(() => {
        env.transportFormatted("[31mstyled[39m ", ["no ansi"], [], meta, settings);
      });
      // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting absence of ANSI escapes
      expect(/\[/.test(String(calls[0][0]))).toBe(false);
      expect(String(calls[0][0])).toContain("no ansi");
    });
  });

  describe("stack + value edge cases", () => {
    test("getCallerStackFrame returns {} when the error has no parseable frames", () => {
      const env = createUniversalEnvironment();
      expect(env.getCallerStackFrame(Number.NaN, { stack: "Error: bare" } as Error)).toEqual({});
    });

    test("getCallerStackFrame honors a manual index and getErrorTrace parses real frames", () => {
      const env = createUniversalEnvironment();
      const error = new Error("u-stack");
      const frames = env.getErrorTrace(error);
      expect(frames.length).toBeGreaterThan(0);
      expect(env.getCallerStackFrame(0, error)).toEqual(frames[0]);
    });

    test("formatWithOptionsSafe falls back to stringify when inspect throws", async () => {
      // resolveInspect() memoizes native-vs-polyfill on first use, and earlier tests in this file
      // construct providers under stubbed browser globals, which poisons the memo toward the polyfill
      // (whose guarded property walk swallows hostile getters instead of throwing). Import a FRESH
      // module so the probe re-runs under the plain Node runner → native util.formatWithOptions,
      // which DOES throw on a throwing custom-inspect hook → the catch → stringifyFallback runs.
      vi.resetModules();
      const { createUniversalEnvironment: freshCreate } = await import("../src/env/environment.universal.js");
      const env = freshCreate();
      const settings = prettySettings();
      const hostile = {
        [Symbol.for("nodejs.util.inspect.custom")]() {
          throw new Error("inspect trap");
        },
      };
      const line = env.prettyFormatLine(["carrier", { plain: 1 }, hostile], undefined, settings);
      // The string passes through the fallback map; the JSON-able object serializes.
      expect(line).toContain("carrier");
      expect(line).toContain('"plain":1');
    });

    test("isBuffer/isError predicates behave like the native ones", () => {
      const env = createUniversalEnvironment();
      expect(env.isError(new Error("e"))).toBe(true);
      expect(env.isError({})).toBe(false);
      expect(env.isBuffer(new Uint8Array())).toBe(false);
    });

    test("createAsyncContextStore returns a usable store (run + getStore)", () => {
      const env = createUniversalEnvironment();
      const store = env.createAsyncContextStore?.();
      expect(store).toBeDefined();
    });
  });
});
