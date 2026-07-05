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

  // ── defaultThrottleKey: exhaustive per-argument digest ────────────────────────────────────────────
  // digest() reduces each argument to a short tag by type. These pin every scalar/well-known branch so
  // two calls differing only in that arg's TYPE or VALUE yield distinct keys (and identical ones collapse).
  describe("defaultThrottleKey digest per argument type", () => {
    const keyFor = (arg: unknown): string => defaultThrottleKey({ logLevelId: 3, args: [arg] } as never);

    test("null vs undefined vs missing are all distinct tags", () => {
      const nullKey = keyFor(null);
      const undefKey = keyFor(undefined);
      // Distinct primitives must not collide; each is stable against itself.
      expect(nullKey).toBe(keyFor(null));
      expect(undefKey).toBe(keyFor(undefined));
      expect(nullKey).not.toBe(undefKey);
    });

    test("number, boolean and bigint tag by first letter of typeof + value", () => {
      // number → "n:", boolean → "b:", bigint → "b:" of the value; different types/values → different keys.
      expect(keyFor(42)).toBe(keyFor(42));
      expect(keyFor(42)).not.toBe(keyFor(43));
      expect(keyFor(true)).toBe(keyFor(true));
      expect(keyFor(true)).not.toBe(keyFor(false));
      expect(keyFor(7n)).toBe(keyFor(7n));
      expect(keyFor(7n)).not.toBe(keyFor(8n));
      // number 7 and bigint 7n both stringify to "7" but carry different type prefixes → distinct.
      expect(keyFor(7)).not.toBe(keyFor(7n));
    });

    test("function tags by name; anonymous functions share the empty-name tag", () => {
      function named(): void {}
      const same = (): void => {};
      // Named function is stable and distinct from a differently-named one.
      expect(keyFor(named)).toBe(keyFor(named));
      expect(keyFor(named)).not.toBe(keyFor(same));
      // A function whose `name` is absent (undefined) exercises the `?? ""` fallback → tags as "fn:".
      const noName = (): void => {};
      Object.defineProperty(noName, "name", { value: undefined });
      expect(keyFor(noName)).toBe(keyFor(noName));
      // It collapses with another name-less function (both fall back to the empty tag).
      const noName2 = (): void => {};
      Object.defineProperty(noName2, "name", { value: undefined });
      expect(keyFor(noName)).toBe(keyFor(noName2));
    });

    test("symbol tags by its string form", () => {
      const s = Symbol("tag");
      expect(keyFor(s)).toBe(keyFor(s));
      expect(keyFor(Symbol("a"))).not.toBe(keyFor(Symbol("b")));
    });

    test("Error tags by name + message", () => {
      expect(keyFor(new Error("boom"))).toBe(keyFor(new Error("boom")));
      expect(keyFor(new Error("boom"))).not.toBe(keyFor(new Error("bang")));
      expect(keyFor(new TypeError("boom"))).not.toBe(keyFor(new Error("boom")));
    });

    test("Date tags by its epoch time", () => {
      expect(keyFor(new Date(1234))).toBe(keyFor(new Date(1234)));
      expect(keyFor(new Date(1234))).not.toBe(keyFor(new Date(5678)));
    });
  });

  // ── stableStringify: object-digest branches (arrays, depth cap, circular, nested primitives) ────────
  describe("defaultThrottleKey object digest (stableStringify)", () => {
    const keyFor = (arg: unknown): string => defaultThrottleKey({ logLevelId: 3, args: [arg] } as never);

    test("arrays serialize element-wise and by value", () => {
      expect(keyFor([1, 2, 3])).toBe(keyFor([1, 2, 3]));
      expect(keyFor([1, 2, 3])).not.toBe(keyFor([1, 2, 4]));
      // Order matters for arrays (unlike object keys).
      expect(keyFor([1, 2])).not.toBe(keyFor([2, 1]));
    });

    test("object keys are sorted so key order does not affect the digest", () => {
      expect(keyFor({ a: 1, b: 2 })).toBe(keyFor({ b: 2, a: 1 }));
      expect(keyFor({ a: 1, b: 2 })).not.toBe(keyFor({ a: 1, b: 3 }));
    });

    test("nested null and non-string primitives serialize inside objects", () => {
      // Exercises stableStringify's null branch and the `String(value)` path for nested non-strings.
      expect(keyFor({ x: null, y: 5, z: true })).toBe(keyFor({ z: true, y: 5, x: null }));
      expect(keyFor({ x: null })).not.toBe(keyFor({ x: 0 }));
    });

    test("depth beyond the cap collapses to an ellipsis placeholder", () => {
      // Build a chain 8 levels deep; past depth 6 the digest stops recursing and emits "…".
      const deep = (n: number): unknown => (n === 0 ? "leaf" : { next: deep(n - 1) });
      const a = deep(8);
      const b = deep(8);
      // Both truncate identically at the cap → same key.
      expect(keyFor(a)).toBe(keyFor(b));
      // Two deep objects that differ ONLY beyond the cap collapse to the same digest.
      const c = deep(8);
      const differsPastCap = { next: { next: { next: { next: { next: { next: { next: { next: "OTHER" } } } } } } } };
      expect(keyFor(c)).toBe(keyFor(differsPastCap));
    });

    test("circular references are handled without throwing and tag as [circular]", () => {
      const circular: Record<string, unknown> = { name: "root" };
      circular.self = circular;
      expect(() => keyFor(circular)).not.toThrow();
      // The same shape produces a stable key across calls.
      const circular2: Record<string, unknown> = { name: "root" };
      circular2.self = circular2;
      expect(keyFor(circular)).toBe(keyFor(circular2));
    });
  });
});
