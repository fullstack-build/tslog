import { Logger } from "../src/index.js";
import { getConsoleLog, getConsoleLogStripped, mockConsoleLog } from "./helper.js";

describe("Placeholders", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("renders the built-in logLevelName placeholder into the pretty template", (): void => {
    const logger = new Logger({
      type: "pretty",
      pretty: { template: "{{logLevelName}} ", style: false },
    });
    logger.silly("message");
    expect(getConsoleLogStripped()).toMatch(/SILLY.+message/);
    expect(getConsoleLog()).not.toContain("{{logLevelName}}");
  });

  test("leaves an unknown placeholder untouched in the rendered line", (): void => {
    const logger = new Logger({
      type: "pretty",
      pretty: { template: "{{custom}} ", style: false },
    });
    logger.silly("message");
    // No value is supplied for {{custom}}, so formatTemplate keeps the raw token verbatim.
    expect(getConsoleLog()).toContain("{{custom}}");
    expect(getConsoleLog()).toContain("message");
  });
});
