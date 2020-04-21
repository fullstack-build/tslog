import "jest";
import { Logger } from "../src";

describe("Logger: JSON", () => {
  test("minLevel: not set", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(4);
    expect(stdErr.length).toBe(3);
  });

  test("minLevel: 0", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: 0,
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(4);
    expect(stdErr.length).toBe(3);
  });

  test("minLevel: 1", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: 1,
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(3);
    expect(stdErr.length).toBe(3);
  });

  test("minLevel: 2", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: 2,
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(2);
    expect(stdErr.length).toBe(3);
  });

  test("minLevel: 3", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: 3,
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(1);
    expect(stdErr.length).toBe(3);
  });

  test("minLevel: 4", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: 4,
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(0);
    expect(stdErr.length).toBe(3);
  });

  test("minLevel: 5", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: 5,
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(0);
    expect(stdErr.length).toBe(2);
  });

  test("minLevel: 6", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: 6,
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

    logger.silly("test message");
    logger.trace("test message");
    logger.debug("test message");
    logger.info("test message");
    logger.warn("test message");
    logger.error("test message");
    logger.fatal("test message");
    expect(stdOut.length).toBe(0);
    expect(stdErr.length).toBe(1);
  });
});
