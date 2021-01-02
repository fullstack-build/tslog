import "ts-jest";
import { IStd, Logger } from "../src";
import { doesLogContain } from "./helper";
import exp = require("constants");

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

describe("Logger: Parameter", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("undefined", (): void => {
    logger.silly(undefined);
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "undefined")).toBeTruthy();
  });

  test("null", (): void => {
    logger.silly(null);
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "null")).toBeTruthy();
  });

  test("boolean", (): void => {
    logger.silly(true);
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "true")).toBeTruthy();
  });

  test("number", (): void => {
    logger.silly(0);
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "0")).toBeTruthy();
  });

  test("string", (): void => {
    logger.silly("string");
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "string")).toBeTruthy();
  });
});
