import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

// M2.14 — additive custom log levels: a `customLevels` setting (and `logger.addLevel`) registers extra
// name→id levels on top of the canonical seven; log(id, name, ...) emits the right id/name, a string
// minLevel resolves against them, and the default seven keep working.

interface LevelLog {
  _logMeta: { logLevelId: number; logLevelName: string };
}

describe("customLevels setting", () => {
  test("a custom level logs with the correct id and name", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", customLevels: { NOTICE: 3.5 } });
    const record = logger.log(3.5, "NOTICE", "heads up");
    expect(record?._logMeta.logLevelId).toBe(3.5);
    expect(record?._logMeta.logLevelName).toBe("NOTICE");
  });

  test("the registered map is exposed on resolved settings", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", customLevels: { NOTICE: 3.5, AUDIT: 7 } });
    expect(logger.settings.customLevels).toEqual({ NOTICE: 3.5, AUDIT: 7 });
  });

  test("a string minLevel resolves against a custom level", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: "NOTICE", customLevels: { NOTICE: 3.5 } });
    expect(logger.settings.minLevel).toBe(3.5);
    // below the custom minLevel is dropped, at/above is emitted
    expect(logger.log(2, "DEBUG", "below")).toBeUndefined();
    expect(logger.log(3.5, "NOTICE", "at")).toBeDefined();
    expect(logger.log(5, "ERROR", "above")).toBeDefined();
  });

  test("the canonical seven still work alongside custom levels", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", customLevels: { NOTICE: 3.5 } });
    expect(logger.info("info")?._logMeta.logLevelName).toBe("INFO");
    expect(logger.error("err")?._logMeta.logLevelId).toBe(5);
  });

  test("a custom level emits its name in JSON output", () => {
    mockConsoleLog(true, false);
    const logger = new Logger<LevelLog>({ type: "json", minLevel: 0, customLevels: { AUDIT: 7 } });
    logger.log(7, "AUDIT", "audited");
    const out = getConsoleLog();
    expect(out).toContain('"level":"AUDIT"');
    expect(out).toContain('"levelId":7');
  });

  test("a custom level name colliding with a default level throws", () => {
    expect(() => new Logger<LevelLog>({ type: "hidden", customLevels: { INFO: 99 } })).toThrow(/collides/);
    expect(() => new Logger<LevelLog>({ type: "hidden", customLevels: { info: 99 } })).toThrow(/collides/);
  });

  test("a non-integer custom level id throws", () => {
    expect(() => new Logger<LevelLog>({ type: "hidden", customLevels: { NOTICE: 3.5 } })).not.toThrow();
    expect(() => new Logger<LevelLog>({ type: "hidden", customLevels: { BAD: Number.NaN } })).toThrow();
  });
});

describe("logger.addLevel at runtime", () => {
  test("addLevel registers a level and supports chaining", () => {
    const logger = new Logger<LevelLog>({ type: "hidden" });
    const record = logger.addLevel("AUDIT", 7).log(7, "AUDIT", "trail");
    expect(logger.settings.customLevels.AUDIT).toBe(7);
    expect(record?._logMeta.logLevelName).toBe("AUDIT");
    expect(record?._logMeta.logLevelId).toBe(7);
  });

  test("addLevel rejects a name that collides with a default level", () => {
    const logger = new Logger<LevelLog>({ type: "hidden" });
    expect(() => logger.addLevel("WARN", 99)).toThrow(/collides/);
  });
});

describe("sub-loggers inherit and extend custom levels", () => {
  test("a sub-logger inherits the parent's custom levels and may add its own", () => {
    const parent = new Logger<LevelLog>({ type: "hidden", customLevels: { NOTICE: 3.5 } });
    const child = parent.getSubLogger({ customLevels: { AUDIT: 7 } });
    expect(child.settings.customLevels).toEqual({ NOTICE: 3.5, AUDIT: 7 });
    expect(child.log(3.5, "NOTICE", "x")?._logMeta.logLevelName).toBe("NOTICE");
    expect(child.log(7, "AUDIT", "y")?._logMeta.logLevelName).toBe("AUDIT");
  });

  test("a sub-logger resolves a string minLevel against an inherited custom level", () => {
    const parent = new Logger<LevelLog>({ type: "hidden", customLevels: { NOTICE: 3.5 } });
    const child = parent.getSubLogger({ minLevel: "NOTICE" });
    expect(child.settings.minLevel).toBe(3.5);
  });
});
