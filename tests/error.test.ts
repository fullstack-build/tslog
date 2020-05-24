import "ts-jest";
import { Logger } from "../src";
import { doesLogContain } from "./helper";

const stdOut: string[] = [];
const stdErr: string[] = [];

const loggerConfig = {
  stdOut: {
    write: (print: string) => {
      stdOut.push(print);
    },
  },
  stdErr: {
    write: (print: string) => {
      stdErr.push(print);
    },
  },
};

const loggerPretty: Logger = new Logger({ ...loggerConfig, type: "pretty" });
const loggerJson: Logger = new Logger({ ...loggerConfig, type: "json" });

class TestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestError";
  }
}

describe("Logger: Error with details", () => {
  test("Pretty: Error with details (stdErr)", (): void => {
    const error = new TestError("TestError");
    loggerPretty.warn(error);
    expect(doesLogContain(stdErr, "TestError")).toBeTruthy();
    expect(doesLogContain(stdErr, ".test.ts")).toBeTruthy();
  });

  test("JSON: Error with details (stdErr)", (): void => {
    const error = new TestError("TestError");
    loggerJson.warn(error);
    expect(doesLogContain(stdErr, "TestError")).toBeTruthy();
    expect(doesLogContain(stdErr, ".test.ts")).toBeTruthy();
  });
});
