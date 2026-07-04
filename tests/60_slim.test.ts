import { BaseLogger, createNodeEnvironment, Logger as FullLogger, fullCoreFeatures } from "../src/index.node.js";
import type { IMeta } from "../src/interfaces.js";
import { createLogger, Logger as SlimLogger } from "../src/subpaths/slim.js";
import { captureDefaultJsonLines } from "./support/stdoutCapture.js";

// tslog/slim (S1): the same structured-JSON pipeline as the full entries, minus masking, pretty
// output, stack capture, and settings validation — with HONEST failures (throws) where a silently
// ignored setting would be dangerous, and byte-compatible JSON for everything it keeps.

type AnyRecord = Record<string, unknown> & { _meta: IMeta & Record<string, unknown> };

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
  delete (obj._meta as Record<string, unknown>).date;
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

  test("stack settings are accepted but _meta.path is never attached", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden", stack: { capture: "full" } });
    const record = logger.info("no stack");
    expect(record?._meta).toBeDefined();
    expect("path" in (record?._meta as object)).toBe(false);
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

  test("bindings merge down the sub-logger chain and _meta carries name/parentNames", () => {
    const root = new SlimLogger<AnyRecord>({ type: "hidden", name: "root", bindings: { tenant: "acme" } });
    const child = root.child({ name: "child", bindings: { requestId: "r-1" } });
    const record = child.info("nested");
    expect(record?.tenant).toBe("acme");
    expect(record?.requestId).toBe("r-1");
    expect(record?._meta.name).toBe("child");
    expect(record?._meta.parentNames).toEqual(["root"]);
  });

  test("custom levels install typed methods via createLogger", () => {
    const logger = createLogger({ type: "hidden", customLevels: { AUDIT: 7 } });
    const record = logger.audit("granted") as AnyRecord | undefined;
    expect(record?._meta.logLevelName).toBe("AUDIT");
    expect(record?._meta.logLevelId).toBe(7);
  });

  test("runInContext propagates onto _meta (auto-resolved AsyncLocalStorage)", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden" });
    const record = logger.runInContext({ requestId: "ctx-1" }, () => logger.info("in ctx"));
    expect(record?._meta.requestId).toBe("ctx-1");
  });

  test("middleware and minLevel filtering work", () => {
    const logger = new SlimLogger<AnyRecord>({ type: "hidden", minLevel: "WARN" });
    logger.use((ctx) => {
      ctx.meta.traceId = "t-1";
      return ctx;
    });
    expect(logger.info("below")).toBeUndefined();
    const record = logger.warn("kept");
    expect(record?._meta.traceId).toBe("t-1");
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
