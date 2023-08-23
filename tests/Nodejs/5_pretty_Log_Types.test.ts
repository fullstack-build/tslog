import "ts-jest";
import { Logger } from "../../src";
import { getConsoleLog, mockConsoleLog } from "./helper.js";
import { stdout } from "process";

class CustomError extends Error {
  constructor(message: string, public extraInfo: string) {
    super(message);
    Object.setPrototypeOf(this, CustomError.prototype);
  }
}

describe("Pretty: Log Types", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain("Test");
  });

  test("string interpolation", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Foo %s", "bar");
    expect(getConsoleLog()).toContain("Foo bar");
  });

  test("two plain string", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain("Test1 Test2");
  });

  it("pretty undefined", async () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info(undefined);

    expect(getConsoleLog()).toContain("undefined");
  });

  it("pretty null", async () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info(null);

    expect(getConsoleLog()).toContain("null");
  });

  it("pretty nullish", async () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info({ foo: null, bar: undefined });

    expect(getConsoleLog()).toContain("null");
    expect(getConsoleLog()).toContain("undefined");
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

  test("null", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", null);
    expect(getConsoleLog()).toContain("null");
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

  test("Buffer", (): void => {
    const logger = new Logger({ type: "pretty" });
    const buffer = Buffer.from("foo");
    logger.log(1234, "testLevel", buffer);
    expect(getConsoleLog()).toContain(`<Buffer 66 6f 6f>`);
    logger.log(1234, "testLevel", "1", buffer);
    expect(getConsoleLog()).toContain(`1 <Buffer 66 6f 6f>`);
  });

  test("Object", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", { test: true, nested: { 1: false } });
    expect(getConsoleLog()).toContain("{\n");
    expect(getConsoleLog()).toContain("test:");
    expect(getConsoleLog()).toContain(`  }
}`);
  });

  test("Date", (): void => {
    const logger = new Logger({ type: "pretty" });
    const date = new Date(0);
    logger.log(1234, "testLevel", date);
    expect(getConsoleLog()).toContain("1970-01-01T00:00:00.000Z");
  });

  test("URL", (): void => {
    const logger = new Logger({ type: "pretty" });
    const url = new URL("https://example.com");
    logger.log(1234, "testLevel", url);
    expect(getConsoleLog()).toContain("https://example.com/");
    expect(getConsoleLog()).toContain("protocol:");
    const url2 = new URL("https://example2.com");
    logger.log(1234, "testLevel", { url2 });
    expect(getConsoleLog()).toContain("url2: {");
    expect(getConsoleLog()).toContain("https://example2.com/");
  });

  test("Date", (): void => {
    const logger = new Logger({ type: "pretty" });
    const date = new Date(0);
    logger.log(1234, "testLevel", date);
    expect(getConsoleLog()).toContain("1970-01-01T00:00:00.000Z");
  });

  test("Map", (): void => {
    const logger = new Logger({ type: "pretty" });
    const map = new Map();
    logger.log(1234, "testLevel", map);
    expect(getConsoleLog()).toContain("Map(0) {}");
  });

  test("Set", (): void => {
    const logger = new Logger({ type: "pretty" });
    const set = new Set();
    logger.log(1234, "testLevel", set);
    expect(getConsoleLog()).toContain("Set(0) {}");
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
    expect(errorLog?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.stack as any)[0]?.fileName).toBe("5_pretty_Log_Types.test.ts");
  });

  test("Error with multiple parameters", (): void => {
    const logger = new Logger({ type: "pretty" });
    const errorLog = logger.log(1234, "testLevel", new CustomError("Something went wrong", "Additional info"));
    expect(getConsoleLog()).toContain("Something went wrong");
    expect(getConsoleLog()).toContain("Additional info");
    expect(getConsoleLog()).toContain("Error");
    expect(getConsoleLog()).toContain("test");
    expect(getConsoleLog()).toContain("error stack:\n");
    expect(getConsoleLog()).toContain("5_pretty_Log_Types.test.ts");
    expect(getConsoleLog()).toContain("Object.<anonymous>");
    expect(errorLog?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.stack as any)[0]?.fileName).toBe("5_pretty_Log_Types.test.ts");
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
