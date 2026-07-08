import { expect, test } from "@playwright/test";
import { captureConsole, inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("JSON: Log Types (browser)", () => {
  test("plain string", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "Test");
    `,
    );
    // v5 flat shape: a bare string is promoted to the top-level message key.
    expect(combined).toContain('"message":"Test"');
  });

  test("two plain string", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "Test1", "Test2");
    `,
    );
    // v5: the leading string becomes `message`; trailing positional args keep their numeric index keys.
    expect(combined).toContain('"message":"Test1"');
    expect(combined).toContain('"1":"Test2"');
  });

  test("pretty undefined", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.info(undefined);
    `,
    );
    expect(combined).toContain('"message":"[undefined]"');
  });

  test("pretty null", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.info(null);
    `,
    );
    expect(combined).toContain('"message":null');
  });

  test("pretty nullish", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.info({ foo: null, bar: undefined });
    `,
    );
    expect(combined).toContain('"foo":null');
    expect(combined).toContain('"bar":"[undefined]"');
  });

  test("boolean", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", true);
    `,
    );
    // v5: a single primitive arg is lifted to `message`.
    expect(combined).toContain('"message":true');
  });

  test("number", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", 555);
    `,
    );
    expect(combined).toContain('"message":555');
  });

  test("Array", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", [1, 2, 3, "test"]);
    `,
    );
    expect(combined).toContain("[1,2,3,");
  });

  test("Object", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", { test: true, nested: { 1: false } });
    `,
    );
    // v5: a single object arg has its keys spread at the top level; _logMeta now carries v:5.
    expect(combined).toContain('"test":true');
    expect(combined).toContain('"nested":{"1":false}');
    expect(combined).toContain('"_logMeta":{"v":5,');
  });

  test("Date", async ({ page }) => {
    const result = await inPage<{ isDate: boolean; time: number; expected: number }>(
      page,
      { type: "json" },
      `
      const date = new Date(0);
      const logger = new tslog.Logger(settings);
      const log1 = logger.log(1234, "testLevel", date);
      // v5: the returned in-memory logObj keeps the Date under its positional "0" key (matching the Node suite);
      // only the JSON output promotes it to the ISO message string (asserted below).
      return { isDate: log1["0"] instanceof Date, time: log1["0"].getTime(), expected: date.getTime() };
    `,
    );
    expect(result.isDate).toBe(true);
    expect(result.time).toBe(result.expected);

    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", new Date(0));
    `,
    );
    expect(combined).toContain('"1970-01-01T00:00:00.000Z"');
  });

  test("String, Object", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "test", { test: true, nested: { 1: false } });
    `,
    );
    // Leading string -> `message`; a single trailing plain object spreads at the top level,
    // symmetric with the pino-style object-first shape (mirrors the Node twin of this test).
    expect(combined).toContain('"message":"test"');
    expect(combined).toContain('"test":true');
    expect(combined).toContain('"nested":{"1":false}');
    expect(combined).not.toContain('"1":{');
  });

  test("Object, String", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", { test: true, nested: { 1: false } }, "test");
    `,
    );
    // v5 pino-style (M2.1): a leading object followed by a string spreads the object's fields at the top
    // level and promotes the trailing string to `message` (no numeric "0"/"1" buckets in the flat JSON shape).
    expect(combined).toContain('"message":"test"');
    expect(combined).toContain('"test":true');
    expect(combined).toContain('"nested":{"1":false}');
    expect(combined).not.toContain('"0":');
  });

  test("Error", async ({ page }) => {
    const result = await inPage<{ isError: boolean; isArray: boolean; name: string; message: string }>(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      const errorLog = logger.log(1234, "testLevel", new Error("test"));
      const serializedError = errorLog;
      return {
        isError: serializedError.nativeError instanceof Error,
        isArray: Array.isArray(serializedError.nativeError),
        name: serializedError.name,
        message: serializedError.message,
      };
    `,
    );
    expect(result.isError).toBe(true);
    expect(result.isArray).toBe(false);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("test");
  });

  test("BigInt is stringified", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      logger.info(42n);
    `,
    );
    // v5: single bigint arg -> `message`, stringified (JSON has no bigint).
    expect(combined).toContain('"message":"42"');
  });

  test("Error with cause chain", async ({ page }) => {
    const result = await inPage<{ middle: unknown; deepest: unknown; beyond: unknown }>(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      const deepest = new Error("deepest");
      const middle = new Error("middle");
      const top = new Error("top");
      middle.cause = deepest;
      top.cause = middle;
      const errorObject = logger.error(top);
      return {
        middle: errorObject.cause.message,
        deepest: errorObject.cause.cause.message,
        beyond: errorObject.cause.cause.cause,
      };
    `,
    );
    expect(result.middle).toBe("middle");
    expect(result.deepest).toBe("deepest");
    expect(result.beyond).toBeUndefined();
  });

  test("Error cause cycle protection", async ({ page }) => {
    const result = await inPage<{ cause: unknown }>(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      const cyclic = new Error("cycle");
      cyclic.cause = cyclic;
      const errorLog = logger.error(cyclic);
      return { cause: errorLog.cause };
    `,
    );
    expect(result.cause).toBeUndefined();
  });

  test("Error without stack returns empty trace", async ({ page }) => {
    const result = await inPage<{ isArray: boolean; length: number }>(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      const error = new Error("nostack");
      error.stack = undefined;
      const errorObject = logger.error(error);
      return { isArray: Array.isArray(errorObject.stack), length: errorObject.stack.length };
    `,
    );
    expect(result.isArray).toBe(true);
    expect(result.length).toBe(0);
  });

  test("Error cause depth capped at five", async ({ page }) => {
    const result = await inPage<{ depth: number }>(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      let current = new Error("cause-0");
      for (let i = 1; i <= 6; i += 1) {
        const next = new Error("cause-" + i);
        next.cause = current;
        current = next;
      }
      const errorLog = logger.error(current);
      let depth = 0;
      let cursor = errorLog;
      while (cursor && cursor.cause) {
        cursor = cursor.cause;
        depth += 1;
      }
      return { depth };
    `,
    );
    expect(result.depth).toBeLessThanOrEqual(5);
  });

  test("string and Error", async ({ page }) => {
    const result = await inPage<{ isError: boolean; name: string; message: string }>(
      page,
      { type: "json" },
      `
      const logger = new tslog.Logger(settings);
      const errorLog = logger.log(1234, "testLevel", "test", new Error("test"));
      const serializedError = errorLog["1"];
      return {
        isError: serializedError.nativeError instanceof Error,
        name: serializedError.name,
        message: serializedError.message,
      };
    `,
    );
    expect(result.isError).toBe(true);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("test");
  });
});
