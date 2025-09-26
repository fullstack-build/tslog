import "ts-jest";
import { ok } from "assert";
import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

class MissingSetter {
  get testProp(): string {
    return "test";
  }
}

const missingSetter = {
  get testProp(): string {
    return "test";
  },
};

describe("Getters and setters", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("[class] should not print getters on class instance (prototype)", (): void => {
    // Node.js issue: https://github.com/nodejs/node/issues/30183
    const logger = new Logger({
      type: "pretty",
    });
    const missingSetterObj = new MissingSetter();
    const result = logger.info(missingSetterObj);
    ok(result);
    expect(Object.keys(result)).not.toContain("testProp");
    expect(getConsoleLog()).not.toContain("testProp");
  });

  test("[object] should print getters", (): void => {
    const logger = new Logger({
      type: "pretty",
    });
    const result = logger.info(missingSetter);
    ok(result);
    expect(Object.keys(result)).toContain("testProp");
    expect(getConsoleLog()).toContain("testProp");
  });
});
