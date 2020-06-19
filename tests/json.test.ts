import "ts-jest";
import { IErrorObject, ILogObject, Logger } from "../src";

const stdOut: string[] = [];
const stdErr: string[] = [];

const logger: Logger = new Logger({
  name: "Test",
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

describe("Logger: JSON", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("silly log (stdOut)", (): void => {
    logger.silly("test message");

    const logJson: ILogObject = JSON.parse(stdOut[0]);

    expect(logJson.logLevelId).toBe(0);
    expect(logJson.logLevel).toBe("silly");
    expect(logJson.argumentsArray[0]).toBe("test message");
  });

  test("debug log (stdOut)", (): void => {
    logger.debug("test message");

    const logJson: ILogObject = JSON.parse(stdOut[0]);

    expect(logJson.logLevelId).toBe(2);
    expect(logJson.logLevel).toBe("debug");
    expect(logJson.argumentsArray[0]).toBe("test message");
  });

  test("info log (stdOut)", (): void => {
    logger.info("test message");

    const logJson: ILogObject = JSON.parse(stdOut[0]);

    expect(logJson.logLevelId).toBe(3);
    expect(logJson.logLevel).toBe("info");
    expect(logJson.argumentsArray[0]).toBe("test message");
  });

  test("warn log (stdErr)", (): void => {
    logger.warn("test message");

    const logJson: ILogObject = JSON.parse(stdErr[0]);

    expect(logJson.logLevelId).toBe(4);
    expect(logJson.logLevel).toBe("warn");
    expect(logJson.argumentsArray[0]).toBe("test message");
  });

  test("error log (stdErr)", (): void => {
    logger.error("test message");

    const logJson: ILogObject = JSON.parse(stdErr[0]);

    expect(logJson.logLevelId).toBe(5);
    expect(logJson.logLevel).toBe("error");
    expect(logJson.argumentsArray[0]).toBe("test message");
  });

  test("fatal log (stdErr and not stdOut)", (): void => {
    logger.fatal("test message");

    const logJsonErr: ILogObject = JSON.parse(stdErr[0]);
    expect(logJsonErr.logLevelId).toBe(6);
    expect(logJsonErr.logLevel).toBe("fatal");
    expect(logJsonErr.argumentsArray[0]).toBe("test message");
    expect(stdOut).toBeNull;
  });

  test("trace log has a trace (stdOut)", (): void => {
    logger.trace("test message");

    const logJson: ILogObject = JSON.parse(stdOut[0]);

    expect(logJson.logLevelId).toBe(1);
    expect(logJson.logLevel).toBe("trace");
    expect(logJson.argumentsArray[0]).toBe("test message");
    expect(logJson.stack).not.toBeNull();
  });

  test("Log object to jsonOut)", (): void => {
    logger.info({ foo: "bar" });

    const logJson: ILogObject = JSON.parse(stdOut[0]);
    const logObject = logJson.argumentsArray[0];
    expect(logObject).toBe("{ foo: 'bar' }");
  });

  test("Error with stack (stdErr)", (): void => {
    logger.warn(new Error("TestError"));

    const logJson: ILogObject = JSON.parse(stdErr[0]);

    const errorObject: IErrorObject = logJson.argumentsArray[0] as IErrorObject;
    expect(errorObject.message).toBe("TestError");
    expect(errorObject.stack).not.toBeNull();
  });

  test("Error with code Frame (stdErr)", (): void => {
    logger.warn(new Error("TestError"));

    const logJson: ILogObject = JSON.parse(stdErr[0]);
    const errorObject: IErrorObject = logJson.argumentsArray[0] as IErrorObject;
    expect(errorObject.message).toBe("TestError");
    expect(errorObject.codeFrame).not.toBeNull();
  });

  test("Log object to jsonOut)", (): void => {
    logger.info({ foo: "bar" });

    const logJson: ILogObject = JSON.parse(stdOut[0]);
    const logObject = logJson.argumentsArray[0];
    expect(logObject).toBe("{ foo: 'bar' }");
  });
});
