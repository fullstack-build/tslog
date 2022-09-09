import "ts-jest";
import { Logger } from "../../src";
import { getConsoleLog, mockConsoleLog } from "./helper";

describe("Pretty: Log Types", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Foo %s", "bar");
    //expect(getConsoleLog()).toContain("Foo bar");
  });

  test("string interpolation", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain("Test");
  });

  test("two plain string", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain("Test1 Test2");
  });

  test("boolean", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", true);
    expect(getConsoleLog()).toContain("true");
  });

  test("number", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", 555);
    expect(getConsoleLog()).toContain("555");
  });

  test("Array, stylePrettyLogs: false", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.log(1234, "testLevel", [1, 2, 3, "test"]);

    expect(getConsoleLog()).toContain("[\n");
    expect(getConsoleLog()).toContain("1");
    expect(getConsoleLog()).toContain("2");
    expect(getConsoleLog()).toContain("3");
    expect(getConsoleLog()).toContain("'test'");
    expect(getConsoleLog()).toContain("\n]");
  });

  test("Object", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", { test: true, nested: { 1: false } });
    expect(getConsoleLog()).toContain("{\n");
    expect(getConsoleLog()).toContain("test:");
    expect(getConsoleLog()).toContain(`  }
}`);
  });

  test("String, Object", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "test", { test: true, nested: { 1: false } });
    expect(getConsoleLog()).toContain("test {\n");
    expect(getConsoleLog()).toContain("test:");
    expect(getConsoleLog()).toContain(`  }
}`);
  });

  test("Object, String", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", { test: true, nested: { 1: false } }, "test");
    expect(getConsoleLog()).toContain("{\n");
    expect(getConsoleLog()).toContain("test:");
    expect(getConsoleLog()).toContain(`  }
} test`);
  });

  test("Error", (): void => {
    const logger = new Logger({ type: "pretty" });
    const errorLog = logger.log(1234, "testLevel", new Error("test"));
    expect(getConsoleLog()).toContain("Error");
    expect(getConsoleLog()).toContain("test");
    expect(getConsoleLog()).toContain("error stack:\n");
    expect(getConsoleLog()).toContain("5_pretty_Log_Types.test.ts");
    expect(getConsoleLog()).toContain("Object.<anonymous>");
    expect(errorLog.nativeError).toBeInstanceOf(Error);
    expect(errorLog?.stack[0]?.fileName).toBe("5_pretty_Log_Types.test.ts");
  });

  test("string and Error", (): void => {
    const logger = new Logger({ type: "pretty" });
    const errorLog = logger.log(1234, "testLevel", "test", new Error("test"));
    expect(getConsoleLog()).toContain("Error");
    expect(getConsoleLog()).toContain("test");
    expect(getConsoleLog()).toContain("error stack:\n");
    expect(getConsoleLog()).toContain("5_pretty_Log_Types.test.ts");
    expect(getConsoleLog()).toContain("Object.<anonymous>");
    expect((errorLog?.["1"] as any)?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.["1"] as any)?.stack[0]?.fileName).toBe("5_pretty_Log_Types.test.ts");
  });
});
