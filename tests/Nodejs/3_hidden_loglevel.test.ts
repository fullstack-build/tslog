import "ts-jest";
import { Logger } from "../../src/index.node";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

const logger = new Logger({ type: "hidden" });
describe("Hidden: Log level", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("silly (console)", (): void => {
    logger.silly("Test");
    expect(getConsoleLog()).toContain("");
  });
});
