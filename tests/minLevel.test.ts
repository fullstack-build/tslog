import "ts-jest";
import { Logger } from "../src";

describe("Logger: minLevel", () => {
  test("minLevel: not set", (): void => {
    const stdOut: string[] = [];
    const stdErr: string[] = [];
    const logger: Logger = new Logger({
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
