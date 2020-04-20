import ava, { ExecutionContext, TestInterface } from "ava";
import { ILogObject, Logger } from "../src/index";
import { doesLogContain, IContext } from "./helper";

const avaTest = ava as TestInterface<IContext>;

avaTest.beforeEach((test: ExecutionContext<IContext>) => {
  function logToTransportOut(print: ILogObject) {
    test.context?.transportOut?.push(print);
  }
  function logToTransportErr(print: ILogObject) {
    test.context?.transportErr?.push(print);
  }

  test.context = {
    stdOut: [],
    stdErr: [],
    transportOut: [],
    transportErr: [],
    logger: new Logger({
      minLevel: 3,
      suppressLogging: false,
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
  test.context.logger.attachTransport(
    {
      silly: logToTransportOut,
      debug: logToTransportOut,
      trace: logToTransportOut,
      info: logToTransportOut,
      warn: logToTransportErr,
      error: logToTransportErr,
      fatal: logToTransportErr,
    },
    3
  );
});

avaTest(
  "attach transport: minLevel 3",
  (test: ExecutionContext<IContext>): void => {
    test.context.logger.silly("test message");
    test.context.logger.trace("test message");
    test.context.logger.debug("test message");
    test.context.logger.info("test message");
    test.context.logger.warn("test message");
    test.context.logger.error("test message");
    test.context.logger.fatal("test message");

    test.is(test.context?.transportOut?.length, test.context?.stdOut?.length);
    test.true(
      doesLogContain(
        test.context?.stdOut,
        test.context?.transportOut?.[0].argumentsArray[0] as string
      )
    );

    test.is(test.context?.transportErr?.length, test.context?.stdErr?.length);
    test.true(
      doesLogContain(
        test.context?.stdErr,
        test.context?.transportErr?.[0].argumentsArray[0] as string
      )
    );
  }
);
