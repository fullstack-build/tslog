import "ts-jest";
import { Logger } from "../../src";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("JSON: Log Types", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
  });

  test("two plain string", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain('"0":"Test1"');
    expect(getConsoleLog()).toContain('"1":"Test2"');
  });

  test("boolean", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", true);
    expect(getConsoleLog()).toContain('"0":true');
  });

  test("number", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", 555);
    expect(getConsoleLog()).toContain('"0":555');
  });

  test("Array", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", [1, 2, 3, "test"]);
    expect(getConsoleLog()).toContain(`[1,2,3,`);
  });

  test("Buffer", (): void => {
    const logger = new Logger({ type: "json" });
    const buffer = Buffer.from("foo");
    const log1 = logger.log(1234, "testLevel", buffer);
    expect(getConsoleLog()).toContain(`"Buffer"`);
    expect(log1?.["0"]).toBe(buffer);
    const log2 = logger.log(1234, "testLevel", "1", buffer);
    expect(log2?.["1"]).toBe(buffer);
  });

  test("Object", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", { test: true, nested: { 1: false } });
    expect(getConsoleLog()).toContain(`{"test":true,"nested":{"1":false},"_meta":{`);
  });

  test("Date", (): void => {
    const logger = new Logger({ type: "json" });
    const date = new Date(0);
    const log1 = logger.log(1234, "testLevel", date);
    expect(log1?.["0"]).toStrictEqual(date);
    expect(getConsoleLog()).toContain(`"1970-01-01T00:00:00.000Z"`);
  });

  test("String, Object", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "test", { test: true, nested: { 1: false } });
    expect(getConsoleLog()).toContain('"0":"test"');
    expect(getConsoleLog()).toContain(`"1":{"test":true,"nested":{"1":false}},`);
  });

  test("Object, String", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", { test: true, nested: { 1: false } }, "test");
    expect(getConsoleLog()).toContain(`"0":{"test":true,"nested":{"1":false}},`);
    expect(getConsoleLog()).toContain('"1":"test"');
  });

  test("Error", (): void => {
    const logger = new Logger({ type: "json" });
    const errorLog = logger.log(1234, "testLevel", new Error("test"));
    expect(getConsoleLog()).toContain('"nativeError":{},');
    expect(getConsoleLog()).toContain('"filePath":"/tests/Nodejs/4_json_Log_Types.test.ts",');
    expect(getConsoleLog()).toContain('"method":"Object.<anonymous>"');
    expect(errorLog?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.stack as any)[0]?.fileName).toBe("4_json_Log_Types.test.ts");
  });

  test("string and Error", (): void => {
    const logger = new Logger({ type: "json" });
    const errorLog = logger.log(1234, "testLevel", "test", new Error("test"));
    expect(getConsoleLog()).toContain('"nativeError":{},');
    expect(getConsoleLog()).toContain('"filePath":"/tests/Nodejs/4_json_Log_Types.test.ts",');
    expect(getConsoleLog()).toContain('"method":"Object.<anonymous>"');
    expect((errorLog?.["1"] as any)?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.["1"] as any)?.stack[0]?.fileName).toBe("4_json_Log_Types.test.ts");
  });
});
