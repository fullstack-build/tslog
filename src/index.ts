/**
 * Expressive TypeScript Logger for Node.js
 * @packageDocumentation
 */

import { format, inspect } from "util";
import { hostname } from "os";
import { normalize as fileNormalize } from "path";
import { wrapCallSite } from "source-map-support";

import {
  ILogLevel,
  IErrorObject,
  ILogObject,
  ISettings,
  ISettingsParam,
  IStackFrame,
  IStd,
  TTransportLogger,
  ITransportProvider,
  TLogLevelName,
  TLogLevelId,
  IHighlightStyles,
  TLogLevelColor,
  ICodeFrame,
  ILogObjectStringifiable,
  TUtilsInspectColors,
  IErrorObjectStringified,
} from "./interfaces";
import { LoggerHelper } from "./LoggerHelper";

export {
  ILogLevel,
  TTransportLogger,
  ILogObject,
  IErrorObject,
  IStackFrame,
  ISettingsParam,
  IStd,
  TLogLevelName,
  TLogLevelId,
  IHighlightStyles,
  TLogLevelColor,
  ISettings,
  ICodeFrame,
};

/**
 * 📝 Expressive TypeScript Logger for Node.js
 * @public
 */
export class Logger {
  private readonly _logLevels: TLogLevelName[] = [
    "silly",
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
  ];
  private _ignoreStackLevels: number = 3;
  private _attachedTransports: ITransportProvider[] = [];
  private readonly _minLevelToStdErr: number = 4;
  /** Readonly settings of the current logger instance. Used for testing. */
  public readonly settings: ISettings;

  /**
   * @param settings - Configuration of the logger instance  (all settings are optional with sane defaults)
   */
  public constructor(settings?: ISettingsParam) {
    const displayInstanceName: boolean = settings?.displayInstanceName === true;
    const setCallerAsLoggerName: boolean =
      settings?.setCallerAsLoggerName === true;

    this.settings = {
      type: settings?.type ?? "pretty",
      displayInstanceName: displayInstanceName,
      instanceName: displayInstanceName
        ? settings?.instanceName ?? hostname()
        : undefined,
      name:
        settings?.name ??
        (setCallerAsLoggerName
          ? LoggerHelper.getCallSites()[0].getTypeName() ??
            LoggerHelper.getCallSites()[0].getFunctionName() ??
            undefined
          : undefined),
      setCallerAsLoggerName: setCallerAsLoggerName,
      minLevel: settings?.minLevel ?? "silly",
      exposeStack: settings?.exposeStack ?? false,
      exposeErrorCodeFrame: settings?.exposeErrorCodeFrame ?? true,
      exposeErrorCodeFrameLinesBeforeAndAfter:
        settings?.exposeErrorCodeFrameLinesBeforeAndAfter ?? 5,
      suppressStdOutput: settings?.suppressStdOutput ?? false,
      overwriteConsole: settings?.overwriteConsole ?? false,
      logLevelsColors: settings?.logLevelsColors ?? {
        0: "whiteBright",
        1: "white",
        2: "greenBright",
        3: "blueBright",
        4: "yellowBright",
        5: "redBright",
        6: "magentaBright",
      },
      prettyInspectHighlightStyles: settings?.prettyInspectHighlightStyles ?? {
        name: "greenBright",
        string: "redBright",
        number: "blueBright",
        null: "red",
        undefined: "red",
      },
      prettyInspectOptions: settings?.prettyInspectOptions ?? {
        colors: true,
        compact: false,
        depth: Infinity,
      },
      jsonInspectOptions: settings?.jsonInspectOptions ?? {
        colors: false,
        compact: true,
        depth: Infinity,
      },
      stdOut: settings?.stdOut ?? process.stdout,
      stdErr: settings?.stdErr ?? process.stderr,
    };

    LoggerHelper.setUtilsInspectStyles(
      this.settings.prettyInspectHighlightStyles
    );

    LoggerHelper.initErrorToJsonHelper();
    if (this.settings.overwriteConsole) {
      LoggerHelper.overwriteConsole(this, this._handleLog);
    }
  }

