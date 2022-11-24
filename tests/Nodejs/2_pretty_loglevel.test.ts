import "ts-jest";
import { Logger } from "../../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

const logger = new Logger({ type: "pretty" });

describe("Pretty: Log level", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("log object", (): void => {
    const logObj: any = logger.log(123, "test", "Test");
    expect(logObj?.["0"]).toContain("Test");
    expect(logObj?._meta?.logLevelId === 123).toBeTruthy();
    expect(logObj?._meta?.logLevelName).toContain("test");
  });

  test("silly (console)", (): void => {
    logger.silly("Test");
    expect(getConsoleLog()).toContain("SILLY");
    expect(getConsoleLog()).toContain("Test");
    expect(getConsoleLog()).toContain(`${new Date().toISOString().replace("T", " ")[0]}`); // ignore time
    expect(getConsoleLog()).toContain("/2_pretty_loglevel.test.ts:20");
  });

  test("trace (console)", (): void => {
    logger.trace("Test");
    expect(getConsoleLog()).toContain("TRACE");
    expect(getConsoleLog()).toContain("Test");
  });

  test("debug (console)", (): void => {
    logger.debug("Test");
    expect(getConsoleLog()).toContain("DEBUG");
    expect(getConsoleLog()).toContain("Test");
  });

  test("info (console)", (): void => {
    logger.info("Test");
    expect(getConsoleLog()).toContain("INFO");
    expect(getConsoleLog()).toContain("Test");
  });

  test("warn (console)", (): void => {
    logger.warn("Test");
    expect(getConsoleLog()).toContain("WARN");
    expect(getConsoleLog()).toContain("Test");
  });

  test("error (console)", (): void => {
    logger.error("Test");
    expect(getConsoleLog()).toContain("ERROR");
    expect(getConsoleLog()).toContain("Test");
  });

  test("fatal (console)", (): void => {
    logger.fatal("Test");
    expect(getConsoleLog()).toContain("FATAL");
    expect(getConsoleLog()).toContain("Test");
  });
});
