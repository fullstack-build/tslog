import "ts-jest";
import { Logger } from "../../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

const logger = new Logger({ type: "json" });

describe("JSON: Log level", () => {
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
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"runtime":"');
    expect(getConsoleLog()).toContain('"hostname":"');
    expect(getConsoleLog()).toContain(`"date":"${new Date().toISOString().split("T")[0]}`); // ignore time
    expect(getConsoleLog()).toContain('"logLevelId":0');
    expect(getConsoleLog()).toContain('"logLevelName":"SILLY"');
    expect(getConsoleLog()).toContain('"path":{');
    expect(getConsoleLog()).toContain('"filePath":"/tests/Nodejs/1_json_loglevel.test.ts",');
    expect(getConsoleLog()).toContain('"fileLine":"20"');
  });

  test("trace (console)", (): void => {
    logger.trace("Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"TRACE"');
  });

  test("debug (console)", (): void => {
    logger.debug("Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"DEBUG"');
  });

  test("info (console)", (): void => {
    logger.info("Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"INFO"');
  });

  test("warn (console)", (): void => {
    logger.warn("Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"WARN"');
  });

  test("error (console)", (): void => {
    logger.error("Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"ERROR"');
  });

  test("fatal (console)", (): void => {
    logger.fatal("Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"FATAL"');
  });
});
