import { createSlimEnvironment } from "../src/env/environment.slim.js";
import { BaseLogger, createNodeEnvironment, Logger as FullLogger, fullCoreFeatures } from "../src/index.node.js";
import type { IMeta, ISettings } from "../src/interfaces.js";
import { createLogger, Logger as SlimLogger } from "../src/subpaths/slim.js";
import { captureDefaultJsonLines } from "./support/stdoutCapture.js";

// A resolved settings object to feed the provider methods directly (the pipeline hands them exactly
// this). Sourced from a real slim Logger so it carries the true resolved shape, not a hand-fake.
function slimSettings(): ISettings<Record<string, unknown>> {
  return new SlimLogger<Record<string, unknown>>({ type: "hidden" }).settings as unknown as ISettings<Record<string, unknown>>;
}

// tslog/slim (S1): the same structured-JSON pipeline as the full entries, minus masking, pretty
// output, stack capture, and settings validation — with HONEST failures (throws) where a silently
// ignored setting would be dangerous, and byte-compatible JSON for everything it keeps.

type AnyRecord = Record<string, unknown> & { _logMeta: IMeta & Record<string, unknown> };

// Captures both sink targets: slim prints via console.log, the full Node logger via the buffered
// stdout sink (process.stdout.write).
function captureJsonLine(run: (spy: () => void) => void): string {
  const lines = captureDefaultJsonLines(() => {
    run(() => undefined);
  });
  expect(lines).toHaveLength(1);
  return lines[0];
}

/** Parse a JSON line and drop the per-call timestamps so slim/full outputs compare structurally. */
function parsedWithoutDate(line: string): unknown {
  const obj = JSON.parse(line) as AnyRecord;
  delete (obj._logMeta as Record<string, unknown>).date;
  delete obj.time;
  return obj;
}

describe("tslog/slim JSON parity with the full logger", () => {
  const shapes: Array<{ label: string; args: unknown[] }> = [
    { label: "bare message", args: ["hello"] },
    { label: "message + fields (spread)", args: ["hello", { a: 1, nested: { b: true } }] },
    { label: "single object (fields-first)", args: [{ userId: 42, action: "login" }] },
    { label: "pino shape (object, message)", args: [{ tenant: "acme" }, "hello"] },
    { label: "positional extras", args: ["msg", 1, "two", [3]] },
  ];

  for (const { label, args } of shapes) {
    test(`identical line structure for: ${label}`, () => {
      const slim = new SlimLogger({ name: "parity", bindings: { service: "x" } });
      const full = new FullLogger({ type: "json", name: "parity", bindings: { service: "x" }, stack: { capture: "off" } });

      const slimLine = captureJsonLine(() => slim.info(...(args as [string])));
      const fullLine = captureJsonLine(() => full.info(...(args as [string])));

      expect(parsedWithoutDate(slimLine)).toEqual(parsedWithoutDate(fullLine));
      // Key ORDER matters for downstream consumers: compare it too (dates stripped).
      const keysOf = (line: string): string => Object.keys(JSON.parse(line) as AnyRecord).join(",");
      expect(keysOf(slimLine)).toBe(keysOf(fullLine));
    });
  }

  test("default type is json (no env-aware TTY detection) and hidden is allowed", () => {
    const logger = new SlimLogger({ minLevel: "FATAL" });
    expect(logger.settings.type).toBe("json");
    const hidden = new SlimLogger({ type: "hidden" });
    expect(hidden.info("no console output")).toBeDefined();
  });
});

describe("tslog/slim honest rejections", () => {
  test("mask settings throw instead of silently logging secrets in plaintext", () => {
    expect(() => new SlimLogger({ mask: { keys: ["password"] } })).toThrow(/masking/);
    expect(() => new SlimLogger({ mask: { keys: ["password"] } })).toThrow(/plaintext/);
  });

  test("an empty mask group is inert and accepted", () => {
    expect(() => new SlimLogger({ type: "hidden", mask: {} })).not.toThrow();
  });

  test("pretty output is rejected", () => {
    expect(() => new SlimLogger({ type: "pretty" })).toThrow(/pretty/);
    expect(() => new SlimLogger({ pretty: { enabled: true } })).toThrow(/pretty/);
  });

  test("stack settings are accepted but _logMeta.path is never attached", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden", stack: { capture: "full" } });
    const record = logger.info("no stack");
    expect(record?._logMeta).toBeDefined();
    expect("path" in (record?._logMeta as object)).toBe(false);
  });
});

