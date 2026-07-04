import { createNodeEnvironment } from "../src/env/environment.node.js";
import { BaseLogger, Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";
import { captureDefaultJsonLines } from "./support/stdoutCapture.js";

interface ILogObj {
  name: string;
  functionCall?: () => string;
}

describe("JSON: LogObj", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("BaseLogger with LogObj", (): void => {
    const defaultLogObject: ILogObj = {
      name: "test",
    };
    const logger = new BaseLogger<ILogObj>({ type: "json" }, defaultLogObject, createNodeEnvironment());
    // The NODE provider routes json through the buffered stdout sink, not console.log.
    let logMsg: (ILogObj & Record<string, unknown>) | undefined;
    const emitted = captureDefaultJsonLines(() => {
      logMsg = logger.log(1234, "testLevel", "Test") as (ILogObj & Record<string, unknown>) | undefined;
    }).join("\n");
    expect(logMsg?.name).toContain(defaultLogObject.name);
    expect(emitted).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(emitted).toContain(`"message":"Test",`);
  });

  test("Logger with LogObj", (): void => {
    const defaultLogObject: ILogObj = {
      name: "test",
    };
    const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
    const logMsg = logger.log(1234, "testLevel", "Test");
    expect(logMsg?.name).toContain(defaultLogObject.name);
    expect(getConsoleLog()).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(getConsoleLog()).toContain(`"message":"Test",`);
  });

  test("Logger with LogObj: silly", (): void => {
    const defaultLogObject: ILogObj = {
      name: "test",
    };
    const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
    const logMsg = logger.silly("Test");
    expect(logMsg?.name).toContain(defaultLogObject.name);
    expect(getConsoleLog()).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(getConsoleLog()).toContain(`"message":"Test",`);
  });

  test("Logger with LogObj: function call", (): void => {
    const defaultLogObject: ILogObj = {
      name: "test",
      functionCall: () => "test",
    };
    const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
    const logMsg = logger.silly("Test");
    expect(logMsg?.name).toContain(defaultLogObject.name);
    expect(logMsg?.functionCall).toContain("test");
    expect(getConsoleLog()).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(getConsoleLog()).toContain(`"message":"Test",`);
    expect(getConsoleLog()).toContain(`"functionCall":"test",`);
  });

  test("Logger with LogObj as an Array", (): void => {
    const defaultLogObject = ["1", "2", "3"];
    const logger = new Logger<string[]>({ type: "json" }, defaultLogObject);
    const logMsg = logger.silly("Test");
    expect(logMsg?.[0]).toContain(defaultLogObject[0]);
    // The default-logObj array spreads index-keyed (0,1,2) and overwrites the bare "Test" at index 0.
    // In the v5 flat shape index key "0" ("1") is promoted to the top-level message key; "1"/"2" remain.
    expect(getConsoleLog()).toContain(`"message":"1",`);
    expect(getConsoleLog()).toContain(`"1":"2",`);
    expect(getConsoleLog()).toContain(`"2":"3"`);
  });
});
