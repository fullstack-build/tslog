import { type ConsoleMessage, expect, test } from "@playwright/test";

let consoleMessages: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleMessages = [];
  page.on("console", (msg: ConsoleMessage) => {
    consoleMessages.push(msg.text());
  });
  await page.goto("/", { waitUntil: "load" });
});

test("Server and Page initiated", async ({ page }) => {
  const html = await page.content();
  expect(html).toContain("tslog Demo");
});

test("silly", async ({ page }) => {
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

test("pretty", async ({ page }) => {
  await page.evaluate(() => {
    // @ts-ignore
    const logger = new tslog.Logger({ type: "pretty" });
    logger.silly("Test");
  });

  expect(consoleMessages.some((msg) => msg.includes("Test"))).toBe(true);
});

test("pretty uses CSS styling when available", async ({ page }) => {
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

test("pretty disables styling when turned off", async ({ page }) => {
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

test("pretty no styles undefined", async ({ page }) => {
  await page.evaluate(() => {
    // @ts-ignore
    const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
    logger.fatal("Test undefined", { test: undefined });
  });

  expect(consoleMessages.some((msg) => msg.includes("Test undefined"))).toBe(true);
});

test("pretty string interpolation", async ({ page }) => {
  await page.evaluate(() => {
    // @ts-ignore
    const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info("Foo %s", "bar");
  });

  expect(consoleMessages.some((msg) => msg.includes("Foo bar"))).toBe(true);
});

test("pretty undefined", async ({ page }) => {
  await page.evaluate(() => {
    // @ts-ignore
    const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info(undefined);
  });
  expect(consoleMessages.some((msg) => msg.includes("undefined"))).toBe(true);
});

test("pretty null", async ({ page }) => {
  await page.evaluate(() => {
    // @ts-ignore
    const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info(null);
  });
  expect(consoleMessages.some((msg) => msg.includes("null"))).toBe(true);
});

test("pretty nullish", async ({ page }) => {
  await page.evaluate(() => {
    // @ts-ignore
    const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
    logger.info({ foo: null, bar: undefined });
  });
  const combined = consoleMessages.join("\n");
  expect(combined).toContain("null");
  expect(combined).toContain("undefined");
});
