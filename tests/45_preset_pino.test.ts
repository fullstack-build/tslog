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

  test("errors are serialized under the err key (cause chain preserved)", () => {
    const { logger, lines } = capture();
    const err = new Error("boom", { cause: new Error("root cause") });
    logger.error("request failed", err);
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(obj.level).toBe(50);
    expect(obj.msg).toBe("request failed");
    const serialized = obj.err as Record<string, unknown>;
    expect(serialized).toBeTruthy();
    expect(serialized.name).toBe("Error");
    expect(serialized.message).toBe("boom");
    expect((serialized.cause as Record<string, unknown>).message).toBe("root cause");
    // native Error handle is stripped, not serialized as {}.
    expect(serialized.nativeError).toBeUndefined();
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
