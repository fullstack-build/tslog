import { inspect, types } from "util";
import { readFileSync } from "fs";
import { basename as fileBasename, sep as pathSeparator } from "path";

import { Logger } from "./index";
import {
  ICodeFrame,
  IHighlightStyles,
  ILogObject,
  IStackFrame,
  TLogLevelName,
  TUtilsInspectColors,
} from "./interfaces";

/** @internal */
export class LoggerHelper {
  public static cwdArray: string[] = process.cwd().split(pathSeparator);

  public static cleanUpFilePath(fileName: string | null): string | null {
    return fileName == null
      ? fileName
      : Object.entries(fileName.split(pathSeparator))
          .reduce(
            (cleanFileName: string, fileNamePart) =>
              fileNamePart[1] !== LoggerHelper.cwdArray[fileNamePart[0]]
                ? (cleanFileName += pathSeparator + fileNamePart[1])
                : cleanFileName,
            ""
          )
          .substring(1);
  }

  public static isError(e: Error | unknown): boolean {
    // An error could be an instance of Error while not being a native error
    // or could be from a different realm and not be instance of Error but still
    // be a native error.
    return types?.isNativeError != null
      ? types.isNativeError(e)
      : e instanceof Error;
  }

  public static getCallSites(
    error?: Error,
    cleanUp: boolean = true
  ): NodeJS.CallSite[] {
    const _prepareStackTrace:
      | ((err: Error, stackTraces: NodeJS.CallSite[]) => unknown)
      | undefined = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const stack: NodeJS.CallSite[] =
      error == null
        ? ((new Error().stack as unknown) as NodeJS.CallSite[]).slice(1)
        : ((error.stack as unknown) as NodeJS.CallSite[]);
    Error.prepareStackTrace = _prepareStackTrace;

    return cleanUp === true
      ? stack.reduce(
          (
            cleanedUpCallsites: NodeJS.CallSite[],
            callsite: NodeJS.CallSite
          ) => {
            if (
              callsite?.getFileName() != null &&
              callsite?.getFileName() !== "" &&
              callsite?.getFileName()?.indexOf("internal/") !== 0 &&
              callsite?.getFileName()?.indexOf("module.js") !== 0 &&
              callsite?.getFileName()?.indexOf("bootstrap_node.js") !== 0
            ) {
              cleanedUpCallsites.push(callsite);
            }
            return cleanedUpCallsites;
          },
          []
        )
      : stack;
  }

  public static toStackFrameObject(stackFrame: NodeJS.CallSite): IStackFrame {
    const filePath: string | null = stackFrame.getFileName();
    return {
      filePath: LoggerHelper.cleanUpFilePath(filePath) ?? "",
      fullFilePath: filePath ?? "",
      fileName: fileBasename(stackFrame.getFileName() ?? ""),
      lineNumber: stackFrame.getLineNumber(),
      columnNumber: stackFrame.getColumnNumber(),
      isConstructor: stackFrame.isConstructor(),
      functionName: stackFrame.getFunctionName(),
      typeName: stackFrame.getTypeName(),
      methodName: stackFrame.getMethodName(),
    };
  }

  public static initErrorToJsonHelper(): void {
    if (!("toJSON" in Error.prototype))
      /* eslint-disable */
      Object.defineProperty(Error.prototype, "toJSON", {
        /* eslint-enable */
        value: function () {
          return Object.getOwnPropertyNames(this).reduce(
            (alt: object, key: string) => {
              alt[key] = this[key];
              return alt;
            },
            {}
          );
        },
        configurable: true,
        writable: true,
      });
  }

  public static overwriteConsole(
    $this: Logger,
    handleLog: Function
  ): ILogObject | void {
    ["log", "debug", "info", "warn", "trace", "error"].forEach(
      (name: string) => {
        console[name] = (...args: unknown[]) => {
          const loglevelMapping: { [key: string]: TLogLevelName } = {
            log: "silly",
            trace: "trace",
            debug: "debug",
            info: "info",
            warn: "warn",
            error: "error",
          };
          return handleLog.apply($this, [
            loglevelMapping[name.toLowerCase()],
            args,
          ]);
        };
      }
    );
  }

  public static setUtilsInspectStyles(
    utilsInspectStyles: IHighlightStyles
  ): void {
    Object.entries(utilsInspectStyles).forEach(
      ([symbol, color]: [string, TUtilsInspectColors]) => {
        inspect.styles[symbol] = color;
      }
    );
  }

  /*
  import { createReadStream, readFileSync } from "fs";
  import { createInterface, Interface } from "readline";
  public static async _getCodeFrameAsync(
    filePath: string,
    lineNumber: number | null,
    columnNumber: number | null,
    linesBeforeAndAfter: number
  ): Promise<ICodeFrame | undefined> {
    try {
      const fileStream: NodeJS.ReadableStream = createReadStream(filePath, {
        encoding: "utf-8",
      });
      const rl: Interface = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      if (lineNumber != null) {
        const linesBefore: string[] = [];
        let relevantLine: string | undefined;
        const linesAfter: string[] = [];
        let i: number = 0;
        rl.on("line", (line) => {
          if (i < lineNumber && i >= lineNumber - linesBeforeAndAfter) {
            linesBefore.push(line);
          } else if (i === lineNumber) {
            relevantLine = line;
          } else if (i > lineNumber && i <= lineNumber + linesBeforeAndAfter) {
            linesAfter.push(line);
          }
          i++;
        });
        rl.on("close", () => {
          const firstLineNumber: number =
            lineNumber - linesBeforeAndAfter < 0
              ? 0
              : lineNumber - linesBeforeAndAfter;
          return {
            firstLineNumber,
            lineNumber,
            columnNumber,
            linesBefore,
            relevantLine,
            linesAfter,
          };
        });
      }
    } catch {
      return undefined;
    }
  }
  */

  public static _getCodeFrame(
    filePath: string,
    lineNumber: number,
    columnNumber: number | null,
    linesBeforeAndAfter: number
  ): ICodeFrame {
    const lineNumberMinusOne: number = lineNumber - 1;

    const file: string[] = readFileSync(filePath, { encoding: "utf-8" })?.split(
      "\n"
    );
    const startAt: number =
      lineNumberMinusOne - linesBeforeAndAfter < 0
        ? 0
        : lineNumberMinusOne - linesBeforeAndAfter;
    const endAt: number =
      lineNumberMinusOne + linesBeforeAndAfter > file.length
        ? file.length
        : lineNumberMinusOne + linesBeforeAndAfter;

    const codeFrame: ICodeFrame = {
      firstLineNumber: startAt + 1,
      lineNumber,
      columnNumber,
      linesBefore: [],
      relevantLine: "",
      linesAfter: [],
    };
    for (let i: number = startAt; i < lineNumberMinusOne; i++) {
      if (file[i] != null) {
        codeFrame.linesBefore.push(file[i]);
      }
    }
    codeFrame.relevantLine = file[lineNumberMinusOne];
    for (let i: number = lineNumberMinusOne + 1; i <= endAt; i++) {
      if (file[i] != null) {
        codeFrame.linesAfter.push(file[i]);
      }
    }

    return codeFrame;
  }

  public static lineNumberTo3Char(lineNumber: number): string {
    return lineNumber < 10
      ? `00${lineNumber}`
      : lineNumber < 100
      ? `0${lineNumber}`
      : `${lineNumber}`;
  }
}
