import "ts-jest";
import { Logger, BaseLogger } from "../../src";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

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
    const logger = new BaseLogger<ILogObj>({ type: "json" }, defaultLogObject);
    const logMsg = logger.log(1234, "testLevel", "Test");
    expect(logMsg?.name).toContain(defaultLogObject.name);
    expect(getConsoleLog()).toContain(`"name":"test",`);
    expect(getConsoleLog()).toContain(`"0":"Test",`);
  });

  test("Logger with LogObj", (): void => {
    const defaultLogObject: ILogObj = {
      name: "test",
    };
    const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
    const logMsg = logger.log(1234, "testLevel", "Test");
    expect(logMsg?.name).toContain(defaultLogObject.name);
    expect(getConsoleLog()).toContain(`"name":"test",`);
    expect(getConsoleLog()).toContain(`"0":"Test",`);
  });

  test("Logger with LogObj: silly", (): void => {
    const defaultLogObject: ILogObj = {
      name: "test",
    };
    const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
    const logMsg = logger.silly("Test");
    expect(logMsg?.name).toContain(defaultLogObject.name);
    expect(getConsoleLog()).toContain(`"name":"test",`);
    expect(getConsoleLog()).toContain(`"0":"Test",`);
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
    expect(getConsoleLog()).toContain(`"0":"Test",`);
    expect(getConsoleLog()).toContain(`"functionCall":"test",`);
  });

  test("Logger with LogObj as an Array", (): void => {
    const defaultLogObject = ["1", "2", "3"];
    const logger = new Logger<string[]>({ type: "json" }, defaultLogObject);
    const logMsg = logger.silly("Test");
    expect(logMsg?.[0]).toContain(defaultLogObject[0]);
    expect(getConsoleLog()).toContain(`"0":"1",`);
    expect(getConsoleLog()).toContain(`"1":"2",`);
    expect(getConsoleLog()).toContain(`"2":"3"`);
  });
});
