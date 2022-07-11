import "ts-jest";
import {
  TLogLevelName,
  IErrorObject,
  ILogObject,
  Logger,
  LoggerWithoutCallSite,
} from "../src";

const stdOut: string[] = [];
const stdErr: string[] = [];

interface MyCustomLogObject extends ILogObject {
  specialField?: number;
}

class MyLoggerWithCustomRootLevelFields extends LoggerWithoutCallSite {
  protected _buildLogObject(
    logLevel: TLogLevelName,
    logArguments: unknown[],
    exposeStack: boolean = true
  ): ILogObject {
    const log = super._buildLogObject(
      logLevel,
      logArguments,
      exposeStack
    ) as MyCustomLogObject;
    log.specialField = 42;
    return log;
  }
}

const logger: Logger = new MyLoggerWithCustomRootLevelFields({
  name: "CustomizedLogger",
  type: "json",
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

describe("Logger: visibility", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("Subclassing a protected method to build a custom object", (): void => {
    logger.silly("test a message");
    const log: MyCustomLogObject = JSON.parse(stdOut[0]);
    expect(log.loggerName).toBe("CustomizedLogger");
    expect(log.argumentsArray[0]).toBe("test a message");
    expect(log.specialField).toBe(42);
  });
});
