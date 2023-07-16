import "ts-jest";
import { IMeta, Logger } from "../../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("Placeholders", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("It supports adding custom placeholders", (): void => {
    const logger = new Logger({
      type: "pretty",
      prettyLogTemplate: "{{custom}} ",
      overwrite: {
        addPlaceholders: (logObjMeta: IMeta, placeholderValues: Record<string, string>) => {
          placeholderValues["custom"] = "test";
        },
      },
    });
    logger.silly("message");
    expect(getConsoleLog()).toMatch(/test.+message/);
    expect(getConsoleLog()).not.toContain("{{custom}}");
  });
});
