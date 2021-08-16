import { inspect, types } from "util";
import { readFileSync } from "fs";
import { basename as fileBasename, sep as pathSeparator } from "path";

import { getCallSites } from "./CallSitesHelper";

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

  // eslint-disable-next-line @rushstack/no-new-null
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
    const stack: NodeJS.CallSite[] =
      error == null ? getCallSites(new Error()).slice(1) : getCallSites(error);

    return cleanUp === true && stack?.reduce != null
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
      lineNumber: stackFrame.getLineNumber() ?? undefined,
      columnNumber: stackFrame.getColumnNumber() ?? undefined,
      isConstructor: stackFrame.isConstructor() ?? undefined,
      functionName: stackFrame.getFunctionName() ?? undefined,
      typeName: stackFrame.getTypeName() ?? undefined,
      methodName: stackFrame.getMethodName() ?? undefined,
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
    handleLog: (
      logLevel: TLogLevelName,
      logArguments: unknown[],
      exposeStack?: boolean
    ) => void
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

  public static styleString<T, S>(
    styleTypes: T | TUtilsInspectColors[],
    str: S | string,
    colorizePrettyLogs: boolean = true
  ): string {
    return colorizePrettyLogs
      ? Object.values(styleTypes).reduce((resultStr: S, styleType: T) => {
          return LoggerHelper._stylizeWithColor(
            styleType as unknown as TUtilsInspectColors,
            resultStr
          );
        }, str)
      : `${str}`;
  }

  private static _stylizeWithColor<T>(
    styleType: TUtilsInspectColors,
    str: T
  ): string {
    const color: [number, number] = inspect.colors[styleType] ?? [0, 0];
    return `\u001b[${color[0]}m${str}\u001b[${color[1]}m`;
  }

  /* Async
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
    columnNumber: number | undefined,
    linesBeforeAndAfter: number
  ): ICodeFrame | undefined {
    const lineNumberMinusOne: number = lineNumber - 1;
    try {
      const file: string[] = readFileSync(filePath, {
        encoding: "utf-8",
      })?.split("\n");
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
    } catch (err) {
      // (err) is needed for Node v8 support, remove later
      // fail silently
    }
  }

  public static lineNumberTo3Char(lineNumber: number): string {
    return lineNumber < 10
      ? `00${lineNumber}`
      : lineNumber < 100
      ? `0${lineNumber}`
      : `${lineNumber}`;
  }

  public static cloneObjectRecursively<T>(
    obj: T,
    maskValuesFn?: (key: number | string, value: unknown) => unknown,
    done: unknown[] = [],
    clonedObject: T = Object.create(Object.getPrototypeOf(obj)) as T
  ): T {
    done.push(obj);

    // clone array. could potentially be a separate function
    if (obj instanceof Date) {
      return new Date(obj) as unknown as T;
    } else if (Array.isArray(obj)) {
      return Object.entries(obj).map(([key, value]) => {
        if (value == null || typeof value !== "object") {
          return value;
        } else {
          return LoggerHelper.cloneObjectRecursively(value, maskValuesFn, done);
        }
      }) as unknown as T;
    } else {
      Object.getOwnPropertyNames(obj).forEach((currentKey: string | number) => {
        if (!done.includes(obj[currentKey])) {
          if (obj[currentKey] == null) {
            clonedObject[currentKey] = obj[currentKey];
          } else if (typeof obj[currentKey] !== "object") {
            clonedObject[currentKey] =
              maskValuesFn != null
                ? maskValuesFn(currentKey, obj[currentKey])
                : obj[currentKey];
          } else {
            clonedObject[currentKey] = LoggerHelper.cloneObjectRecursively(
              obj[currentKey],
              maskValuesFn,
              done,
              clonedObject[currentKey]
            );
          }
        } else {
          // cicrular detected: point to itself to make inspect printout [circular]
          clonedObject[currentKey] = clonedObject;
        }
      });
    }
    return clonedObject as T;
  }

  public static logObjectMaskValuesOfKeys<T>(
    obj: T,
    keys: (number | string)[],
    maskPlaceholder: string
  ): T {
    if (!Array.isArray(keys) || keys.length === 0) {
      return obj;
    }

    const maskValuesFn = (key: number | string, value: unknown): unknown => {
      const keysLowerCase: (string | number)[] = keys.map(
        (key: string | number) =>
          typeof key === "string" ? key.toLowerCase() : key
      );
      if (
        keysLowerCase.includes(
          typeof key === "string" ? key.toLowerCase() : key
        )
      ) {
        return maskPlaceholder;
      }
      return value;
    };

    return obj != null
      ? LoggerHelper.cloneObjectRecursively(obj, maskValuesFn)
      : obj;
  }
}
