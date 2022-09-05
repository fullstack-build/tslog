import "ts-jest";
import { Logger } from "../../src";

describe("SubLoggers", () => {
  test("one sub logger", (): void => {
    const mainLogger = new Logger({ type: "hidden" });
    const logMsg = mainLogger.info("main logger");
    expect(logMsg["0"]).toBe("main logger");

    const subLogger = mainLogger.getSubLogger({ type: "hidden" });
    const subLogMsg = subLogger.info("sub logger");
    expect(subLogMsg["0"]).toBe("sub logger");
  });

  test("one sub logger with prefix", (): void => {
    const mainLogger = new Logger({ type: "hidden", prefix: ["main"] });
    const logMsg = mainLogger.info("test-main");
    expect(logMsg["0"]).toBe("main");
    expect(logMsg["1"]).toBe("test-main");

    const subLogger = mainLogger.getSubLogger({ type: "hidden", prefix: ["sub"] });
    const subLogMsg = subLogger.info("test-sub");
    expect(subLogMsg["0"]).toBe("main");
    expect(subLogMsg["1"]).toBe("sub");
    expect(subLogMsg["2"]).toBe("test-sub");
  });
});
