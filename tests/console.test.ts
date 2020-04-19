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
    }),
  };
});

avaTest.serial(
  "not overwritten console",
  (test: ExecutionContext<IContext>): void => {
    const logger: Logger = new Logger({
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
    });
    console.debug("--> log to console (should be visible in tests)");
    test.is(test.context.stdOut.length, 0);
    console.warn("--> log to console (should be visible in tests)");
    test.is(test.context.stdErr.length, 0);
  }
);

avaTest.serial(
  "overwritten console",
  (test: ExecutionContext<IContext>): void => {
    const logger: Logger = new Logger({
      overwriteConsole: true,
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
    });
    console.debug("--> log to console (should NOT be visible in tests)");
    test.not(test.context.stdOut.length, 0);
    console.warn("--> log to console (should NOT be visible in tests)");
    test.not(test.context.stdErr.length, 0);
  }
);
