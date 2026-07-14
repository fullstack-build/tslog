import { TslogConfigError } from "../src/core/config.js";
import { Logger } from "../src/index.js";
import type { ILogObjMeta, IMeta, ISettings, ISettingsParam } from "../src/interfaces.js";
import { __linePlanActive, renderJson, renderJsonUnplanned } from "../src/render/json.js";
import { createTestLogger, normalizeMeta } from "../src/subpaths/testing.js";

// The time seam (review 70/74): the injectable `clock` setting, the `json.time` representation
// ("iso" | "epoch" | false | fn), the toIsoString edge-year guard, and the deterministic
// createTestLogger options built on top.

type AnyRecord = Record<string, unknown> & { _logMeta: IMeta & Record<string, unknown> };

const FIXED = new Date("2026-01-02T03:04:05.678Z");

function captureLine(settings: ISettingsParam<AnyRecord>, run: (logger: Logger<AnyRecord>) => void): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
  try {
    run(new Logger<AnyRecord>({ ...settings, type: "json" }));
  } finally {
    spy.mockRestore();
  }
  expect(lines).toHaveLength(1);
  return lines[0];
}

describe("the clock setting", () => {
  test("pins _logMeta.date and the top-level time on JSON output", () => {
    const line = captureLine({ clock: () => FIXED, stack: { capture: "off" } }, (logger) => logger.info("stamped"));
    const parsed = JSON.parse(line) as AnyRecord;
    expect(parsed.time).toBe("2026-01-02T03:04:05.678Z");
    expect(parsed._logMeta.date).toBe("2026-01-02T03:04:05.678Z");
  });

  test("the record carries the clock's Date object", () => {
    const logger = new Logger<AnyRecord>({ type: "hidden", clock: () => FIXED });
    const record = logger.info("stamped");
    expect(record?._logMeta.date).toBeInstanceOf(Date);
    expect(record?._logMeta.date.getTime()).toBe(FIXED.getTime());
  });

  test("a throwing clock and an invalid-Date clock are ignored (runtime date kept, no throw)", () => {
    for (const clock of [
      (): Date => new Date(Number.NaN),
      (): Date => new Date("nope"),
      (): never => {
        throw new Error("hostile clock");
      },
    ]) {
      const logger = new Logger<AnyRecord>({ type: "hidden", clock: clock as () => Date });
      const before = Date.now();
      const record = logger.info("still logs");
      expect(record?._logMeta.date).toBeInstanceOf(Date);
      expect(Math.abs(record!._logMeta.date.getTime() - before)).toBeLessThan(5_000);
    }
  });

  test("sub-loggers inherit the parent's clock", () => {
    const root = new Logger<AnyRecord>({ type: "hidden", clock: () => FIXED });
    const child = root.child({ name: "child" });
    expect(child.info("inherited")?._logMeta.date.getTime()).toBe(FIXED.getTime());
  });

  test("pretty output renders the pinned clock", () => {
    const { logger, lines } = createTestLogger<AnyRecord>({ type: "pretty", clock: () => FIXED, pretty: { style: false } });
    logger.info("pretty stamped");
    expect(lines[0]).toContain("2026-01-02 03:04:05.678");
  });
});

