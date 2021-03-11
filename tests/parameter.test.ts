import "ts-jest";
import { IStd, Logger } from "../src";
import { doesLogContain } from "./helper";
import { URL } from "url";

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
  colorizePrettyLogs: false,
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

  test("date", (): void => {
    const date = new Date();
    logger.silly(date);
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, date.toISOString())).toBeTruthy();
  });

  test("array", (): void => {
    logger.silly([1, 2, 3]);
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "1,")).toBeTruthy();
    expect(doesLogContain(stdOut, "2,")).toBeTruthy();
    expect(doesLogContain(stdOut, "3")).toBeTruthy();
  });

  test("array with objects", (): void => {
    logger.silly([{ 1: true }, { 2: true }, { 3: true }]);
    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "'1': true")).toBeTruthy();
  });

  test("object", (): void => {
    const obj = {
      null: null,
      undefined: undefined,
      boolean: true,
      number: 0,
      string: "string",
      array: [1, 2, 3],
      date: new Date(),
      error: new Error(),
      object: {
        null: null,
        undefined: undefined,
        boolean: true,
        number: 0,
        string: "string",
        array: [1, 2, 3],
        date: new Date(),
        error: new Error(),
        object: {
          null: null,
          undefined: undefined,
          boolean: true,
          number: 0,
          string: "string",
          array: [1, 2, 3],
          date: new Date(),
          error: new Error(),
          recursive: {},
        },
      },
    };
    obj.object.object.recursive = obj.object;

    logger.silly(obj);

    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "{")).toBeTruthy();
    expect(doesLogContain(stdOut, "null: null,")).toBeTruthy();
    expect(doesLogContain(stdOut, "undefined: undefined,")).toBeTruthy();
    expect(doesLogContain(stdOut, "boolean: true,")).toBeTruthy();
    expect(doesLogContain(stdOut, "number: 0,")).toBeTruthy();
    expect(doesLogContain(stdOut, "tring: 'string',")).toBeTruthy();
    expect(doesLogContain(stdOut, "array: [")).toBeTruthy();
    expect(doesLogContain(stdOut, "1,")).toBeTruthy();
    expect(doesLogContain(stdOut, "date: ")).toBeTruthy();
    expect(doesLogContain(stdOut, "error: Error {")).toBeTruthy();
    expect(doesLogContain(stdOut, "object: ")).toBeTruthy();
    expect(doesLogContain(stdOut, "recursive: [Circular")).toBeTruthy();
  });

  test("buffer", (): void => {
    const buffer = Buffer.from("foo");
    logger.silly(buffer);

    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "<Buffer 66 6f 6f>")).toBeTruthy();
  });

  test("Url", (): void => {
    const url = new URL("http://example.com");
    logger.silly(url);

    expect(doesLogContain(stdOut, "SILLY")).toBeTruthy();
    expect(doesLogContain(stdOut, "http://example.com/")).toBeTruthy();
  });
});
