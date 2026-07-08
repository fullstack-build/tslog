import { Logger, LogLevel } from "../src/index.js";

describe("LogLevel enum", () => {
  test("exposes the seven default log level ids", () => {
    expect(LogLevel.SILLY).toBe(0);
    expect(LogLevel.TRACE).toBe(1);
    expect(LogLevel.DEBUG).toBe(2);
    expect(LogLevel.INFO).toBe(3);
    expect(LogLevel.WARN).toBe(4);
    expect(LogLevel.ERROR).toBe(5);
    expect(LogLevel.FATAL).toBe(6);
  });

  test("the default logging methods emit their matching level id", () => {
    const logger = new Logger({ type: "hidden" });
    expect(logger.silly("x")?._logMeta.logLevelId).toBe(LogLevel.SILLY);
    expect(logger.trace("x")?._logMeta.logLevelId).toBe(LogLevel.TRACE);
    expect(logger.debug("x")?._logMeta.logLevelId).toBe(LogLevel.DEBUG);
    expect(logger.info("x")?._logMeta.logLevelId).toBe(LogLevel.INFO);
    expect(logger.warn("x")?._logMeta.logLevelId).toBe(LogLevel.WARN);
    expect(logger.error("x")?._logMeta.logLevelId).toBe(LogLevel.ERROR);
    expect(logger.fatal("x")?._logMeta.logLevelId).toBe(LogLevel.FATAL);
  });

  test("can be used to drive minLevel", () => {
    const logger = new Logger({ type: "hidden", minLevel: LogLevel.WARN });
    expect(logger.info("below")).toBeUndefined();
    expect(logger.warn("at")).toBeDefined();
    expect(logger.error("above")).toBeDefined();
  });
});