describe("json.time representations", () => {
  test('"epoch" emits epoch milliseconds as a number', () => {
    const line = captureLine({ clock: () => FIXED, json: { time: "epoch" }, stack: { capture: "off" } }, (logger) => logger.info("ms"));
    const parsed = JSON.parse(line) as AnyRecord;
    expect(parsed.time).toBe(FIXED.getTime());
    // _logMeta.date stays the ISO string regardless of the top-level representation
    expect(parsed._logMeta.date).toBe("2026-01-02T03:04:05.678Z");
  });

  test("false omits the time key, and a user field of that name passes through", () => {
    const line = captureLine({ clock: () => FIXED, json: { time: false }, stack: { capture: "off" } }, (logger) =>
      logger.info("no time", { time: "user-owned" }),
    );
    const parsed = JSON.parse(line) as AnyRecord;
    expect(parsed.time).toBe("user-owned");
    expect(parsed._logMeta.date).toBe("2026-01-02T03:04:05.678Z");
  });

  test("a custom function renders the timestamp (e.g. nanoseconds for Loki)", () => {
    const line = captureLine(
      { clock: () => FIXED, json: { time: (date) => String(BigInt(date.getTime()) * 1_000_000n) }, stack: { capture: "off" } },
      (logger) => logger.info("ns"),
    );
    expect((JSON.parse(line) as AnyRecord).time).toBe(`${FIXED.getTime()}000000`);
  });

  test("a throwing custom function falls back to the ISO string instead of breaking the line", () => {
    const line = captureLine(
      {
        clock: () => FIXED,
        json: {
          time: () => {
            throw new Error("hostile time fn");
          },
        },
        stack: { capture: "off" },
      },
      (logger) => logger.info("guarded"),
    );
    expect((JSON.parse(line) as AnyRecord).time).toBe("2026-01-02T03:04:05.678Z");
  });

  test("strictConfig rejects an unknown json.time value and a non-function clock", () => {
    expect(() => new Logger({ type: "hidden", strictConfig: true, json: { time: "nope" as never } })).toThrow(TslogConfigError);
    expect(() => new Logger({ type: "hidden", strictConfig: true, clock: 42 as never })).toThrow(TslogConfigError);
  });
});

describe("line plan interaction (byte-identity planned vs unplanned)", () => {
  function recordAndSettings(settings: ISettingsParam<AnyRecord>): { record: AnyRecord & ILogObjMeta; settings: ISettings<AnyRecord> } {
    const logger = new Logger<AnyRecord>({ type: "hidden", clock: () => FIXED, stack: { capture: "off" }, ...settings });
    const record = logger.info("plan probe", { a: 1 }) as AnyRecord & ILogObjMeta;
    return { record, settings: logger.settings };
  }

  test('the default "iso" keeps the precompiled plan active', () => {
    const { record, settings } = recordAndSettings({});
    const first = renderJson(record, settings);
    const second = renderJson(record, settings);
    expect(__linePlanActive(settings)).toBe(true);
    expect(first).toBe(second);
    expect(second).toBe(renderJsonUnplanned(record, settings));
  });

  test("every non-iso mode bails the plan and stays byte-identical to the unplanned renderer", () => {
    const modes: ISettingsParam<AnyRecord>["json"][] = [{ time: "epoch" }, { time: false }, { time: (date: Date): string => `t:${date.getTime()}` }];
    for (const json of modes) {
      const { record, settings } = recordAndSettings({ json });
      const line = renderJson(record, settings);
      renderJson(record, settings);
      expect(__linePlanActive(settings)).toBe(false);
      expect(line).toBe(renderJsonUnplanned(record, settings));
    }
  });
});

describe("toIsoString edge years (the guard branch)", () => {
  test("years outside 1000-9999 defer to Date#toISOString byte-for-byte", () => {
    for (const iso of ["0500-06-15T12:30:45.123Z", "+010000-01-01T00:00:00.000Z"]) {
      const date = new Date(iso);
      expect(Number.isNaN(date.getTime())).toBe(false);
      const line = captureLine({ clock: () => date, stack: { capture: "off" } }, (logger) => logger.info("edge year"));
      expect((JSON.parse(line) as AnyRecord).time).toBe(date.toISOString());
    }
  });

  test("an Invalid Date smuggled in via middleware emits an honest marker instead of throwing", () => {
    const line = captureLine(
      {
        stack: { capture: "off" },
        middleware: [
          (ctx): typeof ctx => {
            ctx.meta.date = new Date(Number.NaN);
            return ctx;
          },
        ],
      },
      (logger) => logger.info("invalid date"),
    );
    expect((JSON.parse(line) as AnyRecord).time).toBe("Invalid Date");
  });
});

