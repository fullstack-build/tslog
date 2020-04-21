import "jest";
import { Logger } from "../src";

const stdOut: string[] = [];
const stdErr: string[] = [];

const logger: Logger = new Logger({
  suppressLogging: true,
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

describe("Logger: overwrite console", () => {
  console.debug = jest.fn();
  console.error = jest.fn();

  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("not overwritten console", (): void => {
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
    console.debug("--> log to console (should be visible in tests)");
    expect(stdOut.length).toBe(0);
    console.error("--> log to console (should be visible in tests)");
    expect(stdErr.length).toBe(0);
  });

  test("overwritten console", (): void => {
    const logger: Logger = new Logger({
      overwriteConsole: true,
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
    console.debug("--> log to console (should NOT be visible in tests)");
    expect(stdOut.length).toBeGreaterThan(0);
    console.error("--> log to console (should NOT be visible in tests)");
    expect(stdErr.length).toBeGreaterThan(0);
  });
});
