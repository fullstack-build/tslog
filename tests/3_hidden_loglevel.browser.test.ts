import { expect, test } from "@playwright/test";
import { captureConsole } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("Hidden: Log level (browser)", () => {
  test("silly (console)", async ({ page }) => {
    const { calls, returnValue } = await captureConsole<boolean>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const logObj = logger.silly("Test");
      return logObj?.["0"] === "Test";
    `,
    );
    expect(calls.length).toBe(0);
    expect(returnValue).toBe(true);
  });
});
