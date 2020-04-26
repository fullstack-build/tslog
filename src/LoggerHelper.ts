import { basename as fileBasename, sep as pathSeparator } from "path";

import { Logger } from "./index";
import { Chalk } from "chalk";
import {
  IJsonHighlightColors,
  IJsonHighlightColorsChalk,
  ILogObject,
  IStackFrame,
  TLogLevelName,
} from "./interfaces";
import { format } from "util";

/** @internal */
export class LoggerHelper {
  public static cwdArray: string[] = process.cwd().split(pathSeparator);

  public static cleanUpFilePath(fileName: string | null): string | null {
    if (fileName == null) {
      return fileName;
    }
    return Object.entries(fileName.split(pathSeparator)).reduce(
      (cleanFileName: string, fileNamePart) =>
        fileNamePart[1] !== LoggerHelper.cwdArray[fileNamePart[0]]
          ? (cleanFileName += pathSeparator + fileNamePart[1])
          : cleanFileName,
      ""
    );
  }

  public static getCallSites(error?: Error): NodeJS.CallSite[] {
    const _prepareStackTrace:
      | ((err: Error, stackTraces: NodeJS.CallSite[]) => unknown)
      | undefined = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const stack: NodeJS.CallSite[] =
      error == null
        ? ((new Error().stack as unknown) as NodeJS.CallSite[]).slice(1)
        : ((error.stack as unknown) as NodeJS.CallSite[]);
    Error.prepareStackTrace = _prepareStackTrace;
    return stack;
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

  public static errorToJsonHelper(): void {
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

  public static colorizeJson(
    json: string | object,
    chalk: Chalk,
    colors: IJsonHighlightColors
  ): string {
    const chalkColors: IJsonHighlightColorsChalk = {
      number: chalk.hex(colors.number),
      key: chalk.hex(colors.key),
      string: chalk.hex(colors.string),
      boolean: chalk.hex(colors.boolean),
      null: chalk.hex(colors.null),
    };

    let stringifiedJson: string = "";
    if (typeof json !== "string") {
      stringifiedJson = JSON.stringify(json, undefined, 2);
      stringifiedJson =
        stringifiedJson === "{}" ? format(json) : stringifiedJson;
    } else {
      stringifiedJson = json;
    }
    return stringifiedJson.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match: string) {
        let cls: string = "number";
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = "key";
          } else {
            cls = "string";
          }
        } else if (/true|false/.test(match)) {
          cls = "boolean";
        } else if (/null/.test(match)) {
          cls = "null";
        }
        return chalkColors[cls](match);
      }
    );
  }
}
