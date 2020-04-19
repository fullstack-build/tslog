import ava, { ExecutionContext, TestInterface } from "ava";
import { Logger } from "../src/index";
import { doesLogContain, IContext } from "./helper";

const avaTest = ava as TestInterface<IContext>;

avaTest.beforeEach((test: ExecutionContext<IContext>) => {
  test.context = {
    stdOut: [],
    stdErr: [],
    logger: new Logger({
      suppressLogging: true,
      stdOut: {
        write: (print: string) => {
          test.context.stdOut.push(print);
        },
      },
      stdErr: {
        write: (print: string) => {
          test.context.stdErr.push(print);
        },
      },
    }),
  };
});

avaTest("suppress logging", (test: ExecutionContext<IContext>): void => {
  test.context.logger.silly("test message");
  test.context.logger.trace("test message");
  test.context.logger.debug("test message");
  test.context.logger.info("test message");
  test.context.logger.warn("test message");
  test.context.logger.fatal("test message");
  test.is(test.context.stdOut.length, 0);
  test.is(test.context.stdErr.length, 0);
});
