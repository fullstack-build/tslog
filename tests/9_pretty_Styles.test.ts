import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("Pretty: Styles", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("Logger with default styles", (): void => {
    const logger = new Logger({ type: "pretty", pretty: { style: true } });
    logger.silly("Test silly");
    expect(getConsoleLog()).toContain("\u001b[37m\u001b[1mSILLY\u001b[22m\u001b[39m");
    logger.warn("Test warn");
    expect(getConsoleLog()).toContain("\u001b[33m\u001b[1mWARN\u001b[22m\u001b[39m");
  });

  test("Logger with changed styles", (): void => {
    const logger = new Logger({
      type: "pretty",
      pretty: {
        style: true,
        styles: {
          logLevelName: {
            "*": ["bold", "dim"],
            SILLY: ["bold", "blue"],
            WARN: ["bold", "green"],
          },
        },
      },
    });
    logger.silly("Test silly");
    expect(getConsoleLog()).toContain("\u001b[34m\u001b[1mSILLY\u001b[22m\u001b[39m");
    logger.warn("Test warn");
    expect(getConsoleLog()).toContain("\u001b[32m\u001b[1mWARN\u001b[22m\u001b[39m");
    logger.log(0, "unknown", "Test unknown");
    expect(getConsoleLog()).toContain("\u001b[2m\u001b[1munknown\u001b[22m\u001b[22m");
  });

  test("Logger with missing style", (): void => {
    const logger = new Logger({
      type: "pretty",
      pretty: {
        style: true,
        styles: {
          logLevelName: {},
        },
      },
    });
    logger.log(0, "unknown", "Test unknown");
    expect(getConsoleLog()).toContain("unknown");
  });

  test("hex color tokens render as 24-bit ANSI colors (#394)", (): void => {
    const logger = new Logger({
      type: "pretty",
      pretty: { style: true, template: "{{logLevelName}} {{name}} ", styles: { logLevelName: ["#00ff00", "bold"], name: "bg#123" } },
      name: "app",
    });
    logger.info("Test hex");
    expect(getConsoleLog()).toContain("\u001b[1m\u001b[38;2;0;255;0mINFO\u001b[39m\u001b[22m");
    expect(getConsoleLog()).toContain("\u001b[48;2;17;34;51mapp\u001b[49m");
  });

  test("an unknown style token leaves the value unstyled instead of throwing", (): void => {
    const logger = new Logger({ type: "pretty", pretty: { style: true, template: "{{logLevelName}} ", styles: { logLevelName: "notAColor" } } });
    expect(() => logger.info("Test unknown token")).not.toThrow();
    expect(getConsoleLog()).toContain("INFO\u001b[0m");
  });
});
