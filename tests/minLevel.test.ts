import ava, { ExecutionContext, TestInterface } from "ava";
import { Logger } from "../src/index";
import { doesLogContain, IContext } from "./helper";

const avaTest = ava as TestInterface<IContext>;

avaTest("minLevel: not set", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 4);
  test.is(stdErr.length, 3);
});

avaTest("minLevel: 0", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 4);
  test.is(stdErr.length, 3);
});

avaTest("minLevel: 1", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 3);
  test.is(stdErr.length, 3);
});

avaTest("minLevel: 2", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 2);
  test.is(stdErr.length, 3);
});

avaTest("minLevel: 3", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 1);
  test.is(stdErr.length, 3);
});

avaTest("minLevel: 4", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 0);
  test.is(stdErr.length, 3);
});

avaTest("minLevel: 5", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 0);
  test.is(stdErr.length, 2);
});

avaTest("minLevel: 6", (test: ExecutionContext<IContext>): void => {
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
  test.is(stdOut.length, 0);
  test.is(stdErr.length, 1);
});
