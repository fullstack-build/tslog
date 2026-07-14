import { Logger } from "../src/index.node.js";
import { __linePlanActive, jsonStringifyValue, renderJson, toFlatJsonObject } from "../src/render/json.js";

/**
 * The precompiled line plan must be an invisible optimization: for every record shape, the planned
 * line has to be byte-identical to what the object-building path produces
 * (`jsonStringifyValue(toFlatJsonObject(record))` — the exact pre-plan behavior in non-stable mode).
 * `__linePlanActive` guards against the suite silently testing only the fallback path.
 */
function expectPlannedLineMatchesObjectPath(logObj: unknown, settings: Parameters<typeof renderJson>[1]): string {
  const record = logObj as Parameters<typeof renderJson>[0];
  const line = renderJson(record, settings);
  const viaObject = jsonStringifyValue(toFlatJsonObject(record, settings));
  expect(line).toBe(viaObject);
  return line;
}

describe("JSON line plan is byte-identical to the object path", () => {
  test("bare message, message + fields, single object — and the plan actually fires", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    const cases = [
      logger.info("hello"),
      logger.info("hello", { userId: 42, nested: { a: [1, 2, 3], b: null } }),
      logger.info({ single: "object", flag: true }),
      logger.info(),
      logger.info(42),
    ];
    for (const logObj of cases) {
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    }
    // The suite is only meaningful if the planned path is exercised, not just the fallback.
    expect(__linePlanActive(logger.settings)).toBe(true);
    // Warm-plan second pass.
    for (const logObj of cases) {
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    }
  });

  test("named loggers and sub-loggers are plannable (static name/parentNames after the dynamic keys)", () => {
    const parent = new Logger({ type: "hidden", name: "root", stack: { capture: "off" } });
    const child = parent.getSubLogger({ name: "child" });
    expectPlannedLineMatchesObjectPath(parent.info("from parent"), parent.settings);
    expectPlannedLineMatchesObjectPath(child.info("from child", { a: 1 }), child.settings);
    expect(__linePlanActive(parent.settings)).toBe(true);
    expect(__linePlanActive(child.settings)).toBe(true);
    const parentLine = renderJson(parent.info("x") as never, parent.settings);
    expect(parentLine).toContain('"name":"root"');
  });

  test("positional args (integer keys) fall back and stay byte-identical", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    const cases = [logger.info("msg", 1, "two", false), logger.info("a", "b")];
    for (const logObj of cases) {
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    }
  });

  test("awkward field values: explicit undefined, BigInt, functions, symbols, Dates", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    const cases = [
      logger.info({ present: 1, missing: undefined }),
      logger.info({ big: 10n }),
      logger.info({ fn: () => "skipped", kept: "yes" }),
      logger.info({ sym: Symbol("s"), kept: "yes" }),
      logger.info({ when: new Date(0) }),
      logger.info({ 'quo"te\\\\': "esc aped\n" }),
    ];
    for (const logObj of cases) {
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    }
  });

  test("shared sibling references serialize fully on BOTH paths; true cycles stay [Circular]", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    const shared = { v: 1 };
    const sharedLine = expectPlannedLineMatchesObjectPath(logger.info("req", { a: shared, b: shared }), logger.settings);
    expect(sharedLine).toContain('"a":{"v":1}');
    expect(sharedLine).toContain('"b":{"v":1}');
    expect(sharedLine).not.toContain("[Circular]");

    const cyclic: Record<string, unknown> = { name: "c" };
    cyclic.self = cyclic;
    const cyclicLine = expectPlannedLineMatchesObjectPath(logger.info("cycle", { c: cyclic }), logger.settings);
    expect(cyclicLine).toContain('"[Circular]"');
  });

  test("renamed keys, numericLevel off, custom levels", () => {
    const logger = new Logger({
      type: "hidden",
      stack: { capture: "off" },
      json: { messageKey: "msg", levelKey: "severity", levelIdKey: "sev", timeKey: "ts", numericLevel: false },
    });
    logger.addLevel("AUDIT", 3.5);
    const cases = [logger.info("renamed"), logger.log(3.5, "AUDIT", "custom level")];
    for (const logObj of cases) {
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    }
    expect(__linePlanActive(logger.settings)).toBe(true);
  });

  test("fallback shapes still render correctly: errors, arrays, spread-error records", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    const cases = [logger.error(new Error("boom")), logger.info("with error", new Error("attached")), logger.info([1, 2, 3])];
    for (const logObj of cases) {
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    }
  });

  test("spread shapes: pino object-first and message-first agree byte-for-byte with the object path", () => {
    const defaults = { tenant: "acme" };
    const logger = new Logger<Record<string, unknown>>({ type: "hidden", stack: { capture: "off" } }, defaults);
    const cases = [
      logger.info({ userId: 1 }, "pino style"),
      logger.info("message first", { spread: true }),
      logger.info("msg", { tenant: "evil", fresh: 1 }),
      logger.info("msg", { message: "smuggled", level: "fake", time: "fake", _logMeta: { v: 0 }, ok: true }),
      logger.info({ message: "smuggled", level: "fake", ok: true }, "real message"),
      logger.info("msg", { 0: "zero", 5: "five" }),
      logger.info("msg", { fn: () => 1, missing: undefined, big: 5n }),
    ];
    for (const logObj of cases) {
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    }
  });

  test("non-plain trailing objects keep their positional bucket (toJSON/Map/Buffer semantics intact)", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    class Duration {
      #ms = 1234;
      toJSON(): { ms: number } {
        return { ms: this.#ms };
      }
    }
    const durationLine = expectPlannedLineMatchesObjectPath(logger.info("took", new Duration()), logger.settings);
    expect(durationLine).toContain('"1":{"ms":1234}');

    const bufferLine = expectPlannedLineMatchesObjectPath(logger.info("payload", Buffer.from("hi")), logger.settings);
    expect(bufferLine).toContain('"data":[104,105]');
    expect(bufferLine).not.toContain('"0":104');

    const mapLine = expectPlannedLineMatchesObjectPath(logger.info("map", new Map([["k", "v"]])), logger.settings);
    expect(mapLine).toContain('"1":');
  });

  test("a record shaped like a spread call but logged as ONE object keeps its numeric keys", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    const logObj = logger.info({ 0: "queued", 1: { retries: 3 } });
    const line = expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    expect(line).toContain('"1":{"retries":3}');
    expect(line).not.toContain('"retries":3,"');
  });

  test("__proto__ own keys are dropped on both paths without prototype pollution", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    const poisoned = JSON.parse('{"__proto__": {"polluted": true}, "z": 2}');
    const cases = [logger.info(poisoned), logger.info("msg", poisoned)];
    for (const logObj of cases) {
      const line = expectPlannedLineMatchesObjectPath(logObj, logger.settings);
      expect(line).toContain('"z":2');
      expect(line).not.toContain("polluted");
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("async-context fields fall back to the full path and appear in _logMeta", async () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    expectPlannedLineMatchesObjectPath(logger.info("warmup"), logger.settings);
    expect(__linePlanActive(logger.settings)).toBe(true);

    await logger.runInContext({ requestId: "req-1" }, async () => {
      const logObj = logger.info("in context");
      expectPlannedLineMatchesObjectPath(logObj, logger.settings);
      expect(renderJson(logObj as never, logger.settings)).toContain('"requestId":"req-1"');
    });

    const after = logger.info("after context");
    const line = renderJson(after as never, logger.settings);
    expect(line).not.toContain("requestId");
    expectPlannedLineMatchesObjectPath(after, logger.settings);
  });

  test("live settings mutation (messageKey rename) rebuilds the plan", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" } });
    expect(renderJson(logger.info("before") as never, logger.settings)).toContain('"message":"before"');

    logger.settings.json.messageKey = "msg";
    const logObj = logger.info("after");
    const line = renderJson(logObj as never, logger.settings);
    expect(line).toContain('"msg":"after"');
    expectPlannedLineMatchesObjectPath(logObj, logger.settings);
  });

  test("stack capture on (extra path meta key) falls back and keeps the path field", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "full" } });
    const logObj = logger.info("with position");
    const line = renderJson(logObj as never, logger.settings);
    expect(line).toContain('"path":');
    expectPlannedLineMatchesObjectPath(logObj, logger.settings);
    expect(__linePlanActive(logger.settings)).toBe(false);
  });

  test("stableKeyOrder on skips the plan and deep-sorts fields", () => {
    const logger = new Logger({ type: "hidden", stack: { capture: "off" }, json: { stableKeyOrder: true } });
    const logObj = logger.info({ zebra: 1, alpha: { z: 1, a: 2 } });
    const line = renderJson(logObj as never, logger.settings);
    expect(line.indexOf('"alpha"')).toBeLessThan(line.indexOf('"zebra"'));
    expect(line.indexOf('"a":2')).toBeLessThan(line.indexOf('"z":1'));
  });
});
