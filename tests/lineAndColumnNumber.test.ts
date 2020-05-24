import "ts-jest";
import { ILogObject, Logger } from "../src";
import { doesLogContain } from "./helper";

const stdOut: string[] = [];
const stdErr: string[] = [];
const transportOut: ILogObject[] = [];
const transportErr: ILogObject[] = [];

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

logger.attachTransport(
  {
    silly: logToTransportOut,
    debug: logToTransportOut,
    trace: logToTransportOut,
    info: logToTransportOut,
    warn: logToTransportErr,
    error: logToTransportErr,
    fatal: logToTransportErr,
  },
  "silly"
);

function logToTransportOut(print: ILogObject) {
  transportOut.push(print);
}
function logToTransportErr(print: ILogObject) {
  transportErr.push(print);
}

// SUPER IMPORTANT! Don't change the line number of the log invocation
// TODO: waiting for the upcoming jest update fixing sourcemaps: probably 25.5.0
// [jest-transform] Improve source map handling when instrumenting transformed code (#9811)
describe("Logger: Line and column number", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
    transportOut.length = 0;
    transportErr.length = 0;
  });

  test("check line and column number (stdOut)", (): void => {
    logger.silly("test message");
    expect(transportOut[0].logLevel).toBe("silly");
    // AFTER jest update:
    // expect(transportOut[0].lineNumber).toBe(54);
    // expect(transportOut[0].columnNumber).toBe(5);
    // This line number is wrong, waiting for jest update:
    expect(transportOut[0].lineNumber).toBe(48);
    expect(transportOut[0].columnNumber).toBe(16);
  });
});