describe("direct BaseLogger construction without a feature set", () => {
  test("active mask settings, pretty type, and strictConfig are rejected loudly", () => {
    const env = createNodeEnvironment();
    expect(() => new BaseLogger({ mask: { keys: ["password"] } }, undefined, env)).toThrow(/plaintext/);
    expect(() => new BaseLogger({ type: "pretty" }, undefined, env)).toThrow(/pretty/);
    expect(() => new BaseLogger({ type: "hidden", strictConfig: true }, undefined, env)).toThrow(/validation/);
  });

  test("passing the exported fullCoreFeatures restores the complete behavior", () => {
    const logger = new BaseLogger<Record<string, unknown>>(
      { type: "hidden", mask: { keys: ["password"] } },
      undefined,
      createNodeEnvironment(),
      Number.NaN,
      fullCoreFeatures,
    );
    const record = logger.log(3, "INFO", { password: "hunter2", user: "jane" });
    expect(JSON.stringify(record)).toContain('"password":"[***]"');
    expect(JSON.stringify(record)).toContain('"user":"jane"');
  });
});

describe("tslog/slim keeps the rest of the pipeline", () => {
  test("errors keep name/message/cause with an empty stack array in the JSON line", () => {
    const logger = new SlimLogger<AnyRecord>({ name: "err" });
    const line = captureJsonLine(() => logger.error(new Error("boom", { cause: new Error("root") })));
    const parsed = JSON.parse(line) as { error: Record<string, unknown> };
    expect(parsed.error.message).toBe("boom");
    expect(parsed.error.stack).toEqual([]);
    const cause = parsed.error.cause as Record<string, unknown>;
    expect(cause.message).toBe("root");
  });

  test("bindings merge down the sub-logger chain and _logMeta carries name/parentNames", () => {
    const root = new SlimLogger<AnyRecord>({ type: "hidden", name: "root", bindings: { tenant: "acme" } });
    const child = root.child({ name: "child", bindings: { requestId: "r-1" } });
    const record = child.info("nested");
    expect(record?.tenant).toBe("acme");
    expect(record?.requestId).toBe("r-1");
    expect(record?._logMeta.name).toBe("child");
    expect(record?._logMeta.parentNames).toEqual(["root"]);
  });

  test("custom levels install typed methods via createLogger", () => {
    const logger = createLogger({ type: "hidden", customLevels: { AUDIT: 7 } });
    const record = logger.audit("granted") as AnyRecord | undefined;
    expect(record?._logMeta.logLevelName).toBe("AUDIT");
    expect(record?._logMeta.logLevelId).toBe(7);
  });

  test("runInContext propagates onto _logMeta (auto-resolved AsyncLocalStorage)", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden" });
    const record = logger.runInContext({ requestId: "ctx-1" }, () => logger.info("in ctx"));
    expect(record?._logMeta.requestId).toBe("ctx-1");
  });

  test("middleware and minLevel filtering work", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden", minLevel: "WARN" });
    logger.use((ctx) => {
      ctx.meta.traceId = "t-1";
      return ctx;
    });
    expect(logger.info("below")).toBeUndefined();
    const record = logger.warn("kept");
    expect(record?._logMeta.traceId).toBe("t-1");
  });

  test("transports receive the record and a JSON line; a forced pretty format degrades without throwing", () => {
    const jsonLines: string[] = [];
    const prettyLines: string[] = [];
    const logger = new SlimLogger<AnyRecord>({ type: "hidden" });
    logger.attachTransport({ name: "json-sink", format: "json", write: (_record, line) => void jsonLines.push(line) });
    logger.attachTransport({ name: "pretty-sink", format: "pretty", write: (_record, line) => void prettyLines.push(line) });

    logger.info("shipped", { batch: 7 });
    expect(jsonLines).toHaveLength(1);
    expect(JSON.parse(jsonLines[0])).toMatchObject({ message: "shipped", batch: 7 });
    expect(prettyLines).toHaveLength(1);
    expect(prettyLines[0]).toContain("shipped");
  });

  test("post-construction mask mutation throws loudly instead of silently logging plaintext", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden" });
    expect(() => {
      (logger.settings.mask.keys as string[]).push("password");
    }).toThrow(TypeError);
    expect(() => {
      (logger.settings as { mask: object }).mask = { keys: ["password"] };
    }).toThrow(TypeError);
  });

  test("a prototype-held mask getter cannot sneak past the rejection (no settings spread)", () => {
    class ProtoConfig {
      get mask() {
        return { keys: ["password"] };
      }
    }
    expect(() => new SlimLogger(new ProtoConfig() as never)).toThrow(/masking/);
  });

  test("an error-like with hostile getters does not throw out of the log call on a pretty-format transport", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden" });
    logger.attachTransport({ name: "pretty-sink", format: "pretty", write: () => undefined });
    const hostile = {
      name: "HostileError",
      get message(): string {
        throw new Error("hostile message getter");
      },
    };
    Object.defineProperty(hostile, Symbol.toStringTag, { value: "Error" });
    expect(() => logger.error(hostile)).not.toThrow();
  });

  test("a top-level URL argument still expands to a plain object (identity-mask fast path)", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden" });
    const record = logger.info(new URL("https://example.com/path?q=1"));
    const url = record?.["0"] ?? record;
    expect(JSON.stringify(url)).toContain('"href":"https://example.com/path?q=1"');
  });
});

