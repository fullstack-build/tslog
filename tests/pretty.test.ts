import "ts-jest";
import { IStd, Logger } from "../src";
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

  test("Pretty Error with code frame (stdErr)", (): void => {
    logger.warn(new Error("TestError"));
    expect(doesLogContain(stdErr, "TestError")).toBeTruthy();
    expect(doesLogContain(stdErr, "code frame:")).toBeTruthy();
    // red >
    expect(doesLogContain(stdErr, ">")).toBeTruthy();
  });

  test("Pretty object (stdOut)", (): void => {
    logger.info({ very: "much", a: null, b: true, c: 1, d: null });
    //json indentation discovered
    expect(doesLogContain(stdOut, '\n{\n  "very": "much"\n}'));

    class ObjClass {
      constructor() {
        const foo = "bar";
      }
    }
    logger.debug(new ObjClass());
    expect(doesLogContain(stdOut, "DEBUG")).toBeTruthy();
    expect(doesLogContain(stdOut, "ObjClass {")).toBeTruthy();
  });

  test("Pretty Promise (stdOut)", (): void => {
    const promise = new Promise(() => {});
    logger.debug(promise);
    expect(doesLogContain(stdOut, "DEBUG")).toBeTruthy();
    expect(doesLogContain(stdOut, "Promise {")).toBeTruthy();
  });

  test("Pretty circular JSON (stdOut)", (): void => {
    function Foo() {
      /* @ts-ignore */
      this.abc = "Hello";
      /* @ts-ignore */
      this.circular = this;
    }

    /* @ts-ignore */
    const foo = new Foo();

    logger.debug(foo);
    expect(doesLogContain(stdOut, "DEBUG")).toBeTruthy();
    expect(doesLogContain(stdOut, "[Circular")).toBeTruthy();
  });

  test("Pretty print on custom IStd", (): void => {
    class SimpleStd implements IStd {
      constructor(private _buffer: string = "") {}
      write(message: string) {
        this._buffer += message;
      }

      get buffer(): string {
        return this._buffer;
      }
    }

    const testVector = ["this", "is", "a", "test"];
    const myStd = new SimpleStd();
    testVector.forEach((e) => logger.printPrettyLog(myStd, logger.debug(e)));

    const logs = myStd.buffer.split(/\r?\n/);
    expect(logs.length).toBe(testVector.length + 1); // + 1 is for the last EOL
    logs.forEach((e, i) => expect(e.endsWith(testVector[i] + " ")));
  });

  test("Pretty print: not colorized", (): void => {
    const nonColorizedStdOut: string[] = [];
    const plainLogger: Logger = new Logger({
      colorizePrettyLogs: false,
      stdOut: {
        write: (print: string) => {
          nonColorizedStdOut.push(print);
        },
      },
      stdErr: {
        write: (print: string) => {
          nonColorizedStdOut.push(print);
        },
      },
    });

    plainLogger.info("Test-Message non-colorized");
    expect(nonColorizedStdOut[0].indexOf("\u001b[90m")).toBe(-1);
  });
});
