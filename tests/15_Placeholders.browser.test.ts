import { expect, test } from "@playwright/test";
import { captureConsole } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("Placeholders (browser)", () => {
  test("It supports adding custom placeholders", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      {},
      `
      const logger = new tslog.Logger({
        type: "pretty",
        prettyLogTemplate: "{{custom}} ",
        overwrite: {
          addPlaceholders: (logObjMeta, placeholderValues) => {
            placeholderValues["custom"] = "test";
          },
        },
      });
      logger.silly("message");
    `,
    );
    expect(combined).toMatch(/test.+message/);
    expect(combined).not.toContain("{{custom}}");
  });
});
