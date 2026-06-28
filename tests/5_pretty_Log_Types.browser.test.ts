import { expect, test } from "@playwright/test";
import { captureConsole, inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("Pretty: Log Types (browser)", () => {
  test("plain string", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "Test");
    `,
    );
    expect(combined).toContain("Test");
  });

  test("string interpolation", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "Foo %s", "bar");
    `,
    );
    expect(combined).toContain("Foo bar");
  });

  test("two plain string", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "Test1", "Test2");
    `,
    );
    expect(combined).toContain("Test1 Test2");
  });

  test("pretty undefined", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.info(undefined);
    `,
    );
    expect(combined).toContain("undefined");
  });

  test("pretty null", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.info(null);
    `,
    );
    expect(combined).toContain("null");
  });

  test("pretty nullish", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.info({ foo: null, bar: undefined });
    `,
    );
    expect(combined).toContain("null");
    expect(combined).toContain("undefined");
  });

  test("boolean", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", true);
    `,
    );
    expect(combined).toContain("true");
  });

  test("number", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", 555);
    `,
    );
    expect(combined).toContain("555");
  });

  test("BigInt", async ({ page }) => {
    const result = await inPage<{ isBigInt: boolean; equals: boolean }>(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      const log = logger.info(42n);
      const value = log.args[0];
      return { isBigInt: typeof value === "bigint", equals: value === 42n };
    `,
    );
    expect(result.isBigInt).toBe(true);
    expect(result.equals).toBe(true);

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.info(42n);
    `,
    );
    // A bigint renders with the trailing "n" (like Node's util.inspect), not as an empty object.
    expect(combined).toContain("42n");
    expect(combined).not.toContain("{");
  });

  test("null", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", null);
    `,
    );
    expect(combined).toContain("null");
  });

  test("Array, stylePrettyLogs: false", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", [1, 2, 3, "test"]);
    `,
    );
    expect(combined).toContain("[\n");
    expect(combined).toContain("1");
    expect(combined).toContain("2");
    expect(combined).toContain("3");
    expect(combined).toContain("'test'");
    expect(combined).toContain("\n]");
  });

  test("Object", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", { test: true, nested: { 1: false } });
    `,
    );
    expect(combined).toContain("{\n");
    expect(combined).toContain("test:");
    expect(combined).toContain("nested:");
  });

  test("Date", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", new Date(0));
    `,
    );
    expect(combined).toContain("1970-01-01T00:00:00.000Z");
  });

  test("URL", async ({ page }) => {
    const first = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", new URL("https://example.com"));
    `,
    );
    expect(first.combined).toContain("https://example.com/");
    expect(first.combined).toContain("protocol:");

    const second = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", { url2: new URL("https://example2.com") });
    `,
    );
    expect(second.combined).toContain("url2:");
    expect(second.combined).toContain("https://example2.com/");
  });

  test("Map", async ({ page }) => {
    const result = await inPage<{ isMap: boolean; size: number }>(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      const log = logger.log(1234, "testLevel", new Map());
      const value = log.args[0];
      return { isMap: value instanceof Map, size: value.size };
    `,
    );
    expect(result.isMap).toBe(true);
    expect(result.size).toBe(0);

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", new Map());
    `,
    );
    expect(combined).toContain("{");
  });

  test("Set", async ({ page }) => {
    const result = await inPage<{ isSet: boolean; size: number }>(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      const log = logger.log(1234, "testLevel", new Set());
      const value = log.args[0];
      return { isSet: value instanceof Set, size: value.size };
    `,
    );
    expect(result.isSet).toBe(true);
    expect(result.size).toBe(0);

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", new Set());
    `,
    );
    expect(combined).toContain("{");
  });

  test("String, Object", async ({ page }) => {
    const result = await inPage<{ arg0: unknown; arg1Test: unknown }>(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      const log = logger.log(1234, "testLevel", "test", { test: true, nested: { 1: false } });
      return { arg0: log.args[0], arg1Test: log.args[1].test };
    `,
    );
    expect(result.arg0).toBe("test");
    expect(result.arg1Test).toBe(true);

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "test", { test: true, nested: { 1: false } });
    `,
    );
    expect(combined).toContain("test {\n");
    expect(combined).toContain("test:");
  });

  test("Object, String", async ({ page }) => {
    const result = await inPage<{ arg0Test: unknown; arg1: unknown }>(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      const log = logger.log(1234, "testLevel", { test: true, nested: { 1: false } }, "test");
      return { arg0Test: log.args[0].test, arg1: log.args[1] };
    `,
    );
    expect(result.arg0Test).toBe(true);
    expect(result.arg1).toBe("test");

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false, argumentsArrayName: "args" },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", { test: true, nested: { 1: false } }, "test");
    `,
    );
    expect(combined).toContain("{\n");
    expect(combined).toContain("test:");
  });

  test("Error", async ({ page }) => {
    const isError = await inPage<boolean>(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      const errorLog = logger.log(1234, "testLevel", new Error("test"));
      return errorLog.nativeError instanceof Error;
    `,
    );
    expect(isError).toBe(true);

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", new Error("test"));
    `,
    );
    expect(combined).toContain("Error");
    expect(combined).toContain("test");
    expect(combined).toContain("error stack:\n");
  });

  test("Error with multiple parameters", async ({ page }) => {
    const isError = await inPage<boolean>(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      class CustomError extends Error {
        constructor(message, extraInfo) {
          super(message);
          this.extraInfo = extraInfo;
          Object.setPrototypeOf(this, CustomError.prototype);
        }
      }
      const errorLog = logger.log(1234, "testLevel", new CustomError("Something went wrong", "Additional info"));
      return errorLog.nativeError instanceof Error;
    `,
    );
    expect(isError).toBe(true);

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      class CustomError extends Error {
        constructor(message, extraInfo) {
          super(message);
          this.extraInfo = extraInfo;
          Object.setPrototypeOf(this, CustomError.prototype);
        }
      }
      logger.log(1234, "testLevel", new CustomError("Something went wrong", "Additional info"));
    `,
    );
    expect(combined).toContain("Something went wrong");
    expect(combined).toContain("Additional info");
    expect(combined).toContain("Error");
    expect(combined).toContain("error stack:\n");
  });

  test("string and Error", async ({ page }) => {
    const isError = await inPage<boolean>(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      const errorLog = logger.log(1234, "testLevel", "test", new Error("test"));
      return errorLog["1"].nativeError instanceof Error;
    `,
    );
    expect(isError).toBe(true);

    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      logger.log(1234, "testLevel", "test", new Error("test"));
    `,
    );
    expect(combined).toContain("Error");
    expect(combined).toContain("test");
    expect(combined).toContain("error stack:\n");
  });

  test("Error cause chain pretty output", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", stylePrettyLogs: false },
      `
      const logger = new tslog.Logger(settings);
      const deepest = new Error("deepest");
      const middle = new Error("middle");
      const top = new Error("top");
      middle.cause = deepest;
      top.cause = middle;
      logger.error(top);
    `,
    );
    expect(combined).toContain("Caused by (1): Error: middle");
    expect(combined).toContain("Caused by (2): Error: deepest");
  });
});
