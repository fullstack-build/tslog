import "ts-jest";
import { IErrorObject, ILogObject, Logger } from "../src";

const stdOut: string[] = [];
const stdErr: string[] = [];

const logger: Logger = new Logger({
  name: "Test",
  type: "hidden",
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
});

describe("Logger: JSON", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("hidden (stdOut)", (): void => {
    const hiddenLog = logger.silly("test message");
    expect(stdOut).toHaveLength(0);
    expect(hiddenLog.argumentsArray[0]).toBe("test message");
  });
});
