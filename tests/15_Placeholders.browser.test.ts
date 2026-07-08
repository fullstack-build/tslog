import { expect, test } from "@playwright/test";
import { captureConsole } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

// The v4 test "It supports adding custom placeholders" relied on settings.overwrite.addPlaceholders,
// which is removed in v5 (M2.6). The pretty placeholder set is now fixed (built in metaFormatting from
// _logMeta) with no hook to inject arbitrary {{custom}} placeholders. Mirroring the Node migration, the
// intent (placeholder rendering into the pretty template) is preserved with the built-in placeholders.

test.describe("Placeholders (browser)", () => {
  test("renders the built-in logLevelName placeholder into the pretty template", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      {},
      `
      const logger = new tslog.Logger({
        type: "pretty",
        pretty: { template: "{{logLevelName}} ", style: false },
      });
      logger.silly("message");
    `,
    );
    expect(combined).toMatch(/SILLY.+message/);
    expect(combined).not.toContain("{{logLevelName}}");
  });

  test("leaves an unknown placeholder untouched in the rendered line", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      {},
      `
      const logger = new tslog.Logger({
        type: "pretty",
        pretty: { template: "{{custom}} ", style: false },
      });
      logger.silly("message");
    `,
    );
    // No value is supplied for {{custom}}, so formatTemplate keeps the raw token verbatim.
    expect(combined).toContain("{{custom}}");
    expect(combined).toContain("message");
  });
});