  /**
   *  Attaches external Loggers, e.g. external log services, file system, database
   *
   * @param transportLogger - External logger to be attached. Must implement all log methods.
   * @param minLevel        - Minimum log level to be forwarded to this attached transport logger. (e.g. debug)
   */
  public attachTransport(
    transportLogger: TTransportLogger<(message: ILogObject) => void>,
    minLevel: TLogLevelName = "silly"
  ): void {
    this._attachedTransports.push({
      minLevel,
      transportLogger,
    });
  }

  /**
   * Logs a silly message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public silly(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, ["silly", args]);
  }

  /**
   * Logs a trace message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public trace(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, ["trace", args, true]);
  }

  /**
   * Logs a debug message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public debug(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, ["debug", args]);
  }

  /**
   * Logs an info message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public info(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, ["info", args]);
  }

  /**
   * Logs a warn message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public warn(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, ["warn", args]);
  }

  /**
   * Logs an error message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public error(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, ["error", args]);
  }

  /**
   * Logs a fatal message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public fatal(...args: unknown[]): ILogObject {
    return this._handleLog.apply(this, ["fatal", args]);
  }

  /**
   * Helper: Pretty print error without logging it
   * @param error - Error object
   * @param print - Print the error or return only? (default: true)
   * @param exposeErrorCodeFrame  - Should the code frame be exposed? (default: true)
   * @param exposeStackTrace  - Should the stack trace be exposed? (default: true)
   * @param stackOffset - Offset lines of the stack trace (default: 0)
   * @param stackLimit  - Limit number of lines of the stack trace (default: Infinity)
   * @param std - Which std should the output be printed to? (default: stdErr)
   */
  public prettyError(
    error: Error,
    print: boolean = true,
    exposeErrorCodeFrame: boolean = true,
    exposeStackTrace: boolean = true,
    stackOffset: number = 0,
    stackLimit: number = Infinity,
    std: IStd = this.settings.stdErr
  ): IErrorObject {
    const errorObject: IErrorObject = this._buildErrorObject(
      error,
      exposeErrorCodeFrame,
      stackOffset,
      stackLimit
    );
    if (print) {
      this._printPrettyError(std, errorObject, exposeStackTrace);
    }
    return errorObject;
  }

  private _handleLog(
    logLevel: TLogLevelName,
    logArguments: unknown[],
    exposeStack: boolean = this.settings.exposeStack
  ): ILogObject {
    const logObject: ILogObject = this._buildLogObject(
      logLevel,
      logArguments,
      exposeStack
    );

    if (
      !this.settings.suppressStdOutput &&
      logObject.logLevelId >= this._logLevels.indexOf(this.settings.minLevel)
    ) {
      if (this.settings.type === "pretty") {
        this._printPrettyLog(logObject);
      } else {
        this._printJsonLog(logObject);
      }
    }

    this._attachedTransports.forEach((transport: ITransportProvider) => {
      if (
        logObject.logLevelId >=
        Object.values(this._logLevels).indexOf(this.settings.minLevel)
      ) {
        transport.transportLogger[logLevel](logObject);
      }
    });

    return logObject;
  }

  private _buildLogObject(
    logLevel: TLogLevelName,
    logArguments: unknown[],
    exposeStack: boolean = true
  ): ILogObject {
    const callSites: NodeJS.CallSite[] = LoggerHelper.getCallSites();
    const relevantCallSites: NodeJS.CallSite[] = callSites.splice(
      this._ignoreStackLevels
    );
    const stackFrame: NodeJS.CallSite = wrapCallSite(relevantCallSites[0]);
    const stackFrameObject: IStackFrame = LoggerHelper.toStackFrameObject(
      stackFrame
    );

    const logObject: ILogObject = {
      instanceName: this.settings.instanceName,
      loggerName: this.settings.name,
      hostname: hostname(),
      date: new Date(),
      logLevel: logLevel,
      logLevelId: this._logLevels.indexOf(logLevel) as TLogLevelId,
      filePath: stackFrameObject.filePath,
      fullFilePath: stackFrameObject.fullFilePath,
      fileName: stackFrameObject.fileName,
      lineNumber: stackFrameObject.lineNumber,
      columnNumber: stackFrameObject.columnNumber,
      isConstructor: stackFrameObject.isConstructor,
      functionName: stackFrameObject.functionName,
      typeName: stackFrameObject.typeName,
      methodName: stackFrameObject.methodName,
      argumentsArray: [],
    };

    logArguments.forEach((arg: unknown) => {
      if (arg != null && typeof arg === "object" && LoggerHelper.isError(arg)) {
        logObject.argumentsArray.push(
          this._buildErrorObject(
            arg as Error,
            this.settings.exposeErrorCodeFrame
          )
        );
      } else {
        logObject.argumentsArray.push(arg);
      }
    });

    if (exposeStack) {
      logObject.stack = this._toStackObjectArray(relevantCallSites);
    }

    return logObject;
  }

