import { describe, expect, test } from "vitest";
import type { ILogObjMeta, IMeta } from "../src/index.js";
import { createTestLogger } from "../src/subpaths/testing.js";
import { defaultThrottleKey, throttle } from "../src/subpaths/throttle.js";

// M4.7 — `tslog/throttle`: opt-in dedup middleware. Identical consecutive logs within `windowMs` are
// suppressed (dropped before any transport runs); the suppressed count is surfaced as `repeated: N` on
// the log that ends the run. A fake clock (`now`) makes window timing deterministic.

/** Read the _meta block off a captured record (default meta property is "_meta"). */
function metaOf(record: ILogObjMeta): IMeta & { repeated?: number } {
  return record._meta as IMeta & { repeated?: number };
}

/** A controllable virtual clock for driving `windowMs` without real time. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("throttle (M4.7)", () => {
  test("suppresses identical consecutive messages within the window", () => {
    const clock = fakeClock();
    const { logger, logs } = createTestLogger();
    logger.use(throttle({ windowMs: 1000, now: clock.now }));

    logger.warn("rate limited");
    logger.warn("rate limited");
    logger.warn("rate limited");

    // Only the first passed through; the two duplicates were dropped before the capture transport.
    expect(logs).toHaveLength(1);
    expect(metaOf(logs[0]).repeated).toBeUndefined();
  });

  test("surfaces the suppressed count on the next distinct message", () => {
    const clock = fakeClock();
    const { logger, logs } = createTestLogger();
    logger.use(throttle({ windowMs: 1000, now: clock.now }));

    logger.warn("dupe");
    logger.warn("dupe");
    logger.warn("dupe");
    logger.info("something else");

    expect(logs).toHaveLength(2);
    // The run-ending distinct log carries how many copies were swallowed.
    expect(metaOf(logs[1]).repeated).toBe(2);
  });

  test("the same message after the window elapses opens a fresh run and carries the count", () => {
    const clock = fakeClock();
    const { logger, logs } = createTestLogger();
    logger.use(throttle({ windowMs: 1000, now: clock.now }));

    logger.warn("dupe");
    logger.warn("dupe"); // suppressed (count = 1)
    clock.advance(1500); // past the window
    logger.warn("dupe"); // emitted, ends the previous run

    expect(logs).toHaveLength(2);
    expect(metaOf(logs[1]).repeated).toBe(1);
  });

  test("distinct messages all pass through with no repeated field", () => {
    const clock = fakeClock();
    const { logger, logs } = createTestLogger();
    logger.use(throttle({ windowMs: 1000, now: clock.now }));

    logger.info("a");
    logger.info("b");
    logger.info("c");

    expect(logs).toHaveLength(3);
    for (const record of logs) {
      expect(metaOf(record).repeated).toBeUndefined();
    }
  });

  test("structurally-identical object args collapse; a value difference does not", () => {
    const clock = fakeClock();
    const { logger, logs } = createTestLogger();
    logger.use(throttle({ windowMs: 1000, now: clock.now }));

    logger.warn("disk", { pct: 92, host: "a" });
    logger.warn("disk", { host: "a", pct: 92 }); // same content, different key order → suppressed
    logger.warn("disk", { pct: 93, host: "a" }); // different value → distinct, passes

    expect(logs).toHaveLength(2);
    expect(metaOf(logs[1]).repeated).toBe(1);
  });

  test("off by default — no throttle middleware means no effect", () => {
    const { logger, logs } = createTestLogger();

    logger.warn("dupe");
    logger.warn("dupe");
    logger.warn("dupe");

    expect(logs).toHaveLength(3);
    for (const record of logs) {
      expect(metaOf(record).repeated).toBeUndefined();
    }
  });

  test("a window after a run with no suppression carries no count", () => {
    const clock = fakeClock();
    const { logger, logs } = createTestLogger();
    logger.use(throttle({ windowMs: 1000, now: clock.now }));

    logger.info("x"); // run with 0 suppressed
    logger.info("y"); // ends it — nothing was suppressed, so no repeated

    expect(logs).toHaveLength(2);
    expect(metaOf(logs[1]).repeated).toBeUndefined();
  });

  test("a custom key() controls what counts as identical", () => {
    const clock = fakeClock();
    const { logger, logs } = createTestLogger();
    // Key on the first arg only → volatile second args are ignored for dedup.
    logger.use(throttle({ windowMs: 1000, now: clock.now, key: (ctx) => String(ctx.args[0]) }));

    logger.warn("same", 1);
    logger.warn("same", 2); // suppressed despite differing second arg
    logger.info("done");

    expect(logs).toHaveLength(2);
    expect(metaOf(logs[1]).repeated).toBe(1);
  });

  test("a non-positive windowMs disables suppression entirely", () => {
    const { logger, logs } = createTestLogger();
    logger.use(throttle({ windowMs: 0 }));

    logger.warn("dupe");
    logger.warn("dupe");

    expect(logs).toHaveLength(2);
    for (const record of logs) {
      expect(metaOf(record).repeated).toBeUndefined();
    }
  });

  test("defaultThrottleKey distinguishes by level and args", () => {
    const base = { args: ["hi"], settings: {} as never, meta: {}, logLevelName: "INFO" };
    const infoKey = defaultThrottleKey({ ...base, logLevelId: 3 } as never);
    const warnKey = defaultThrottleKey({ ...base, logLevelId: 4 } as never);
    const otherArgs = defaultThrottleKey({ ...base, logLevelId: 3, args: ["bye"] } as never);

    expect(infoKey).toBe(defaultThrottleKey({ ...base, logLevelId: 3 } as never));
    expect(infoKey).not.toBe(warnKey);
    expect(infoKey).not.toBe(otherArgs);
  });
});
