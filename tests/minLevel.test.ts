import "ts-jest";
import { Logger } from "../src";

describe("Logger: minLevel", () => {
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

  test("minLevel: silly", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: "silly",
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

  test("minLevel: trace", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: "trace",
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

  test("minLevel: debug", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: "debug",
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

  test("minLevel: info", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: "info",
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

  test("minLevel: warn", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: "warn",
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

  test("minLevel: error", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: "error",
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

  test("minLevel: fatal", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
      minLevel: "fatal",
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