describe("tslog/slim every level method emits at the right id/name", () => {
  const cases: Array<{ method: "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal"; id: number; name: string }> = [
    { method: "silly", id: 0, name: "SILLY" },
    { method: "trace", id: 1, name: "TRACE" },
    { method: "debug", id: 2, name: "DEBUG" },
    { method: "info", id: 3, name: "INFO" },
    { method: "warn", id: 4, name: "WARN" },
    { method: "error", id: 5, name: "ERROR" },
    { method: "fatal", id: 6, name: "FATAL" },
  ];

  for (const { method, id, name } of cases) {
    test(`${method}() → id ${id}, name ${name}`, () => {
      const logger = new SlimLogger<AnyRecord>({ type: "hidden", minLevel: "SILLY" });
      // Single-object fields-first form merges `k` at the top level of the record.
      const record = logger[method]({ k: 1 });
      expect(record?._logMeta.logLevelId).toBe(id);
      expect(record?._logMeta.logLevelName).toBe(name);
      expect(record?.k).toBe(1);
    });
  }

  test("the numeric log() entry emits at an arbitrary id/name", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden" });
    const record = logger.log(3, "INFO", "direct") as AnyRecord | undefined;
    expect(record?._logMeta.logLevelId).toBe(3);
    expect(record?._logMeta.logLevelName).toBe("INFO");
  });
});

describe("tslog/slim getSubLogger override returns a slim Logger and merges settings", () => {
  test("getSubLogger (not the child alias) merges bindings and carries name/parentNames", () => {
    const root = new SlimLogger<AnyRecord>({ type: "hidden", name: "root", bindings: { tenant: "acme" } });
    const sub = root.getSubLogger({ name: "sub", bindings: { requestId: "r-9" } });
    expect(sub).toBeInstanceOf(SlimLogger);
    const record = sub.info("nested");
    expect(record?.tenant).toBe("acme");
    expect(record?.requestId).toBe("r-9");
    expect(record?._logMeta.name).toBe("sub");
    expect(record?._logMeta.parentNames).toEqual(["root"]);
  });

  test("a slim sub-logger's own mask group stays frozen (re-validated inert defaults)", () => {
    const root = new SlimLogger<AnyRecord>({ type: "hidden" });
    const sub = root.getSubLogger({ name: "s" });
    expect(() => {
      (sub.settings.mask.keys as string[]).push("password");
    }).toThrow(TypeError);
  });
});

