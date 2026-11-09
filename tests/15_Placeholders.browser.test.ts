import { expect, test } from "@playwright/test";
import { captureConsole } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

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

test("custom tokens use native CSS styling and preserve object arguments after template changes", async ({ page }) => {
  const { calls, returnValue } = await captureConsole(
    page,
    {},
    `
    const payload = { items: [1, 2] };
    const logger = new tslog.Logger({
      strictConfig: true,
      clock: () => new Date("2026-10-17T01:02:03.004Z"),
      pretty: {
        style: true, passObjectsNatively: true,
        template: "[{{logLevelName}}] {{shortTime}} ",
        placeholders: { shortTime: meta => meta.date.toISOString().slice(11, 23) },
        styles: { shortTime: "blackBright" },
      },
    });
    const record = logger.info("response", payload);
    logger.settings.pretty.template = "{{shortTime}} -- {{logLevelName}} ";
    logger.info("second", payload);
    return { unchanged: payload.items.length === 2, hasCustomField: "shortTime" in record };
  `,
  );
  expect(calls[0][0]).toBe("[INFO] %c01:02:03.004%c ");
  expect(calls[0][1]).toContain("color:");
  expect(calls[0][2]).toBe("");
  expect(calls[0][3]).toBe("response");
  expect(calls[0][4]).toEqual({ items: [1, 2] });
  expect(calls[1][0]).toBe("%c01:02:03.004%c -- INFO ");
  expect(returnValue).toEqual({ unchanged: true, hasCustomField: false });
});

test("hex color tokens in pretty.styles become CSS colors (#394)", async ({ page }) => {
  const { calls } = await captureConsole(
    page,
    {},
    `
    const logger = new tslog.Logger({
      pretty: {
        style: true, passObjectsNatively: true,
        template: "{{logLevelName}} {{name}} ",
        styles: { logLevelName: ["#00ff00", "bold"], name: "bg#123" },
      },
      name: "app",
    });
    logger.info("hex");
  `,
  );
  expect(calls[0][0]).toBe("%cINFO%c %capp%c ");
  expect(calls[0][1]).toBe("color: #00ff00; font-weight: bold");
  expect(calls[0][3]).toBe("background-color: #112233");
});
