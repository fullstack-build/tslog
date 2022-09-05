import "ts-jest";
import { Logger } from "../../src";

describe("SubLoggers", () => {
  test("attach one transport", (): void => {
    const mainLogger = new Logger({ type: "hidden" });
    const logMsg = mainLogger.info("main logger");
    expect(logMsg["0"]).toBe("main logger");

    const subLogger = mainLogger.getSubLogger({ type: "hidden" });
    const subLogMsg = subLogger.info("sub logger");
    expect(subLogMsg["0"]).toBe("sub logger");
  });
});