describe("tslog/slim withJsonTypeDefault / validateSlimSettings null-settings paths", () => {
  test("no settings at all still defaults type to json and constructs cleanly", () => {
    const logger = new SlimLogger();
    expect(logger.settings.type).toBe("json");
  });

  test("createLogger with no settings defaults to json too", () => {
    const logger = createLogger();
    expect(logger.settings.type).toBe("json");
  });
});

// Direct EnvironmentProvider probes for members the slim pipeline cannot reach cleanly: Buffer
// handling with and without a Buffer global, hostile/empty error messages, the pretty stubs that
// only run when a transport forces `format: "pretty"` (slim rejects `type: "pretty"` at construction),
// and the two members with NO in-slim caller at all — getMeta never captures a caller frame and the
// default sink prints JSON without routing through the provider, so getCallerStackFrame/transportJSON
// are public EnvironmentProvider members only other entries route to; their contract is pinned by
// direct invocation. Everything else on the provider is asserted through the pipeline tests above.
describe("tslog/slim EnvironmentProvider methods in isolation", () => {
  test("getCallerStackFrame returns an empty frame (stack capture is dropped)", () => {
    expect(createSlimEnvironment().getCallerStackFrame(0)).toEqual({});
  });

  test("transportJSON prints one JSON line via console.log", () => {
    const env = createSlimEnvironment();
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      env.transportJSON({ message: "hi", _logMeta: { logLevelName: "INFO" } } as never);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(spy.mock.calls[0][0]))).toMatchObject({ message: "hi" });
    } finally {
      spy.mockRestore();
    }
  });

  test("isBuffer is true for a real Buffer and false for a plain value", () => {
    const env = createSlimEnvironment();
    // Node/Bun both expose Buffer, so the ternary's positive branch is live here.
    expect(env.isBuffer(Buffer.from("hi"))).toBe(true);
    expect(env.isBuffer("hi")).toBe(false);
    expect(env.isBuffer({})).toBe(false);
  });

  test("isBuffer degrades to false when Buffer is not present", () => {
    const env = createSlimEnvironment();
    const savedBuffer = (globalThis as { Buffer?: unknown }).Buffer;
    try {
      // Remove Buffer entirely so the `typeof Buffer !== "undefined"` guard takes its false branch.
      (globalThis as { Buffer?: unknown }).Buffer = undefined;
      expect(env.isBuffer(new Uint8Array([1, 2, 3]))).toBe(false);
    } finally {
      (globalThis as { Buffer?: unknown }).Buffer = savedBuffer;
    }
  });

  test("prettyFormatErrorObj renders name: message, and just the name when message is empty", () => {
    const env = createSlimEnvironment();
    const settings = slimSettings();
    expect(env.prettyFormatErrorObj(new Error("boom"), settings)).toBe("Error: boom");
    // Empty message exercises the `message ? ... : ""` false branch — name only, no trailing colon.
    const bare = new Error("");
    bare.name = "BareError";
    expect(env.prettyFormatErrorObj(bare, settings)).toBe("BareError");
  });

  test("prettyFormatLine prefixes the level when meta is present and splits errors out", () => {
    const env = createSlimEnvironment();
    const settings = slimSettings();
    const meta = { logLevelName: "WARN" } as unknown as IMeta;
    const line = env.prettyFormatLine(["hello", 42, new Error("boom")], meta, settings);
    expect(line).toContain("WARN\t");
    expect(line).toContain("hello");
    expect(line).toContain("42");
    expect(line).toContain("Error: boom");
  });

  test("transportFormatted prints meta markup + args + errors via console.log", () => {
    const env = createSlimEnvironment();
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      env.transportFormatted("MARK ", ["a", 1], ["Error: e"], undefined, slimSettings());
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe("MARK a 1 Error: e");
    } finally {
      spy.mockRestore();
    }
  });
});