  private _buildErrorObject(
    error: Error,
    exposeErrorCodeFrame: boolean = true,
    stackOffset: number = 0,
    stackLimit: number = Infinity
  ): IErrorObject {
    const errorCallSites: NodeJS.CallSite[] = LoggerHelper.getCallSites(error);
    stackOffset = stackOffset > -1 ? stackOffset : 0;
    const relevantCallSites: NodeJS.CallSite[] = errorCallSites.splice(
      stackOffset
    );

    stackLimit = stackLimit > -1 ? stackLimit : 0;
    if (stackLimit < Infinity) {
      relevantCallSites.length = stackLimit;
    }

    const errorObject: IErrorObject = JSON.parse(JSON.stringify(error));
    errorObject.nativeError = error;
    errorObject.details = { ...error };
    errorObject.name = errorObject.name ?? "Error";
    errorObject.isError = true;
    errorObject.stack = this._toStackObjectArray(relevantCallSites);
    if (errorObject.stack.length > 0) {
      const errorCallSite: IStackFrame = LoggerHelper.toStackFrameObject(
        wrapCallSite(relevantCallSites[0])
      );
      if (exposeErrorCodeFrame && errorCallSite.lineNumber != null) {
        if (errorCallSite.fullFilePath.indexOf("node_modules") < 0) {
          errorObject.codeFrame = LoggerHelper._getCodeFrame(
            errorCallSite.fullFilePath,
            errorCallSite.lineNumber,
            errorCallSite.columnNumber,
            this.settings.exposeErrorCodeFrameLinesBeforeAndAfter
          );
        }
      }
    }

    return errorObject;
  }

  private _toStackObjectArray(jsStack: NodeJS.CallSite[]): IStackFrame[] {
    const stackFrame: IStackFrame[] = Object.values(jsStack).reduce(
      (stackFrameObj: IStackFrame[], callsite: NodeJS.CallSite) => {
        stackFrameObj.push(
          LoggerHelper.toStackFrameObject(wrapCallSite(callsite))
        );
        return stackFrameObj;
      },
      []
    );
    return stackFrame;
  }

  private _printPrettyLog(logObject: ILogObject): void {
    const std: IStd =
      logObject.logLevelId < this._minLevelToStdErr
        ? this.settings.stdOut
        : this.settings.stdErr;
    const nowStr: string = logObject.date
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");
    const colorName: TUtilsInspectColors = this.settings.logLevelsColors[
      logObject.logLevelId
    ];

    std.write(LoggerHelper.styleString(["gray"], `${nowStr}\t`));

    std.write(
      LoggerHelper.styleString(
        [colorName, "bold"],
        ` ${logObject.logLevel.toUpperCase()} `
      ) + "\t"
    );

    const functionName: string = logObject.isConstructor
      ? ` ${logObject.typeName}.constructor`
      : logObject.methodName != null
      ? ` ${logObject.typeName}.${logObject.methodName}`
      : logObject.functionName != null
      ? ` ${logObject.functionName}`
      : "";

    const instanceName: string =
      this.settings.instanceName != null
        ? `@${this.settings.instanceName}`
        : "";
    const loggerName: string =
      logObject.loggerName != null ? logObject.loggerName : "";

    const name: string =
      (loggerName + instanceName).length > 0
        ? `${loggerName}${instanceName} `
        : "";

    std.write(
      LoggerHelper.styleString(
        ["gray"],
        `[${name}${logObject.filePath}:${logObject.lineNumber}${functionName}]`
      ) + "  \t"
    );

    logObject.argumentsArray.forEach((argument: unknown | IErrorObject) => {
      const errorObject: IErrorObject = argument as IErrorObject;
      if (typeof argument === "object" && errorObject.isError) {
        this._printPrettyError(std, errorObject);
      } else if (typeof argument === "object" && !errorObject.isError) {
        std.write("\n" + inspect(argument, this.settings.prettyInspectOptions));
      } else {
        std.write(format(argument) + " ");
      }
    });
    std.write("\n");

    if (logObject.stack != null) {
      std.write(
        LoggerHelper.styleString(["underline", "bold"], "log stack:\n")
      );

      this._printPrettyStack(std, logObject.stack);
    }
  }

