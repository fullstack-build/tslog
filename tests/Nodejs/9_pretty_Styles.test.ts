import "ts-jest";
import { Logger } from "../../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("Pretty: Styles", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("Logger with default styles", (): void => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: true });
    logger.silly("Test silly");
    expect(getConsoleLog()).toContain("\u001b[37m\u001b[1mSILLY\u001b[22m\u001b[39m");
    logger.warn("Test warn");
    expect(getConsoleLog()).toContain("\u001b[33m\u001b[1mWARN\u001b[22m\u001b[39m");
  });

  test("Logger with changed styles", (): void => {
    const logger = new Logger({
      type: "pretty",
      stylePrettyLogs: true,
      prettyLogStyles: {
        logLevelName: {
          "*": ["bold", "dim"],
          SILLY: ["bold", "blue"],
          WARN: ["bold", "green"],
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
      stylePrettyLogs: true,
      prettyLogStyles: {
        logLevelName: {},
      },
    });
    logger.log(0, "unknown", "Test unknown");
    expect(getConsoleLog()).toContain("unknown");
  });
});
