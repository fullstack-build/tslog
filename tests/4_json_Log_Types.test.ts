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
    // v5 flat shape: a bare string is promoted to the configurable messageKey (default "message").
    expect(getConsoleLog()).toContain('"message":"Test"');
  });

  test("two plain string", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    // v5: the leading string becomes `message`; trailing positional args keep their numeric index keys.
    expect(getConsoleLog()).toContain('"message":"Test1"');
    expect(getConsoleLog()).toContain('"1":"Test2"');
  });

  it("pretty undefined", async () => {
    const logger = new Logger({ type: "json" });
    logger.info(undefined);
    expect(getConsoleLog()).toContain('"message":"[undefined]"');
  });

  it("pretty null", async () => {
    const logger = new Logger({ type: "json" });
    logger.info(null);
    expect(getConsoleLog()).toContain('"message":null');
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
    // v5: a single primitive arg is lifted to `message`.
    expect(getConsoleLog()).toContain('"message":true');
  });

  test("number", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", 555);
    expect(getConsoleLog()).toContain('"message":555');
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
    // v5: a single object arg has its keys spread at the top level (next to level/time); _meta now carries v:5.
    expect(getConsoleLog()).toContain(`"test":true`);
    expect(getConsoleLog()).toContain(`"nested":{"1":false}`);
    expect(getConsoleLog()).toContain(`"_meta":{"v":5,`);
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
    // Leading string -> `message`; a single trailing plain object spreads at the top level,
    // symmetric with the pino-style object-first shape.
    expect(getConsoleLog()).toContain('"message":"test"');
    expect(getConsoleLog()).toContain('"test":true');
    expect(getConsoleLog()).toContain('"nested":{"1":false}');
    expect(getConsoleLog()).not.toContain('"1":{');
  });

  test("String, Object and Object, String produce the same flat fields", (): void => {
    const logger = new Logger({ type: "json" });
    logger.info("ready", { userId: 42 });
    const messageFirst = getConsoleLog();
    mockConsoleLog(true, false);
    logger.info({ userId: 42 }, "ready");
    const objectFirst = getConsoleLog();

    for (const line of [messageFirst, objectFirst]) {
      expect(line).toContain('"message":"ready"');
      expect(line).toContain('"userId":42');
      expect(line).not.toContain('"0":');
      expect(line).not.toContain('"1":');
    }
  });

  test("String with two trailing values keeps positional bucketing", (): void => {
    const logger = new Logger({ type: "json" });
    logger.info("msg", { a: 1 }, { b: 2 });
    expect(getConsoleLog()).toContain('"message":"msg"');
    expect(getConsoleLog()).toContain('"1":{"a":1}');
    expect(getConsoleLog()).toContain('"2":{"b":2}');
  });

  test("user fields cannot clobber the canonical level/levelId/time head keys", (): void => {
    const logger = new Logger({ type: "json" });
    logger.info({ level: "fake", levelId: -1, time: "fake-time", ok: true });
    expect(getConsoleLog()).toContain('"level":"INFO"');
    expect(getConsoleLog()).toContain('"levelId":3');
    expect(getConsoleLog()).not.toContain('"level":"fake"');
    expect(getConsoleLog()).not.toContain('"time":"fake-time"');
    expect(getConsoleLog()).toContain('"ok":true');
  });

  test("Object, String", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", { test: true, nested: { 1: false } }, "test");
    // v5 pino-style (M2.1): a leading object followed by a string spreads the object's fields at the top
    // level and promotes the trailing string to `message`. So `({ test, nested }, "test")` → message "test"
    // with `test` and `nested` lifted alongside it (no numeric "0"/"1" buckets in the flat JSON shape).
    const out = getConsoleLog();
    expect(out).toContain('"message":"test"');
    expect(out).toContain('"test":true');
    expect(out).toContain('"nested":{"1":false}');
    expect(out).not.toContain('"0":');
  });

  test("pino-style fields-first: log.info({ fields }, message)", (): void => {
    const logger = new Logger({ type: "json" });
    logger.info({ userId: 42, action: "login" }, "user logged in");
    const out = getConsoleLog();
    // The idiomatic pino call shape: object fields spread at the top level, string under `message`.
    expect(out).toContain('"message":"user logged in"');
    expect(out).toContain('"userId":42');
    expect(out).toContain('"action":"login"');
    expect(out).not.toContain('"0":');
    expect(out).not.toContain('"1":');
  });

  test("Error", (): void => {
    const logger = new Logger({ type: "json" });
    const errorLog = logger.log(1234, "testLevel", new Error("test")) as (ILogObj & ILogObjMeta) | undefined;
    const serializedError = extractError(errorLog);
    expect(serializedError?.nativeError).toBeInstanceOf(Error);
    expect(serializedError?.stack?.[0]?.fileName).toBe("4_json_Log_Types.test.ts");
    expect(serializedError?.nativeError).not.toBeInstanceOf(Array);
  });

  test("bare Error in JSON output nests under errorKey with cause chain, no nativeError leak", (): void => {
    const logger = new Logger({ type: "json" });
    logger.error(new Error("wrapped", { cause: new Error("root cause") }));
    const out = getConsoleLog();
    const parsed = JSON.parse(out.trim().split("\n").pop() as string);
    // The error is nested under `error` (not spread as loose top-level name/stack/nativeError fields)...
    expect(parsed.error?.message).toBe("wrapped");
    expect(parsed).not.toHaveProperty("nativeError");
    expect(parsed).not.toHaveProperty("stack");
    // ...and the cause chain is preserved.
    expect(parsed.error?.cause?.message).toBe("root cause");
    // The non-serializable native Error must never leak into the JSON line.
    expect(out).not.toContain("nativeError");
  });

  test("BigInt is stringified", (): void => {
    const logger = new Logger({ type: "json" });
    logger.info(42n);

    // v5: single bigint arg -> `message`, stringified (JSON has no bigint).
    expect(getConsoleLog()).toContain('"message":"42"');
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
