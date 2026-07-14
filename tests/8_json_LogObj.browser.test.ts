import { expect, test } from "@playwright/test";
import { captureConsole, inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("JSON: LogObj (browser)", () => {
  test("BaseLogger with LogObj", async ({ page }) => {
    const result = await inPage<{ name: unknown }>(
      page,
      {},
      `
      const defaultLogObject = { name: "test" };
      // v5 BaseLogger takes the EnvironmentProvider as a 3rd constructor arg (no module-level singleton).
      // The bundle doesn't export createBrowserEnvironment, so borrow the live browser provider off a Logger.
      const environment = new tslog.Logger().runtime;
      const logger = new tslog.BaseLogger({ type: "json" }, defaultLogObject, environment);
      const logMsg = logger.log(1234, "testLevel", "Test");
      return { name: logMsg.name };
    `,
    );
    expect(result.name).toContain("test");

    const { combined } = await captureConsole(
      page,
      {},
      `
      const defaultLogObject = { name: "test" };
      // v5 BaseLogger takes the EnvironmentProvider as a 3rd constructor arg (no module-level singleton).
      // The bundle doesn't export createBrowserEnvironment, so borrow the live browser provider off a Logger.
      const environment = new tslog.Logger().runtime;
      const logger = new tslog.BaseLogger({ type: "json" }, defaultLogObject, environment);
      logger.log(1234, "testLevel", "Test");
    `,
    );
    expect(combined).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(combined).toContain(`"message":"Test",`);
  });

  test("Logger with LogObj", async ({ page }) => {
    const result = await inPage<{ name: unknown }>(
      page,
      {},
      `
      const defaultLogObject = { name: "test" };
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      const logMsg = logger.log(1234, "testLevel", "Test");
      return { name: logMsg.name };
    `,
    );
    expect(result.name).toContain("test");

    const { combined } = await captureConsole(
      page,
      {},
      `
      const defaultLogObject = { name: "test" };
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      logger.log(1234, "testLevel", "Test");
    `,
    );
    expect(combined).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(combined).toContain(`"message":"Test",`);
  });

  test("Logger with LogObj: silly", async ({ page }) => {
    const result = await inPage<{ name: unknown }>(
      page,
      {},
      `
      const defaultLogObject = { name: "test" };
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      const logMsg = logger.silly("Test");
      return { name: logMsg.name };
    `,
    );
    expect(result.name).toContain("test");

    const { combined } = await captureConsole(
      page,
      {},
      `
      const defaultLogObject = { name: "test" };
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      logger.silly("Test");
    `,
    );
    expect(combined).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(combined).toContain(`"message":"Test",`);
  });

  test("Logger with LogObj: function call", async ({ page }) => {
    const result = await inPage<{ name: unknown; functionCall: unknown }>(
      page,
      {},
      `
      const defaultLogObject = { name: "test", functionCall: () => "test" };
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      const logMsg = logger.silly("Test");
      return { name: logMsg.name, functionCall: logMsg.functionCall };
    `,
    );
    expect(result.name).toContain("test");
    expect(result.functionCall).toContain("test");

    const { combined } = await captureConsole(
      page,
      {},
      `
      const defaultLogObject = { name: "test", functionCall: () => "test" };
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      logger.silly("Test");
    `,
    );
    expect(combined).toContain(`"name":"test",`);
    // v5 flat shape: a bare-string arg is promoted from index key "0" to the top-level message key.
    expect(combined).toContain(`"message":"Test",`);
    expect(combined).toContain(`"functionCall":"test",`);
  });

  test("Logger with LogObj as an Array", async ({ page }) => {
    const result = await inPage<{ first: unknown }>(
      page,
      {},
      `
      const defaultLogObject = ["1", "2", "3"];
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      const logMsg = logger.silly("Test");
      return { first: logMsg[0] };
    `,
    );
    expect(result.first).toContain("1");

    const { combined } = await captureConsole(
      page,
      {},
      `
      const defaultLogObject = ["1", "2", "3"];
      const logger = new tslog.Logger({ type: "json" }, defaultLogObject);
      logger.silly("Test");
    `,
    );
    // The default-logObj array spreads index-keyed (0,1,2) and overwrites the bare "Test" at index 0.
    // In the v5 flat shape index key "0" ("1") is promoted to the top-level message key; "1"/"2" remain.
    expect(combined).toContain(`"message":"1",`);
    expect(combined).toContain(`"1":"2",`);
    expect(combined).toContain(`"2":"3"`);
  });
});
