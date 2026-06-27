import { expect, test } from "@playwright/test";
import { inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("SubLoggers (browser)", () => {
  test("one sub logger", async ({ page }) => {
    const result = await inPage<{ main: unknown; sub: unknown }>(
      page,
      {},
      `
      const mainLogger = new tslog.Logger({ type: "hidden" });
      const logMsg = mainLogger.info("main logger");

      const subLogger = mainLogger.getSubLogger({ type: "hidden" });
      const subLogMsg = subLogger.info("sub logger");

      return { main: logMsg["0"], sub: subLogMsg["0"] };
    `,
    );
    expect(result.main).toBe("main logger");
    expect(result.sub).toBe("sub logger");
  });

  test("one sub logger with prefix", async ({ page }) => {
    const result = await inPage<{ main0: unknown; main1: unknown; sub0: unknown; sub1: unknown; sub2: unknown }>(
      page,
      {},
      `
      const mainLogger = new tslog.Logger({ type: "hidden", prefix: ["main"] });
      const logMsg = mainLogger.info("test-main");

      const subLogger = mainLogger.getSubLogger({ type: "hidden", prefix: ["sub"] });
      const subLogMsg = subLogger.info("test-sub");

      return { main0: logMsg["0"], main1: logMsg["1"], sub0: subLogMsg["0"], sub1: subLogMsg["1"], sub2: subLogMsg["2"] };
    `,
    );
    expect(result.main0).toBe("main");
    expect(result.main1).toBe("test-main");
    expect(result.sub0).toBe("main");
    expect(result.sub1).toBe("sub");
    expect(result.sub2).toBe("test-sub");
  });

  test("sub logger overwriting LogObj", async ({ page }) => {
    const result = await inPage<{ mainMain: unknown; mainSub: unknown; subMain: unknown; subSub: unknown }>(
      page,
      {},
      `
      const mainLogObj = { main: true, sub: false };
      const mainLogger = new tslog.Logger({ type: "hidden" }, mainLogObj);
      const logMsg = mainLogger.info("main logger");

      const subLogObj = { main: false, sub: true };
      const subLogger = mainLogger.getSubLogger({ type: "hidden" }, subLogObj);
      const subLogMsg = subLogger.info("test-sub");

      return { mainMain: logMsg.main, mainSub: logMsg.sub, subMain: subLogMsg.main, subSub: subLogMsg.sub };
    `,
    );
    expect(result.mainMain).toBe(true);
    expect(result.mainSub).toBe(false);
    expect(result.subMain).toBe(false);
    expect(result.subSub).toBe(true);
  });
});
