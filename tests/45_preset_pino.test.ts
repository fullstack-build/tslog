import { describe, expect, test } from "vitest";
import { Logger } from "../src";
import { pinoFormat, pinoTransport, toPinoLevel } from "../src/subpaths/presets/pino";

/**
 * Pino preset (`tslog/presets/pino`): a LogFormatter producing pino-shaped NDJSON plus a transport helper.
 * Covers the documented tslog 0-6 → pino 10-60 level mapping and the emitted record shape.
 */
describe("presets/pino", () => {
  test("toPinoLevel maps the canonical seven tslog levels", () => {
    expect(toPinoLevel(0)).toBe(10); // SILLY -> trace
    expect(toPinoLevel(1)).toBe(10); // TRACE -> trace
    expect(toPinoLevel(2)).toBe(20); // DEBUG
    expect(toPinoLevel(3)).toBe(30); // INFO
    expect(toPinoLevel(4)).toBe(40); // WARN
    expect(toPinoLevel(5)).toBe(50); // ERROR
    expect(toPinoLevel(6)).toBe(60); // FATAL
  });

  test("toPinoLevel snaps unknown/custom level ids to the nearest pino bucket, clamped to 10..60", () => {
    expect(toPinoLevel(7)).toBe(60); // above FATAL -> clamp to 60
    expect(toPinoLevel(100)).toBe(60);
    expect(toPinoLevel(-5)).toBe(10); // below floor -> clamp to 10
  });

  function capture(opts?: Parameters<typeof pinoTransport>[1]) {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(pinoTransport((line) => lines.push(line), opts));
    return { logger, lines };
  }

  test("emits a pino-shaped line: numeric level, epoch-ms time, msg, top-level fields", () => {
    const { logger, lines } = capture();
    logger.info({ userId: 42 }, "user logged in");

    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(obj.level).toBe(30);
    expect(typeof obj.time).toBe("number");
    expect(obj.time).toBeGreaterThan(0);
    expect(obj.msg).toBe("user logged in");
    expect(obj.userId).toBe(42);
    // pino does not nest tslog's _meta block, level name, or levelId.
    expect(obj._meta).toBeUndefined();
    expect(obj.levelId).toBeUndefined();
  });

  test("includes pid by default and hostname when present in meta", () => {
    const { logger, lines } = capture();
    logger.warn("careful");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(obj.level).toBe(40);
    // Node runtime: pid is a number, hostname is a string.
    expect(typeof obj.pid).toBe("number");
    expect(typeof obj.hostname).toBe("string");
  });

  test("pid can be disabled", () => {
    const { logger, lines } = capture({ pid: false });
    logger.info("no pid here");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.pid).toBeUndefined();
  });

  test("time: 'iso' emits an ISO-8601 string", () => {
    const { logger, lines } = capture({ time: "iso" });
    logger.info("iso time");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(typeof obj.time).toBe("string");
    expect(() => new Date(obj.time as string).toISOString()).not.toThrow();
    expect(new Date(obj.time as string).toISOString()).toBe(obj.time);
  });

  test("a bare string message lands under msg", () => {
    const { logger, lines } = capture();
    logger.debug("hello");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.level).toBe(20);
    expect(obj.msg).toBe("hello");
  });

  test("errors are serialized under err in pino's shape: type + raw stack STRING, cause chain recursed", () => {
    const { logger, lines } = capture();
    const err = new TypeError("boom", { cause: new Error("root cause") });
    (err as unknown as Record<string, unknown>).code = "E_BOOM";
    logger.error("request failed", err);
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(obj.level).toBe(50);
    expect(obj.msg).toBe("request failed");
    const serialized = obj.err as Record<string, unknown>;
    expect(serialized).toBeTruthy();
    // pino's err-serializer wire shape: `type` (class name), `message`, `stack` as the raw multi-line
    // STRING pino-pretty and error trackers parse — NOT tslog's parsed frame array.
    expect(serialized.type).toBe("TypeError");
    expect(serialized.message).toBe("boom");
    expect(typeof serialized.stack).toBe("string");
    expect(serialized.stack as string).toContain("TypeError: boom");
    expect(serialized.stack as string).toContain("    at ");
    // extra enumerable own props ride along, like pino's serializer
    expect(serialized.code).toBe("E_BOOM");
    const cause = serialized.cause as Record<string, unknown>;
    expect(cause.type).toBe("Error");
    expect(cause.message).toBe("root cause");
    expect(typeof cause.stack).toBe("string");
    // native Error handle is stripped, not serialized as {}.
    expect(serialized.nativeError).toBeUndefined();
  });

  test("errorShape: 'tslog' keeps the structured frame-array shape", () => {
    const { logger, lines } = capture({ errorShape: "tslog" });
    logger.error("request failed", new Error("boom"));
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const serialized = obj.err as Record<string, unknown>;
    expect(serialized.name).toBe("Error");
    expect(Array.isArray(serialized.stack)).toBe(true);
    expect(serialized.type).toBeUndefined();
  });

  test("custom messageKey/errorKey are honored", () => {
    const { logger, lines } = capture({ messageKey: "message", errorKey: "error" });
    logger.info("renamed");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.message).toBe("renamed");
    expect(obj.msg).toBeUndefined();
  });

  test("pinoFormat can be used directly as a transport format", () => {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport({
      format: pinoFormat(),
      write: (_record, line) => {
        lines.push(line);
      },
    });
    logger.fatal({ code: "E_FATAL" }, "down");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.level).toBe(60);
    expect(obj.msg).toBe("down");
    expect(obj.code).toBe("E_FATAL");
  });

  test("circular user fields do not throw", () => {
    const { logger, lines } = capture();
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(() => logger.info(circular)).not.toThrow();
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.name).toBe("loop");
    // The circular back-reference is replaced with the "[Circular]" marker somewhere in the chain,
    // so the line is valid JSON and round-trips without throwing.
    expect(JSON.stringify(obj)).toContain("[Circular]");
  });
});

describe("presets/pino hand-built error-likes (review fixes)", () => {
  function capture(opts?: Parameters<typeof pinoTransport>[1]) {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(pinoTransport((line) => lines.push(line), opts));
    return { logger, lines };
  }

  test("a non-error cause on a hand-built error-like passes through verbatim instead of crashing", () => {
    const { logger, lines } = capture();
    expect(() => logger.error("hand-built", { nativeError: new Error("real"), name: "E", message: "m", stack: [], cause: "just a string" })).not.toThrow();
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const serialized = obj.err as Record<string, unknown>;
    expect(serialized.message).toBe("m");
    expect(serialized.cause).toBe("just a string");
  });

  test("a non-array stack on a nested error-like is treated as absent", () => {
    const { logger, lines } = capture();
    const errorLike = {
      nativeError: new Error("real"),
      name: "E",
      message: "m",
      stack: [],
      cause: { nativeError: new Error("inner"), name: "Inner", message: "im", stack: "bogus" },
    };
    expect(() => logger.error("nested", errorLike)).not.toThrow();
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const cause = (obj.err as Record<string, unknown>).cause as Record<string, unknown>;
    expect(cause.message).toBe("im");
    // the native handle's real stack string is still preferred, so a stack IS present here
    expect(typeof cause.stack).toBe("string");
  });
});