  private _printPrettyError(
    std: IStd,
    errorObject: IErrorObject,
    printStackTrace: boolean = true
  ): void {
    std.write(
      "\n" +
        LoggerHelper.styleString(
          ["bgRed", "whiteBright", "bold"],
          ` ${errorObject.name} `
        ) +
        `\t${format(errorObject.message)}`
    );

    if (Object.values(errorObject.details).length > 0) {
      std.write(LoggerHelper.styleString(["underline", "bold"], "\ndetails:"));
      std.write(
        "\n" + inspect(errorObject.details, this.settings.prettyInspectOptions)
      );
    }

    if (printStackTrace === true) {
      std.write(
        LoggerHelper.styleString(["underline", "bold"], "\nerror stack:")
      );

      this._printPrettyStack(std, errorObject.stack);
    }
    if (errorObject.codeFrame != null) {
      this._printPrettyCodeFrame(std, errorObject.codeFrame);
    }
  }

  private _printPrettyStack(std: IStd, stackObjectArray: IStackFrame[]): void {
    std.write("\n");
    Object.values(stackObjectArray).forEach((stackObject: IStackFrame) => {
      std.write(
        LoggerHelper.styleString(["gray"], "• ") +
          LoggerHelper.styleString(["yellowBright"], stackObject.fileName) +
          LoggerHelper.styleString(["gray"], ":") +
          LoggerHelper.styleString(["yellow"], stackObject.lineNumber) +
          LoggerHelper.styleString(
            ["white"],
            " " + (stackObject.functionName ?? "<anonymous>")
          )
      );
      std.write("\n    ");
      std.write(
        fileNormalize(
          LoggerHelper.styleString(
            ["gray"],
            `${stackObject.filePath}:${stackObject.lineNumber}:${stackObject.columnNumber}`
          )
        )
      );
      std.write("\n\n");
    });
  }

  private _printPrettyCodeFrame(std: IStd, codeFrame: ICodeFrame): void {
    std.write(LoggerHelper.styleString(["underline", "bold"], "code frame:\n"));

    let lineNumber: number = codeFrame.firstLineNumber;
    codeFrame.linesBefore.forEach((line: string) => {
      std.write(`  ${LoggerHelper.lineNumberTo3Char(lineNumber)} | ${line}\n`);
      lineNumber++;
    });

    std.write(
      LoggerHelper.styleString(["red"], ">") +
        " " +
        LoggerHelper.styleString(
          ["bgRed", "whiteBright"],
          LoggerHelper.lineNumberTo3Char(lineNumber)
        ) +
        " | " +
        LoggerHelper.styleString(["yellow"], codeFrame.relevantLine) +
        "\n"
    );
    lineNumber++;

    if (codeFrame.columnNumber != null) {
      const positionMarker: string =
        new Array(codeFrame.columnNumber + 8).join(" ") + `^`;
      std.write(LoggerHelper.styleString(["red"], positionMarker) + "\n");
    }

    codeFrame.linesAfter.forEach((line: string) => {
      std.write(`  ${LoggerHelper.lineNumberTo3Char(lineNumber)} | ${line}\n`);
      lineNumber++;
    });
  }

  private _printJsonLog(logObject: ILogObject): void {
    const std: IStd =
      logObject.logLevelId < this._minLevelToStdErr
        ? this.settings.stdOut
        : this.settings.stdErr;

    const logObjectStringifiable: ILogObjectStringifiable = {
      ...logObject,
      argumentsArray: logObject.argumentsArray.map(
        (argument: unknown | IErrorObject) => {
          const errorObject: IErrorObject = argument as IErrorObject;
          if (typeof argument === "object" && errorObject.isError) {
            return {
              ...errorObject,
              nativeError: undefined,
              errorString: format(errorObject.nativeError),
            } as IErrorObjectStringified;
          } else {
            return inspect(argument, this.settings.jsonInspectOptions);
          }
        }
      ),
    };

    std.write(JSON.stringify(logObjectStringifiable) + "\n");
  }
}
