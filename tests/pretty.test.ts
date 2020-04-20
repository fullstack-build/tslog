import ava, { ExecutionContext, TestInterface } from "ava";
import { Logger } from "../src/index";
import { doesLogContain, IContext } from "./helper";

const avaTest = ava as TestInterface<IContext>;

avaTest.beforeEach((test: ExecutionContext<IContext>) => {
  test.context = {
    stdOut: [],
    stdErr: [],
    logger: new Logger({
      name: "Test",
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

avaTest("silly log (stdOut)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.silly("test message");
  test.true(doesLogContain(test.context.stdOut, "SILLY"));
  test.true(doesLogContain(test.context.stdOut, "test message"));
});

avaTest("debug log (stdOut)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.debug("test message");
  test.true(doesLogContain(test.context.stdOut, "DEBUG"));
  test.true(doesLogContain(test.context.stdOut, "test message"));
});

avaTest("info log (stdOut)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.info("test message");
  test.true(doesLogContain(test.context.stdOut, "INFO"));
  test.true(doesLogContain(test.context.stdOut, "test message"));
});

avaTest("warn log (stdErr)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.warn("test message");
  test.true(doesLogContain(test.context.stdErr, "WARN"));
  test.true(doesLogContain(test.context.stdErr, "test message"));
});

avaTest("error log (stdErr)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.error("test message");
  test.true(doesLogContain(test.context.stdErr, "ERROR"));
  test.true(doesLogContain(test.context.stdErr, "test message"));
});

avaTest(
  "fatal log (stdErr and not stdOut)",
  (test: ExecutionContext<IContext>): void => {
    test.context.logger.fatal("test message");
    test.true(doesLogContain(test.context.stdErr, "FATAL"));
    test.true(doesLogContain(test.context.stdErr, "test message"));
    test.false(doesLogContain(test.context.stdOut, "FATAL"));
    test.false(doesLogContain(test.context.stdOut, "test message"));
  }
);

avaTest(
  "trace log has a trace (stdOut)",
  (test: ExecutionContext<IContext>): void => {
    test.context.logger.trace("test message");
    test.true(doesLogContain(test.context.stdOut, "TRACE"));
    test.true(doesLogContain(test.context.stdOut, "test message"));
    test.true(doesLogContain(test.context.stdOut, "log stack"));
  }
);

avaTest(
  "Pretty Error with stack (stdErr)",
  (test: ExecutionContext<IContext>): void => {
    test.context.logger.warn(new Error("TestError"));
    test.true(doesLogContain(test.context.stdErr, "Error: TestError"));
    test.true(doesLogContain(test.context.stdErr, ".test.ts"));
  }
);

avaTest("Pretty object (stdOut)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.info({ very: "much" });
  //json indentation discovered
  test.true(doesLogContain(test.context.stdOut, '\n{\n  "very": "much"\n}'));
});
