import "ts-jest";
import { Logger } from "../../src";
import { getConsoleLog, mockConsoleLog } from "./helper";

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