describe("createTestLogger determinism", () => {
  test("the now option freezes this logger's timestamps without fake timers", () => {
    const { logger, logs, lines } = createTestLogger<AnyRecord>({ type: "json" }, { now: () => 1_000 });
    logger.info("frozen");
    expect(logs[0]._logMeta.date.getTime()).toBe(1_000);
    expect((JSON.parse(lines[0]) as AnyRecord).time).toBe("1970-01-01T00:00:01.000Z");
    // no global mutation: the ambient clock still moves
    expect(Date.now()).toBeGreaterThan(1_000_000);
  });

  test("an explicit settings.clock wins over the now option", () => {
    const { logger, logs } = createTestLogger<AnyRecord>({ type: "json", clock: () => FIXED }, { now: () => 1_000 });
    logger.info("explicit");
    expect(logs[0]._logMeta.date.getTime()).toBe(FIXED.getTime());
  });

  test("normalize: true yields snapshot-stable lines across separate loggers", () => {
    const run = (): string => {
      const { logger, lines } = createTestLogger<AnyRecord>({ type: "json", name: "snap" }, { normalize: true });
      logger.warn("stable", { n: 7 });
      return lines[0];
    };
    const first = run();
    const second = run();
    expect(first).toBe(second);
    const parsed = JSON.parse(first) as AnyRecord;
    expect(parsed.time).toBe("1970-01-01T00:00:00.000Z");
    expect(parsed._logMeta.date).toBe("1970-01-01T00:00:00.000Z");
    if ("hostname" in parsed._logMeta) {
      expect(parsed._logMeta.hostname).toBe("<hostname>");
    }
    if ("runtimeVersion" in parsed._logMeta) {
      expect(parsed._logMeta.runtimeVersion).toBe("<runtimeVersion>");
    }
    expect("path" in parsed._logMeta).toBe(false);
  });

  test("normalize stores COPIES: other transports still receive the raw record", () => {
    const { logger, logs } = createTestLogger<AnyRecord>({ type: "json" }, { normalize: true });
    let rawRecord: AnyRecord | undefined;
    logger.attachTransport((record) => {
      rawRecord = record as AnyRecord;
    });
    logger.info("copies");
    expect(logs[0]._logMeta.hostname == null || logs[0]._logMeta.hostname === "<hostname>").toBe(true);
    if (rawRecord?._logMeta.hostname != null) {
      expect(rawRecord._logMeta.hostname).not.toBe("<hostname>");
    }
    // frozen clock applies at the SOURCE, so the raw record is epoch-stamped too
    expect((rawRecord?._logMeta.date as Date).getTime()).toBe(0);
  });
});

