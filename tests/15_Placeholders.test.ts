import { Logger } from "../src/index.js";
import { getConsoleLog, getConsoleLogStripped, mockConsoleLog } from "./helper.js";

describe("Placeholders", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  // Deleted: "It supports adding custom placeholders".
  // That test relied on settings.overwrite.addPlaceholders, which is removed in v5 (M2.6). The pretty
  // placeholder set is now fixed (built in metaFormatting.buildPrettyMeta from _logMeta) and there is no
  // replacement hook to inject arbitrary {{custom}} placeholders — neither middleware nor per-transport
  // format feeds into the pretty template's placeholder map. So this is a genuinely-removed feature.

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
