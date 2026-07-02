import { describe, expect, test, vi } from "vitest";
import type { ILogObjMeta, IMeta } from "../src/index.js";
import { createTestLogger, mockLogger } from "../src/subpaths/testing.js";

// M4.5 — `tslog/testing`: createTestLogger (capture transport) + mockLogger (recording level methods).

/** Read the _meta block off a captured record (default meta property is "_meta"). */
function metaOf(record: ILogObjMeta): IMeta {
  return record._meta as IMeta;
}

describe("createTestLogger", () => {
  test("captures emitted logs as records reflecting the calls", () => {
    const { logger, logs } = createTestLogger();

    logger.info("hello", { user: 42 });
    logger.warn("careful");

    expect(logs).toHaveLength(2);
    expect(metaOf(logs[0]).logLevelName).toBe("INFO");
    expect(metaOf(logs[1]).logLevelName).toBe("WARN");
    // The structured record carries the logged fields (string message + object) alongside _meta.
    expect(logs[0]["0"]).toBe("hello");
    expect(logs[0]["1"]).toEqual({ user: 42 });
  });

  test("captures formatted lines when an output type is set", () => {
    const { logger, lines, logs } = createTestLogger({ type: "json" });

    // Fields-first call merges the object's keys to the top level of the JSON line.
    logger.error({ code: 500 }, "boom");

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.message).toBe("boom");
    expect(parsed.level).toBe("ERROR");
    expect(parsed.code).toBe(500);
    // logs and lines stay in lockstep.
    expect(logs).toHaveLength(1);
  });

  test("clear() empties logs and lines in place without detaching the transport", () => {
    const { logger, logs, lines, clear } = createTestLogger({ type: "json" });

    logger.info("one");
    logger.info("two");
    expect(logs).toHaveLength(2);
    expect(lines).toHaveLength(2);

    // Hold the references to prove clear() mutates in place rather than reassigning.
    const logsRef = logs;
    const linesRef = lines;
    clear();
    expect(logsRef).toHaveLength(0);
    expect(linesRef).toHaveLength(0);

    // Transport is still attached: subsequent logs are captured again.
    logger.info("three");
    expect(logs).toHaveLength(1);
    expect(lines).toHaveLength(1);
  });

  test("honors minLevel filtering — below-level calls never reach the capture transport", () => {
    const { logger, logs } = createTestLogger({ minLevel: "WARN" });

    logger.silly("nope");
    logger.debug("nope");
    logger.info("nope");
    logger.warn("yes");
    logger.error("yes");

    expect(logs).toHaveLength(2);
    expect(logs.map((r) => metaOf(r).logLevelName)).toEqual(["WARN", "ERROR"]);
  });

  test("supports custom levels and a custom string minLevel", () => {
    const { logger, logs } = createTestLogger({ minLevel: "NOTICE", customLevels: { NOTICE: 3.5 } });

    logger.info("below"); // INFO(3) < 3.5 -> filtered
    logger.log(3.5, "NOTICE", "at notice");
    logger.warn("above");

    expect(logs.map((r) => metaOf(r).logLevelName)).toEqual(["NOTICE", "WARN"]);
  });
});

describe("mockLogger", () => {
  test("records each level call with its arguments (per-method and aggregate)", () => {
    const log = mockLogger();

    log.info("hi", 1);
    log.warn("careful");
    log.error("boom");

    expect(log.info.calls).toEqual([["hi", 1]]);
    expect(log.warn.calls).toEqual([["careful"]]);
    expect(log.error.calls).toEqual([["boom"]]);

    expect(log.calls).toEqual([
      { level: "info", args: ["hi", 1] },
      { level: "warn", args: ["careful"] },
      { level: "error", args: ["boom"] },
    ]);
  });

  test("exposes a Jest/Vitest-style mock.calls alias on each method", () => {
    const log = mockLogger();
    log.debug("d");
    expect(log.debug.mock.calls).toEqual([["d"]]);
    // Same backing array as `.calls`.
    expect(log.debug.mock.calls).toBe(log.debug.calls);
  });

  test("still drives the real pipeline so attached transports run", () => {
    const log = mockLogger();
    const seen: unknown[] = [];
    log.attachTransport((record) => {
      seen.push((record._meta as IMeta).logLevelName);
    });

    log.info("through");
    log.fatal("through");

    expect(seen).toEqual(["INFO", "FATAL"]);
    expect(log.calls.map((c) => c.level)).toEqual(["info", "fatal"]);
  });

  test("honors minLevel: below-level recorder calls are recorded but the pipeline filters them", () => {
    const log = mockLogger({ minLevel: "WARN" });
    const emitted: unknown[] = [];
    log.attachTransport((record) => emitted.push((record._meta as IMeta).logLevelName));

    log.info("low");
    log.error("high");

    // The recorder captures every call (it wraps the method),
    expect(log.calls.map((c) => c.level)).toEqual(["info", "error"]);
    // but the underlying pipeline only emits at/above minLevel.
    expect(emitted).toEqual(["ERROR"]);
  });

  test("mockClear() resets the aggregate and every per-method buffer", () => {
    const log = mockLogger();
    log.info("a");
    log.warn("b");
    expect(log.calls).toHaveLength(2);

    log.mockClear();
    expect(log.calls).toHaveLength(0);
    expect(log.info.calls).toHaveLength(0);
    expect(log.warn.calls).toHaveLength(0);

    log.info("c");
    expect(log.calls).toEqual([{ level: "info", args: ["c"] }]);
    expect(log.info.calls).toEqual([["c"]]);
  });

  test("mockClear() on a single method only resets that method", () => {
    const log = mockLogger();
    log.info("x");
    log.warn("y");
    log.info.mockClear();
    expect(log.info.calls).toEqual([]);
    expect(log.warn.calls).toEqual([["y"]]);
  });
});

describe("purity / no global mutation", () => {
  test("mockLogger does not patch console", () => {
    const spy = vi.spyOn(console, "log");
    const log = mockLogger(); // hidden by default -> no console output
    log.info("quiet");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
