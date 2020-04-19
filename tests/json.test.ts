import ava, { ExecutionContext, TestInterface } from "ava";
import { Logger, ILogObject, IErrorObject } from "../src/index";
import { doesLogContain, IContext } from "./helper";

const avaTest = ava as TestInterface<IContext>;

avaTest.beforeEach((test: ExecutionContext<IContext>) => {
  test.context = {
    stdOut: [],
    stdErr: [],
    logger: new Logger({
      name: "Test",
      logAsJson: true,
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

avaTest("init json logger", (test: ExecutionContext<IContext>): void => {
  const logger: Logger = new Logger({ logAsJson: true });
  test.is(logger instanceof Logger, true);
  test.is(logger.settings.logAsJson, true);
});

avaTest("silly log (stdOut)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.silly("test message");
  try {
    const logJson: ILogObject = JSON.parse(test.context.stdOut[0]);

    test.is(logJson.logLevel, 0);
    test.is(logJson.logLevelName, "silly");
    test.is(logJson.argumentsArray[0], "test message");
  } catch {}
});

avaTest("debug log (stdOut)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.debug("test message");
  try {
    const logJson: ILogObject = JSON.parse(test.context.stdOut[0]);

    test.is(logJson.logLevel, 2);
    test.is(logJson.logLevelName, "debug");
    test.is(logJson.argumentsArray[0], "test message");
  } catch {}
});

avaTest("info log (stdOut)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.info("test message");
  try {
    const logJson: ILogObject = JSON.parse(test.context.stdOut[0]);

    test.is(logJson.logLevel, 3);
    test.is(logJson.logLevelName, "info");
    test.is(logJson.argumentsArray[0], "test message");
  } catch {}
});

avaTest("warn log (stdErr)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.warn("test message");
  try {
    const logJson: ILogObject = JSON.parse(test.context.stdErr[0]);

    test.is(logJson.logLevel, 4);
    test.is(logJson.logLevelName, "warn");
    test.is(logJson.argumentsArray[0], "test message");
  } catch {}
});

avaTest("error log (stdErr)", (test: ExecutionContext<IContext>): void => {
  test.context.logger.error("test message");
  try {
    const logJson: ILogObject = JSON.parse(test.context.stdErr[0]);

    test.is(logJson.logLevel, 5);
    test.is(logJson.logLevelName, "error");
    test.is(logJson.argumentsArray[0], "test message");
  } catch {}
});

avaTest(
  "fatal log (stdErr and not stdOut)",
  (test: ExecutionContext<IContext>): void => {
    test.context.logger.fatal("test message");
    try {
      const logJsonErr: ILogObject = JSON.parse(test.context.stdErr[0]);
      test.is(logJsonErr.logLevel, 6);
      test.is(logJsonErr.logLevelName, "fatal");
      test.is(logJsonErr.argumentsArray[0], "test message");
      const logJsonOut: ILogObject = JSON.parse(test.context.stdOut[0]);
      test.is(logJsonOut, null);
    } catch {}
  }
);

avaTest(
  "trace log has a trace (stdOut)",
  (test: ExecutionContext<IContext>): void => {
    test.context.logger.trace("test message");
    try {
      const logJson: ILogObject = JSON.parse(test.context.stdOut[0]);

      test.is(logJson.logLevel, 1);
      test.is(logJson.logLevelName, "trace");
      test.is(logJson.argumentsArray[0], "test message");
      test.not(logJson.stack, null);
    } catch {}
  }
);

avaTest(
  "Pretty Error with stack (stdErr)",
  (test: ExecutionContext<IContext>): void => {
    test.context.logger.warn(new Error("TestError"));
    try {
      const logJson: ILogObject = JSON.parse(test.context.stdErr[0]);
      const errorObject: IErrorObject = logJson
        .argumentsArray[0] as IErrorObject;
      test.is(errorObject.message, "TestError");
      test.not(errorObject.stack, null);
    } catch {}
  }
);
