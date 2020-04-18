import { sep as pathSeparator } from "path";
import { wrapCallSite } from "source-map-support";
import { Logger } from "./index";
import { Chalk } from "chalk";
import { IJsonHighlightColors } from "./interfaces";

export class LoggerHelper {
  public static cwdArray = process.cwd().split(pathSeparator);

  public static cleanUpFilePath(fileName: string | null): string | null {
    if (fileName == null) {
      return fileName;
    }
    const result = Object.entries(fileName.split(pathSeparator)).reduce(
      (cleanFileName: string, fileNamePart) =>
        fileNamePart[1] != LoggerHelper.cwdArray[fileNamePart[0]]
          ? (cleanFileName += pathSeparator + fileNamePart[1])
          : cleanFileName,
      ""
    );
    return result;
  }

  public static wrapCallSiteOrIgnore(
    callSiteFrame: NodeJS.CallSite
  ): NodeJS.CallSite {
    try {
      return wrapCallSite(callSiteFrame);
    } catch {
      return callSiteFrame;
    }
  }

  public static getCallSites(error?: Error): NodeJS.CallSite[] {
    const _prepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const stack =
      error == null ? (new Error().stack as any).slice(1) : error.stack;
    Error.prepareStackTrace = _prepareStackTrace;
    return stack;
  }

  public static errorToJsonHelper(): void {
    if (!("toJSON" in Error.prototype))
      Object.defineProperty(Error.prototype, "toJSON", {
        value: function () {
          return Object.getOwnPropertyNames(this).reduce(
            (alt: any, key: string) => {
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

  public static overwriteConsole($this: Logger, handleLog: Function) {
    ["log", "debug", "info", "warn", "trace", "error"].forEach(function (name) {
      console[name] = (...args: any[]) => {
        const loglevelMapping = {
          log: 0,
          trace: 1,
          debug: 2,
          info: 3,
          warn: 4,
          error: 5,
        };
        return handleLog.apply($this, [
          loglevelMapping[name.toLowerCase()],
          args,
        ]);
      };
    });
  }

  public static colorizeJson(
    json: any,
    chalk: Chalk,
    colors: IJsonHighlightColors
  ) {
    const chalkColors = {
      number: chalk.hex(colors.number),
      key: chalk.hex(colors.key),
      string: chalk.hex(colors.string),
      boolean: chalk.hex(colors.boolean),
      null: chalk.hex(colors.null),
    };

    if (typeof json !== "string") {
      json = JSON.stringify(json, undefined, 2);
    }
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match: string) {
        var cls = "number";
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
