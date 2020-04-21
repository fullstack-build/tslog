import "jest";
import { Logger } from "../src";
import { doesLogContain } from "./helper";

const stdOut: string[] = [];
const stdErr: string[] = [];

const logger: Logger = new Logger({
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

describe("Logger: Pretty print", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("silly log (stdOut)", (): void => {
    logger.silly("test message");
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "test message")).toBeTruthy();
  });

  test("debug log (stdOut)", (): void => {
    logger.debug("test message");
    expect(doesLogContain(stdOut, "DEBUG")).toBeTruthy();
    expect(doesLogContain(stdOut, "test message")).toBeTruthy();
  });

  test("info log (stdOut)", (): void => {
    logger.info("test message");
    expect(doesLogContain(stdOut, "INFO")).toBeTruthy();
    expect(doesLogContain(stdOut, "test message")).toBeTruthy();
  });

  test("warn log (stdErr)", (): void => {
    logger.warn("test message");
    expect(doesLogContain(stdErr, "WARN")).toBeTruthy();
    expect(doesLogContain(stdErr, "test message")).toBeTruthy();
  });

  test("error log (stdErr)", (): void => {
    logger.error("test message");
    expect(doesLogContain(stdErr, "ERROR")).toBeTruthy();
    expect(doesLogContain(stdErr, "test message")).toBeTruthy();
  });

  test("fatal log (stdErr and not stdOut)", (): void => {
    logger.fatal("test message");
    expect(doesLogContain(stdErr, "FATAL")).toBeTruthy();
    expect(doesLogContain(stdErr, "test message")).toBeTruthy();
    expect(doesLogContain(stdOut, "FATAL")).toBeFalsy();
    expect(doesLogContain(stdOut, "test message")).toBeFalsy();
  });

  test("trace log has a trace (stdOut)", (): void => {
    logger.trace("test message");
    expect(doesLogContain(stdOut, "TRACE")).toBeTruthy();
    expect(doesLogContain(stdOut, "test message")).toBeTruthy();
    expect(doesLogContain(stdOut, "log stack")).toBeTruthy();
  });

  test("Pretty Error with stack (stdErr)", (): void => {
    logger.warn(new Error("TestError"));
    expect(doesLogContain(stdErr, "TestError")).toBeTruthy();
    expect(doesLogContain(stdErr, ".test.ts")).toBeTruthy();
  });

  test("Pretty object (stdOut)", (): void => {
    logger.info({ very: "much" });
    //json indentation discovered
    expect(doesLogContain(stdOut, '\n{\n  "very": "much"\n}'));
  });
});
