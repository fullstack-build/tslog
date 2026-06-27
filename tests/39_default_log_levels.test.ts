import { DefaultLogLevels, Logger } from "../src/index.js";

describe("DefaultLogLevels enum", () => {
  test("exposes the seven default log level ids", () => {
    expect(DefaultLogLevels.SILLY).toBe(0);
    expect(DefaultLogLevels.TRACE).toBe(1);
    expect(DefaultLogLevels.DEBUG).toBe(2);
    expect(DefaultLogLevels.INFO).toBe(3);
    expect(DefaultLogLevels.WARN).toBe(4);
    expect(DefaultLogLevels.ERROR).toBe(5);
    expect(DefaultLogLevels.FATAL).toBe(6);
  });

  test("the default logging methods emit their matching level id", () => {
    const logger = new Logger({ type: "hidden" });
    expect(logger.silly("x")?._meta.logLevelId).toBe(DefaultLogLevels.SILLY);
    expect(logger.trace("x")?._meta.logLevelId).toBe(DefaultLogLevels.TRACE);
    expect(logger.debug("x")?._meta.logLevelId).toBe(DefaultLogLevels.DEBUG);
    expect(logger.info("x")?._meta.logLevelId).toBe(DefaultLogLevels.INFO);
    expect(logger.warn("x")?._meta.logLevelId).toBe(DefaultLogLevels.WARN);
    expect(logger.error("x")?._meta.logLevelId).toBe(DefaultLogLevels.ERROR);
    expect(logger.fatal("x")?._meta.logLevelId).toBe(DefaultLogLevels.FATAL);
  });

  test("can be used to drive minLevel", () => {
    const logger = new Logger({ type: "hidden", minLevel: DefaultLogLevels.WARN });
    expect(logger.info("below")).toBeUndefined();
    expect(logger.warn("at")).toBeDefined();
    expect(logger.error("above")).toBeDefined();
  });
});
