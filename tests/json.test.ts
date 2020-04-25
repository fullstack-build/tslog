import "jest";
import { IErrorObject, ILogObject, Logger } from "../src";

const stdOut: string[] = [];
const stdErr: string[] = [];

const logger: Logger = new Logger({
  name: "Test",
  logAsJson: true,
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
    try {
      const logJson: ILogObject = JSON.parse(stdOut[0]);

      expect(logJson.logLevelId).toBe(0);
      expect(logJson.logLevel).toBe("silly");
      expect(logJson.argumentsArray[0]).toBe("test message");
    } catch {}
  });

  test("debug log (stdOut)", (): void => {
    logger.debug("test message");
    try {
      const logJson: ILogObject = JSON.parse(stdOut[0]);

      expect(logJson.logLevelId).toBe(2);
      expect(logJson.logLevel).toBe("debug");
      expect(logJson.argumentsArray[0]).toBe("test message");
    } catch {}
  });

  test("info log (stdOut)", (): void => {
    logger.info("test message");
    try {
      const logJson: ILogObject = JSON.parse(stdOut[0]);

      expect(logJson.logLevelId).toBe(3);
      expect(logJson.logLevel).toBe("info");
      expect(logJson.argumentsArray[0]).toBe("test message");
    } catch {}
  });

  test("warn log (stdErr)", (): void => {
    logger.warn("test message");
    try {
      const logJson: ILogObject = JSON.parse(stdErr[0]);

      expect(logJson.logLevelId).toBe(4);
      expect(logJson.logLevel).toBe("warn");
      expect(logJson.argumentsArray[0]).toBe("test message");
    } catch {}
  });

  test("error log (stdErr)", (): void => {
    logger.error("test message");
    try {
      const logJson: ILogObject = JSON.parse(stdErr[0]);

      expect(logJson.logLevelId).toBe(5);
      expect(logJson.logLevel).toBe("error");
      expect(logJson.argumentsArray[0]).toBe("test message");
    } catch {}
  });

  test("fatal log (stdErr and not stdOut)", (): void => {
    logger.fatal("test message");
    try {
      const logJsonErr: ILogObject = JSON.parse(stdErr[0]);
      expect(logJsonErr.logLevelId).toBe(6);
      expect(logJsonErr.logLevel).toBe("fatal");
      expect(logJsonErr.argumentsArray[0]).toBe("test message");
      const logJsonOut: ILogObject = JSON.parse(stdOut[0]);
      expect(logJsonOut).toBe(null);
    } catch {}
  });

  test("trace log has a trace (stdOut)", (): void => {
    logger.trace("test message");
    try {
      const logJson: ILogObject = JSON.parse(stdOut[0]);

      expect(logJson.logLevelId).toBe(1);
      expect(logJson.logLevel).toBe("trace");
      expect(logJson.argumentsArray[0]).toBe("test message");
      expect(logJson.stack).toEqual(null);
    } catch {}
  });

  test("Pretty Error with stack (stdErr)", (): void => {
    logger.warn(new Error("TestError"));
    try {
      const logJson: ILogObject = JSON.parse(stdErr[0]);
      const errorObject: IErrorObject = logJson
        .argumentsArray[0] as IErrorObject;
      expect(errorObject.message).toBe("TestError");
      expect(errorObject.stack).toEqual(null);
    } catch {}
  });
});
