import { ok } from "assert";
import "ts-jest";
import { Logger } from "../../src/index.js";
import { mockConsoleLog } from "./helper.js";

class MissingSetter {
  get test(): string {
    return "test";
  }
}

const missingSetter = {
  get test(): string {
    return "test";
  }
}

describe("Getters and setters", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });
  test("[class] should not print getters", (): void => {
    const logger = new Logger({
      type: "hidden",
    });
    const missingSetterObj = new MissingSetter();

    const result = logger.info(missingSetterObj);

    ok(result);
    Object.keys(result).forEach((key) => {
      expect(key).not.toBe("test");
    });
  });
  test("[object] should print getters", (): void => {
    const logger = new Logger({
      type: "hidden",
    });
    const result = logger.info(missingSetter);
    expect(result).toContain("test");
  });
});
