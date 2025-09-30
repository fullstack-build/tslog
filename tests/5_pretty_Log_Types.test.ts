import "ts-jest";
import { Logger } from "../src/index.js";
import { getConsoleLogStripped, mockConsoleLog } from "./helper.js";

const getArgs = (value: unknown): unknown[] => (value as { args?: unknown[] })?.args ?? [];

class CustomError extends Error {
  constructor(
    message: string,
    public extraInfo: string,
  ) {
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
    expect(getConsoleLogStripped()).toContain("Test");
  });

  test("string interpolation", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Foo %s", "bar");
    expect(getConsoleLogStripped()).toContain("Foo bar");
  });

  test("two plain string", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLogStripped()).toContain("Test1 Test2");
  });

  it("pretty undefined", async () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info(undefined);

    expect(getConsoleLogStripped()).toContain("undefined");
  });

  it("pretty null", async () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info(null);

    expect(getConsoleLogStripped()).toContain("null");
  });

  it("pretty nullish", async () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info({ foo: null, bar: undefined });

    expect(getConsoleLogStripped()).toContain("null");
    expect(getConsoleLogStripped()).toContain("undefined");
  });

  test("boolean", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", true);
    expect(getConsoleLogStripped()).toContain("true");
  });

  test("number", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", 555);
    expect(getConsoleLogStripped()).toContain("555");
  });

  test("BigInt", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    const log = logger.info(42n);
    const args = getArgs(log);

    expect(args[0]).toBe(42n);
    expect(getConsoleLogStripped()).toContain("{");
  });

  test("null", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", null);
    expect(getConsoleLogStripped()).toContain("null");
  });

  test("Array, stylePrettyLogs: false", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    logger.log(1234, "testLevel", [1, 2, 3, "test"]);

    expect(getConsoleLogStripped()).toContain("[\n");
    expect(getConsoleLogStripped()).toContain("1");
    expect(getConsoleLogStripped()).toContain("2");
    expect(getConsoleLogStripped()).toContain("3");
    expect(getConsoleLogStripped()).toContain("'test'");
    expect(getConsoleLogStripped()).toContain("\n]");
  });

  test("Buffer", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    const buffer = Buffer.from("foo");
    const firstLog = logger.log(1234, "testLevel", buffer);
    const firstArgs = getArgs(firstLog);
    expect(Buffer.isBuffer(firstArgs[0])).toBe(true);
    expect((firstArgs[0] as Buffer).equals(buffer)).toBe(true);

    const secondLog = logger.log(1234, "testLevel", "1", buffer);
    const secondArgs = getArgs(secondLog);
    expect(secondArgs[0]).toBe("1");
    expect(Buffer.isBuffer(secondArgs[1])).toBe(true);
    expect((secondArgs[1] as Buffer).equals(buffer)).toBe(true);

    const output = getConsoleLogStripped();
    expect(output).toMatch(/'0':\s*102/);
    expect(output).toMatch(/'1':\s*111/);
    expect(output).toMatch(/'2':\s*111/);
  });

  test("Object", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    logger.log(1234, "testLevel", { test: true, nested: { 1: false } });
    const output = getConsoleLogStripped();
    expect(output).toContain("{\n");
    expect(output).toContain("test:");
    expect(output).toContain("nested:");
  });

  test("Date", (): void => {
    const logger = new Logger({ type: "pretty" });
    const date = new Date(0);
    logger.log(1234, "testLevel", date);
    expect(getConsoleLogStripped()).toContain("1970-01-01T00:00:00.000Z");
  });

  test("URL", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    const url = new URL("https://example.com");
    logger.log(1234, "testLevel", url);
    let output = getConsoleLogStripped();
    expect(output).toContain("https://example.com/");
    expect(output).toContain("protocol:");
    const url2 = new URL("https://example2.com");
    logger.log(1234, "testLevel", { url2 });
    output = getConsoleLogStripped();
    expect(output).toContain("url2:");
    expect(output).toContain("https://example2.com/");
  });

  test("Date", (): void => {
    const logger = new Logger({ type: "pretty" });
    const date = new Date(0);
    logger.log(1234, "testLevel", date);
    expect(getConsoleLogStripped()).toContain("1970-01-01T00:00:00.000Z");
  });

  test("Map", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    const map = new Map();
    const log = logger.log(1234, "testLevel", map);
    const args = getArgs(log);
    expect(args[0]).toBeInstanceOf(Map);
    expect((args[0] as Map<unknown, unknown>).size).toBe(0);
    expect(getConsoleLogStripped()).toContain("{");
  });

  test("Set", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    const set = new Set();
    const log = logger.log(1234, "testLevel", set);
    const args = getArgs(log);
    expect(args[0]).toBeInstanceOf(Set);
    expect((args[0] as Set<unknown>).size).toBe(0);
    expect(getConsoleLogStripped()).toContain("{");
  });

  test("String, Object", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    const log = logger.log(1234, "testLevel", "test", { test: true, nested: { 1: false } });
    const args = getArgs(log);
    expect(args[0]).toBe("test");
    expect(args[1]).toMatchObject({ test: true });
    const output = getConsoleLogStripped();
    expect(output).toContain("test {\n");
    expect(output).toContain("test:");
  });

  test("Object, String", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" });
    const log = logger.log(1234, "testLevel", { test: true, nested: { 1: false } }, "test");
    const args = getArgs(log);
    expect(args[0]).toMatchObject({ test: true });
    expect(args[1]).toBe("test");
    const output = getConsoleLogStripped();
    expect(output).toContain("{\n");
    expect(output).toContain("test:");
  });

  test("Error", (): void => {
    const logger = new Logger({ type: "pretty" });
    const errorLog = logger.log(1234, "testLevel", new Error("test"));
    expect(getConsoleLogStripped()).toContain("Error");
    expect(getConsoleLogStripped()).toContain("test");
    expect(getConsoleLogStripped()).toContain("error stack:\n");
    expect(getConsoleLogStripped()).toContain("5_pretty_Log_Types.test.ts");
    expect(getConsoleLogStripped()).toContain("Object.<anonymous>");
    expect(errorLog?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.stack as any)[0]?.fileName).toBe("5_pretty_Log_Types.test.ts");
  });

  test("Error with multiple parameters", (): void => {
    const logger = new Logger({ type: "pretty" });
    const errorLog = logger.log(1234, "testLevel", new CustomError("Something went wrong", "Additional info"));
    expect(getConsoleLogStripped()).toContain("Something went wrong");
    expect(getConsoleLogStripped()).toContain("Additional info");
    expect(getConsoleLogStripped()).toContain("Error");
    expect(getConsoleLogStripped()).toContain("test");
    expect(getConsoleLogStripped()).toContain("error stack:\n");
    expect(getConsoleLogStripped()).toContain("5_pretty_Log_Types.test.ts");
    expect(getConsoleLogStripped()).toContain("Object.<anonymous>");
    expect(errorLog?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.stack as any)[0]?.fileName).toBe("5_pretty_Log_Types.test.ts");
  });

  test("string and Error", (): void => {
    const logger = new Logger({ type: "pretty" });
    const errorLog = logger.log(1234, "testLevel", "test", new Error("test"));
    expect(getConsoleLogStripped()).toContain("Error");
    expect(getConsoleLogStripped()).toContain("test");
    expect(getConsoleLogStripped()).toContain("error stack:\n");
    expect(getConsoleLogStripped()).toContain("5_pretty_Log_Types.test.ts");
    expect(getConsoleLogStripped()).toContain("Object.<anonymous>");
    expect((errorLog?.["1"] as any)?.nativeError).toBeInstanceOf(Error);
    expect((errorLog?.["1"] as any)?.stack[0]?.fileName).toBe("5_pretty_Log_Types.test.ts");
  });

  test("Error cause chain pretty output", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    const deepest = new Error("deepest");
    const middle = new Error("middle");
    const top = new Error("top");
    (middle as Error & { cause?: unknown }).cause = deepest;
    (top as Error & { cause?: unknown }).cause = middle;

    logger.error(top);

    const output = getConsoleLogStripped();
    expect(output).toContain("Caused by (1): Error: middle");
    expect(output).toContain("Caused by (2): Error: deepest");
  });
});
