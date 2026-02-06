import { test, expect, type ConsoleMessage } from "@playwright/test";

let consoleMessages: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleMessages = [];
  page.on("console", (msg: ConsoleMessage) => {
    consoleMessages.push(msg.text());
  });
  await page.goto("/", { waitUntil: "load" });
});

test.describe("Cross-runtime browser tests", () => {
  test("JSON output contains correct meta structure", async ({ page }) => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json" });
      logger.info("browser json test");
    });

    const combined = consoleMessages.join("\n");
    expect(combined).toContain('"runtime":"browser"');
    expect(combined).toContain('"logLevelId":3');
    expect(combined).toContain('"logLevelName":"INFO"');
    expect(combined).toContain('"date"');
    expect(combined).toContain("browser json test");
  });

  test("all 7 log levels produce output in JSON mode", async ({ page }) => {
    const results = await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json" });
      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => output.push(String(args[0]));
      logger.silly("s");
      logger.trace("t");
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.fatal("f");
      console.log = origLog;
      return output;
    });

    expect(results.length).toBe(7);
    expect(results[0]).toContain('"logLevelId":0');
    expect(results[3]).toContain('"logLevelId":3');
    expect(results[6]).toContain('"logLevelId":6');
  });

  test("error with cause chain is serialized in browser", async ({ page }) => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json" });
      const root = new Error("root cause");
      const outer = new Error("outer error");
      // @ts-ignore
      outer.cause = root;
      logger.error(outer);
    });

    const combined = consoleMessages.join("\n");
    expect(combined).toContain("outer error");
    expect(combined).toContain("root cause");
  });

  test("masking works in browser context", async ({ page }) => {
    const result = await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json", maskValuesOfKeys: ["password"] });
      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => output.push(String(args[0]));
      logger.info({ user: "alice", password: "secret" });
      console.log = origLog;
      return output[0];
    });

    expect(result).toContain("[***]");
    expect(result).toContain("alice");
    expect(result).not.toContain("secret");
  });

  test("sub-logger works in browser", async ({ page }) => {
    const result = await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json", name: "parent" });
      // @ts-ignore
      const sub = logger.getSubLogger({ name: "child" });
      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => output.push(String(args[0]));
      sub.info("sub msg");
      console.log = origLog;
      return output[0];
    });

    expect(result).toContain('"name":"child"');
    expect(result).toContain('"parentNames":["parent"]');
    expect(result).toContain("sub msg");
  });

  test("hidden mode returns logObj but no console output in browser", async ({ page }) => {
    const result = await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "hidden" });
      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => output.push(String(args[0]));
      const logObj = logger.info("hidden test");
      console.log = origLog;
      return { consoleCount: output.length, hasLogObj: logObj != null, logLevelName: logObj?._meta?.logLevelName };
    });

    expect(result.consoleCount).toBe(0);
    expect(result.hasLogObj).toBe(true);
    expect(result.logLevelName).toBe("INFO");
  });

  test("transport receives logObj in browser", async ({ page }) => {
    const result = await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "hidden" });
      const captured: unknown[] = [];
      logger.attachTransport((logObj: unknown) => captured.push(logObj));
      logger.info("transport test");
      return { count: captured.length, msg: (captured[0] as Record<string, unknown>)?.["0"] };
    });

    expect(result.count).toBe(1);
    expect(result.msg).toBe("transport test");
  });

  test("circular reference does not throw in browser JSON mode", async ({ page }) => {
    const result = await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json" });
      const obj: Record<string, unknown> = { name: "test" };
      obj.self = obj;
      try {
        const output: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => output.push(String(args[0]));
        logger.info(obj);
        console.log = origLog;
        return { threw: false, hasOutput: output.length > 0 };
      } catch {
        return { threw: true, hasOutput: false };
      }
    });

    expect(result.threw).toBe(false);
    expect(result.hasOutput).toBe(true);
  });

  test("pretty mode with prefix in browser", async ({ page }) => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false, prefix: ["[APP]"] });
      logger.info("prefixed message");
    });

    const combined = consoleMessages.join("\n");
    expect(combined).toContain("[APP]");
    expect(combined).toContain("prefixed message");
  });

  test("minLevel filtering works in browser", async ({ page }) => {
    const result = await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json", minLevel: 3 });
      const output: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => output.push(String(args[0]));
      logger.debug("should be filtered");
      logger.info("should appear");
      console.log = origLog;
      return output;
    });

    expect(result.length).toBe(1);
    expect(result[0]).toContain("should appear");
  });
});
