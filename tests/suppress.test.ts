import "jest";
import { Logger } from "../src";

const stdOut = [];
const stdErr = [];

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

describe("Logger: surpress logs to std", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });
  test("Check literal value", () => {
    logger.silly("test message");
    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(0);
    expect(stdErr.length).toBe(0);
  });
});
