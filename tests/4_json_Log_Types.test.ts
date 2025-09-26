import "ts-jest";
import { Logger } from "../src/index.js";
import { IErrorObject, ILogObj, ILogObjMeta } from "../src/interfaces.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

function extractError(logResult: (ILogObj & ILogObjMeta) | undefined, position: string = "0"): IErrorObject | undefined {
  if (logResult == null) {
    return undefined;
  }
  const candidate = logResult as unknown as Record<string, unknown>;
  if ("nativeError" in candidate && typeof candidate.nativeError === "object") {
    return candidate as unknown as IErrorObject;
  }
  return candidate[position] as IErrorObject | undefined;
}

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

  it("pretty undefined", async () => {
    const logger = new Logger({ type: "json" });
    logger.info(undefined);
    expect(getConsoleLog()).toContain('"0":"[undefined]"');
  });

  it("pretty null", async () => {
    const logger = new Logger({ type: "json" });
    logger.info(null);
    expect(getConsoleLog()).toContain('"0":null');
  });

  it("pretty nullish", async () => {
    const logger = new Logger({ type: "json" });
    logger.info({ foo: null, bar: undefined });

    expect(getConsoleLog()).toContain('"foo":null');
    expect(getConsoleLog()).toContain('"bar":"[undefined]"');
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
    const errorLog = logger.log(1234, "testLevel", new Error("test")) as (ILogObj & ILogObjMeta) | undefined;
    const serializedError = extractError(errorLog);
    expect(serializedError?.nativeError).toBeInstanceOf(Error);
    expect(serializedError?.stack?.[0]?.fileName).toBe("4_json_Log_Types.test.ts");
    expect(serializedError?.stack?.[0]?.method).toBe("Object.<anonymous>");
    expect(serializedError?.nativeError).not.toBeInstanceOf(Array);
  });

  test("BigInt is stringified", (): void => {
    const logger = new Logger({ type: "json" });
    logger.info(42n);

    expect(getConsoleLog()).toContain('"0":"42"');
  });

  test("Error with cause chain", (): void => {
    const logger = new Logger({ type: "json" });
    const deepest = new Error("deepest");
    const middle = new Error("middle");
    const top = new Error("top");
    (middle as Error & { cause?: unknown }).cause = deepest;
    (top as Error & { cause?: unknown }).cause = middle;

    const errorLog = logger.error(top) as (ILogObj & ILogObjMeta) | undefined;
    const errorObject = extractError(errorLog);

    expect(errorObject?.cause?.message).toBe("middle");
    expect(errorObject?.cause?.cause?.message).toBe("deepest");
    expect(errorObject?.cause?.cause?.cause).toBeUndefined();
  });

  test("Error cause cycle protection", (): void => {
    const logger = new Logger({ type: "json" });
    const cyclic = new Error("cycle");
    (cyclic as Error & { cause?: unknown }).cause = cyclic;

    const errorLog = logger.error(cyclic) as (ILogObj & ILogObjMeta) | undefined;
    const errorObject = extractError(errorLog);

    expect(errorObject?.cause).toBeUndefined();
  });

  test("Error without stack returns empty trace", (): void => {
    const logger = new Logger({ type: "json" });
    const error = new Error("nostack");
    (error as Error & { stack?: string }).stack = undefined;

    const errorLog = logger.error(error) as (ILogObj & ILogObjMeta) | undefined;
    const errorObject = extractError(errorLog);

    expect(Array.isArray(errorObject?.stack)).toBe(true);
    expect(errorObject?.stack?.length).toBe(0);
  });

  test("Error cause depth capped at five", (): void => {
    const logger = new Logger({ type: "json" });
    let current: Error = new Error("cause-0");
    for (let i = 1; i <= 6; i += 1) {
      const next = new Error(`cause-${i}`);
      (next as Error & { cause?: unknown }).cause = current;
      current = next;
    }

    const errorLog = logger.error(current) as (ILogObj & ILogObjMeta) | undefined;
    const root = extractError(errorLog);

    let depth = 0;
    let cursor: IErrorObject | undefined | null = root;
    while (cursor?.cause) {
      cursor = cursor.cause;
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(5);
  });

  test("string and Error", (): void => {
    const logger = new Logger({ type: "json" });
    const errorLog = logger.log(1234, "testLevel", "test", new Error("test")) as (ILogObj & ILogObjMeta) | undefined;
    const serializedError = extractError(errorLog, "1");
    expect(serializedError?.nativeError).toBeInstanceOf(Error);
    expect(serializedError?.stack?.[0]?.fileName).toBe("4_json_Log_Types.test.ts");
  });
});
