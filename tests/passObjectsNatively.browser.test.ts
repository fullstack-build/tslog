import { expect, test } from "@playwright/test";
import { captureConsole, inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("pretty.passObjectsNatively (browser default)", () => {
  test("defaults to true in a real browser", async ({ page }) => {
    const resolved = await inPage<boolean>(
      page,
      { type: "pretty" },
      `
      const logger = new tslog.Logger(settings);
      return logger.settings.pretty.passObjectsNatively === true;
    `,
    );
    expect(resolved).toBe(true);
  });

  test("a logged object reaches the console as a raw reference, not rendered into the string", async ({ page }) => {
    const { calls } = await captureConsole(
      page,
      { type: "pretty" },
      `
      const logger = new tslog.Logger(settings);
      logger.info("user loaded", { id: 42, roles: ["admin"] });
    `,
    );

    expect(calls.length).toBe(1);
    const args = calls[0];
    // The object trails as its own argument (DevTools renders it collapsibly)…
    const rawObject = args.find((arg) => typeof arg === "object" && arg !== null && !Array.isArray(arg)) as Record<string, unknown> | undefined;
    expect(rawObject).toBeDefined();
    expect(rawObject?.id).toBe(42);
    // …and its fields are NOT pre-rendered into any string argument (the meta timestamp may
    // coincidentally contain digits, so match on the object's own tokens).
    const stringArgs = args.filter((arg) => typeof arg === "string");
    expect(stringArgs.some((s) => s.includes("roles") || s.includes("admin"))).toBe(false);
  });

  test("passObjectsNatively: false opts back into rendered-string output (log-time snapshot mode)", async ({ page }) => {
    const { combined } = await captureConsole(
      page,
      { type: "pretty", pretty: { style: false, passObjectsNatively: false } },
      `
      const logger = new tslog.Logger(settings);
      logger.info("user loaded", { id: 42 });
    `,
    );
    // The object is inspected into the printed string, so text tooling can match its fields.
    expect(combined).toContain("user loaded");
    expect(combined).toContain("42");
  });
});
