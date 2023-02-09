/**
 * @jest-environment puppeteer
 */
import "expect-puppeteer";

let consoleOutput = "";
describe("Browser: JSON: Log level", () => {
  beforeAll(async () => {
    jest.setTimeout(35000);
    await page.goto("http://localhost:4444", { waitUntil: "load" });
    page.on("console", (consoleObj) => (consoleOutput = consoleObj.text()));
  });
  beforeEach(() => {
    consoleOutput = "";
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

    expect(consoleOutput).toContain('"0":"Test"');
    expect(consoleOutput).toContain('"_meta":{');
    expect(consoleOutput).toContain('"runtime":"Browser"');
    expect(consoleOutput).toContain(`"date":"${new Date().toISOString().split(".")[0]}`); // ignore ms
    expect(consoleOutput).toContain('"logLevelId":0');
    expect(consoleOutput).toContain('"logLevelName":"SILLY"');
    expect(consoleOutput).toContain('"path":{');
    expect(consoleOutput).toContain('"fileLine":"22"');
  });

  it("pretty", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty" });
      logger.silly("Test");
    });

    expect(consoleOutput).toContain("Test");
  });

  it("pretty no styles", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.silly("Test");
    });

    expect(consoleOutput).toContain("Test");
  });

  it("pretty no styles undefined", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.fatal("Test undefined", { test: undefined });
    });

    expect(consoleOutput).toContain("Test undefined");
  });

  it("pretty string interpolation", async () => {
    await page.evaluate(() => {
      // @ts-ignore
      const logger = new tslog.Logger({ type: "pretty", stylePrettyLogs: false });
      logger.info("Foo %s", "bar");
    });

    expect(consoleOutput).toContain("Foo bar");
  });
});
