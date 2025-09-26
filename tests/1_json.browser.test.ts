/**
 * @jest-environment puppeteer
 */
import "expect-puppeteer";
import type { ConsoleMessage, Page } from "puppeteer";

declare const page: Page;

let consoleMessages: string[] = [];
describe("Browser: JSON: Log level", () => {
  beforeAll(async () => {
    jest.setTimeout(35000);
    await page.goto("http://localhost:4444", { waitUntil: "load" });
    page.on("console", (consoleObj: ConsoleMessage) => {
      consoleMessages.push(consoleObj.text());
    });
  });
  beforeEach(() => {
    consoleMessages = [];
  });

  it("Server and Page initiated", async () => {
    const html = await page.content();
    await expect(html).toContain("tslog Demo");
  });

  it("silly", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "json" });
      logger.silly("Test");
    });

    const combined = consoleMessages.join("\n");
    expect(combined).toContain('"0":"Test"');
    expect(combined).toContain('"_meta":{');
    expect(combined).toContain('"runtime":"browser"');
    expect(combined).toContain(`"date":"${new Date().toISOString().split(".")[0]}`); // ignore ms
    expect(combined).toContain('"logLevelId":0');
    expect(combined).toContain('"logLevelName":"SILLY"');
    expect(combined).toContain('"path":{');
  });

  it("pretty", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty" });
      logger.silly("Test");
    });

    expect(consoleMessages.some((msg) => msg.includes("Test"))).toBe(true);
  });

  it("pretty uses CSS styling when available", async () => {
    const result = await page.evaluate(() => {
      const calls: unknown[][] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        calls.push(args);
        originalLog.apply(console, args as []);
      };
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty" });
      logger.info("Browser formatting");
      console.log = originalLog;
      return calls;
    });

    const firstCall = result?.[0];
    expect(Array.isArray(firstCall)).toBe(true);
    const metaSegment = (firstCall as unknown[])[0];
    expect(typeof metaSegment).toBe("string");
    expect(metaSegment as string).not.toContain("\u001b[");
    expect(metaSegment as string).toContain("%c");
    expect((firstCall as unknown[]).length).toBeGreaterThan(1);
  });

  it("pretty disables styling when turned off", async () => {
    const result = await page.evaluate(() => {
      const calls: unknown[][] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        calls.push(args);
        originalLog.apply(console, args as []);
      };
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.info("Browser no styling");
      console.log = originalLog;
      return calls;
    });

    const firstCall = result?.[0]?.[0];
    expect(typeof firstCall).toBe("string");
    expect(firstCall as string).not.toContain("\u001b[");
    expect(firstCall as string).not.toContain("%c");
  });

  it("pretty no styles undefined", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.fatal("Test undefined", { test: undefined });
    });

    expect(consoleMessages.some((msg) => msg.includes("Test undefined"))).toBe(true);
  });

  it("pretty string interpolation", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.info("Foo %s", "bar");
    });

    expect(consoleMessages.some((msg) => msg.includes("Foo bar"))).toBe(true);
  });

  it("pretty undefined", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.info(undefined);
    });
    expect(consoleMessages.some((msg) => msg.includes("undefined"))).toBe(true);
  });

  it("pretty null", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.info(null);
    });
    expect(consoleMessages.some((msg) => msg.includes("null"))).toBe(true);
  });

  it("pretty nullish", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.info({ foo: null, bar: undefined });
    });
    const combined = consoleMessages.join("\n");
    expect(combined).toContain("null");
    expect(combined).toContain("undefined");
  });
});