describe("normalizeMeta standalone", () => {
  test("normalizes a JSON line (key order preserved) and a structured record without mutating the input", () => {
    const { logger } = createTestLogger<AnyRecord>({ type: "json" });
    const captured: { record?: AnyRecord; line?: string } = {};
    logger.attachTransport({
      name: "raw",
      write(record, line) {
        captured.record = record as AnyRecord;
        captured.line = line;
      },
    });
    logger.info("scrub me", { keep: true });

    const normalizedLine = normalizeMeta(captured.line as string);
    const parsed = JSON.parse(normalizedLine) as AnyRecord;
    expect(parsed.time).toBe("1970-01-01T00:00:00.000Z");
    expect(parsed.keep).toBe(true);
    expect(Object.keys(parsed)[0]).toBe(Object.keys(JSON.parse(captured.line as string) as AnyRecord)[0]);

    const originalDate = captured.record?._logMeta.date;
    const normalizedRecord = normalizeMeta(captured.record as AnyRecord);
    expect((normalizedRecord._logMeta.date as Date).getTime()).toBe(0);
    expect(captured.record?._logMeta.date).toBe(originalDate); // input untouched
  });

  test("scrubs pretty-line timestamps best-effort", () => {
    const pretty = "2026.07.04 10:11:12:345\tINFO\thello";
    expect(normalizeMeta(pretty)).toBe("1970.01.01 00:00:00:000\tINFO\thello");
    const iso = "prefix 2026-07-04T10:11:12.345Z suffix";
    expect(normalizeMeta(iso)).toBe("prefix 1970-01-01T00:00:00.000Z suffix");
  });

  test("honors renamed meta/time keys", () => {
    const line = JSON.stringify({ msg: "x", "@timestamp": "2026-07-04T10:11:12.345Z", $meta: { date: "2026-07-04T10:11:12.345Z" } });
    const normalized = normalizeMeta(line, { metaProperty: "$meta", timeKey: "@timestamp" });
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    expect(parsed["@timestamp"]).toBe("1970-01-01T00:00:00.000Z");
    expect((parsed.$meta as Record<string, unknown>).date).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("review fixes: hostile dates and head-key collisions", () => {
  test("pretty output degrades on an Invalid Date (and a non-Date) meta.date instead of throwing", () => {
    for (const smuggled of [new Date(Number.NaN), "not a date"]) {
      const { logger, lines } = createTestLogger<AnyRecord>({
        type: "pretty",
        pretty: { style: false },
        middleware: [
          (ctx): typeof ctx => {
            ctx.meta.date = smuggled as never;
            return ctx;
          },
        ],
      });
      expect(() => logger.info("survives")).not.toThrow();
      expect(lines[0]).toContain("survives");
    }
  });

  test("head-key collisions bail the plan: planned and unplanned stay byte-identical (no duplicate JSON keys)", () => {
    const collisions: ISettingsParam<AnyRecord>["json"][] = [
      { levelKey: "ts", timeKey: "ts" },
      { levelKey: "lvl", levelIdKey: "lvl" },
      { levelKey: "_logMeta" },
      { timeKey: "_logMeta" },
    ];
    for (const json of collisions) {
      const logger = new Logger<AnyRecord>({ type: "hidden", clock: () => FIXED, stack: { capture: "off" }, json });
      const record = logger.info("collide", { a: 1 }) as AnyRecord & ILogObjMeta;
      const first = renderJson(record, logger.settings);
      const second = renderJson(record, logger.settings);
      const unplanned = renderJsonUnplanned(record, logger.settings);
      expect(first).toBe(unplanned);
      expect(second).toBe(unplanned);
      // no duplicate keys: JSON.parse keeps the LAST occurrence; a re-stringify must round-trip
      expect(JSON.stringify(JSON.parse(unplanned))).toBe(unplanned);
    }
  });

  test("an out-of-contract time fn result (bigint/undefined/object) degrades to the ISO string, even with stableKeyOrder", () => {
    const badTimeFns = [() => 10n, () => undefined, () => ({ nested: true })];
    for (const badTimeFn of badTimeFns) {
      const line = captureLine({ clock: () => FIXED, json: { stableKeyOrder: true, time: badTimeFn as never } }, (logger) => logger.info("degraded"));
      const parsed = JSON.parse(line) as AnyRecord;
      expect(parsed.time).toBe("2026-01-02T03:04:05.678Z");
      expect(parsed.message).toBe("degraded");
    }
  });

  test("a non-iso START does not poison the plan cache: flipping to iso re-enters the planned path", () => {
    const logger = new Logger<AnyRecord>({ type: "hidden", clock: () => FIXED, stack: { capture: "off" }, json: { time: "epoch" } });
    const record = logger.info("probe") as AnyRecord & ILogObjMeta;
    renderJson(record, logger.settings);
    expect(__linePlanActive(logger.settings)).toBe(false);
    logger.settings.json.time = "iso";
    const record2 = logger.info("probe-iso") as AnyRecord & ILogObjMeta;
    renderJson(record2, logger.settings);
    renderJson(record2, logger.settings);
    expect(__linePlanActive(logger.settings)).toBe(true);
    expect(renderJson(record2, logger.settings)).toBe(renderJsonUnplanned(record2, logger.settings));
  });
});
