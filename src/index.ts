/**
 * Expressive TypeScript Logger for Node.js
 * @packageDocumentation
 */

import { hostname } from "os";
import { normalize as fileNormalize } from "path";
import { inspect, format } from "util";
import { wrapCallSite } from "source-map-support";

import {
  ILogLevel,
  IErrorObject,
  ILogObject,
  ISettings,
  ISettingsParam,
  IStackFrame,
  IStd,
  TRequestIdFunction,
  TTransportLogger,
  ITransportProvider,
  TLogLevelName,
  TLogLevelId,
  IHighlightStyles,
  TLogLevelColor,
  ICodeFrame,
  ILogObjectStringifiable,
  TUtilsInspectColors,
  IErrorObjectStringifiable,
  IFullDateTimeFormatPart,
} from "./interfaces";
import { LoggerHelper } from "./LoggerHelper";
import { InspectOptions } from "util";

export {
  ILogLevel,
  TTransportLogger,
  ILogObject,
  ILogObjectStringifiable,
  IErrorObject,
  IErrorObjectStringifiable,
  IStackFrame,
  ISettingsParam,
  IStd,
  TLogLevelName,
  TRequestIdFunction,
  TLogLevelId,
  IHighlightStyles,
  TLogLevelColor,
  TUtilsInspectColors,
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
  private _parentOrDefaultSettings: ISettings;
  private _mySettings: ISettingsParam = {};
  private _childLogger: Logger[] = [];
  private _maskValuesOfKeysRegExp: RegExp | undefined;
  private _maskAnyRegExp: RegExp | undefined;

  /**
   * @param settings - Configuration of the logger instance  (all settings are optional with sane defaults)
   */
  public constructor(settings?: ISettingsParam, parentSettings?: ISettings) {
    this._parentOrDefaultSettings = {
      type: "pretty",
      instanceName: hostname(),
      name: undefined,
      setCallerAsLoggerName: false,
      requestId: undefined,
      minLevel: "silly",
      exposeStack: false,
      exposeErrorCodeFrame: true,
      exposeErrorCodeFrameLinesBeforeAndAfter: 5,
      suppressStdOutput: false,
      overwriteConsole: false,
      logLevelsColors: {
        0: "whiteBright",
        1: "white",
        2: "greenBright",
        3: "blueBright",
        4: "yellowBright",
        5: "redBright",
        6: "magentaBright",
      },
      prettyInspectHighlightStyles: {
        special: "cyan",
        number: "green",
        bigint: "green",
        boolean: "yellow",
        undefined: "red",
        null: "red",
        string: "red",
        symbol: "green",
        date: "magenta",
        name: "white",
        regexp: "red",
        module: "underline",
      },
      prettyInspectOptions: {
        colors: true,
        compact: false,
        depth: Infinity,
      },
      jsonInspectOptions: {
        colors: false,
        compact: true,
        depth: Infinity,
      },
      dateTimePattern: "year-month-day hour:minute:second.millisecond",
      // local timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      dateTimeTimezone: "utc",

      prefix: [],
      maskValuesOfKeys: ["password"],
      maskAny: [],
      maskPlaceholder: "[***]",

      printLogMessageInNewLine: false,

      // display settings
      displayDateTime: true,
      displayLogLevel: true,
      displayInstanceName: false,
      displayLoggerName: true,
      displayRequestId: true,
      displayFilePath: "hideNodeModulesOnly",
      displayFunctionName: true,
      displayTypes: false,

      stdOut: process.stdout,
      stdErr: process.stderr,
    };
    const mySettings: ISettingsParam = settings != null ? settings : {};
    this.setSettings(mySettings, parentSettings);

    LoggerHelper.initErrorToJsonHelper();
  }

  /** Readonly settings of the current logger instance. Used for testing. */
  public get settings(): ISettings {
    const myPrefix: unknown[] =
      this._mySettings.prefix != null ? this._mySettings.prefix : [];
    return {
      ...this._parentOrDefaultSettings,
      ...this._mySettings,
      prefix: [...this._parentOrDefaultSettings.prefix, ...myPrefix],
    };
  }

  /**
   *  Change settings during runtime
   *  Changes will be propagated to potential child loggers
   *
   * @param settings - Settings to overwrite with. Only this settings will be overwritten, rest will remain the same.
   * @param parentSettings - INTERNAL USE: Is called by a parent logger to propagate new settings.
   */
  public setSettings(
    settings: ISettingsParam,
    parentSettings?: ISettings
  ): ISettings {
    this._mySettings = {
      ...this._mySettings,
      ...settings,
    };

    this._mySettings.name =
      this._mySettings.name ??
      (this._mySettings.setCallerAsLoggerName
        ? LoggerHelper.getCallSites()?.[0]?.getTypeName() ??
          LoggerHelper.getCallSites()?.[0]?.getFunctionName() ??
          undefined
        : undefined);

    if (parentSettings != null) {
      this._parentOrDefaultSettings = {
        ...this._parentOrDefaultSettings,
        ...parentSettings,
      };
    }

    this._maskValuesOfKeysRegExp =
      this.settings.maskValuesOfKeys?.length > 0
        ? new RegExp(
            "^(.[^']*)(" +
              Object.values(this.settings.maskValuesOfKeys).join(
                ".[^\\w_)].*:|"
              ) +
              ".[^\\w_)].*:).*(\\,?)$",
            "gim"
          )
        : undefined;

    this._maskAnyRegExp =
      this.settings.maskAny?.length > 0
        ? new RegExp(Object.values(this.settings.maskAny).join("|"), "g")
        : undefined;

    LoggerHelper.setUtilsInspectStyles(
      this.settings.prettyInspectHighlightStyles
    );

    if (this.settings.overwriteConsole) {
      LoggerHelper.overwriteConsole(this, this._handleLog);
    }

    this._childLogger.forEach((childLogger: Logger) => {
      childLogger.setSettings({}, this.settings);
    });

    return this.settings;
  }

  /**
   *  Returns a child logger based on the current instance with inherited settings
   *
   * @param settings - Overwrite settings inherited from parent logger
   */
  public getChildLogger(settings?: ISettingsParam): Logger {
    const childSettings: ISettings = {
      ...this.settings,
    };
    const childLogger: Logger = new Logger(settings, childSettings);
    this._childLogger.push(childLogger);
    return childLogger;
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
      } else if (this.settings.type === "json") {
        this._printJsonLog(logObject);
      } else {
        // don't print (e.g. "hidden")
      }
    }

    this._attachedTransports.forEach((transport: ITransportProvider) => {
      if (
        logObject.logLevelId >=
        Object.values(this._logLevels).indexOf(transport.minLevel)
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

    const requestId: string | undefined =
      this.settings.requestId instanceof Function
        ? this.settings.requestId()
        : this.settings.requestId;

    const logObject: ILogObject = {
      instanceName: this.settings.instanceName,
      loggerName: this.settings.name,
      hostname: hostname(),
      requestId,
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
      toJSON: () => this._logObjectToJson(logObject),
    };

    const logArgumentsWithPrefix: unknown[] = [
      ...this.settings.prefix,
      ...logArguments,
    ];

    logArgumentsWithPrefix.forEach((arg: unknown) => {
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

    const relevantCallSites: NodeJS.CallSite[] =
      (errorCallSites?.splice && errorCallSites.splice(stackOffset)) ?? [];

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

    if (this.settings.displayDateTime === true) {
      const dateTimeParts: IFullDateTimeFormatPart[] = [
        ...(new Intl.DateTimeFormat("en", {
          weekday: undefined,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          timeZone: this.settings.dateTimeTimezone,
        }).formatToParts(logObject.date) as IFullDateTimeFormatPart[]),
        {
          type: "millisecond",
          value: logObject.date.getMilliseconds().toString(),
        } as IFullDateTimeFormatPart,
      ];

      const nowStr: string = dateTimeParts.reduce(
        (prevStr, thisStr) => prevStr.replace(thisStr.type, thisStr.value),
        this.settings.dateTimePattern
      );
      std.write(LoggerHelper.styleString(["gray"], `${nowStr}\t`));
    }

    if (this.settings.displayLogLevel) {
      const colorName: TUtilsInspectColors = this.settings.logLevelsColors[
        logObject.logLevelId
      ];

      std.write(
        LoggerHelper.styleString(
          [colorName, "bold"],
          ` ${logObject.logLevel.toUpperCase()} `
        ) + "\t"
      );
    }

    const loggerName: string =
      this.settings.displayLoggerName === true && logObject.loggerName != null
        ? logObject.loggerName
        : "";

    const instanceName: string =
      this.settings.displayInstanceName === true &&
      this.settings.instanceName != null
        ? `@${this.settings.instanceName}`
        : "";

    const traceId: string =
      this.settings.displayRequestId === true && logObject.requestId != null
        ? `:${logObject.requestId}`
        : "";

    const name: string =
      (loggerName + instanceName + traceId).length > 0
        ? loggerName + instanceName + traceId
        : "";

    const functionName: string =
      this.settings.displayFunctionName === true
        ? logObject.isConstructor
          ? ` ${logObject.typeName}.constructor`
          : logObject.methodName != null
          ? ` ${logObject.typeName}.${logObject.methodName}`
          : logObject.functionName != null
          ? ` ${logObject.functionName}`
          : ""
        : "";

    let fileLocation: string = "";
    if (
      this.settings.displayFilePath === "displayAll" ||
      (this.settings.displayFilePath === "hideNodeModulesOnly" &&
        logObject.filePath.indexOf("node_modules") < 0)
    ) {
      fileLocation = `${logObject.filePath}:${logObject.lineNumber}`;
    }
    const concatenatedMetaLine: string = [name, fileLocation, functionName]
      .join(" ")
      .replace(/\s\s+/g, " ")
      .trim();
    if (concatenatedMetaLine.length > 0) {
      std.write(
        LoggerHelper.styleString(["gray"], `[${concatenatedMetaLine}]`) + "  \t"
      );

      if (this.settings.printLogMessageInNewLine === false) {
        std.write("  \t");
      } else {
        std.write("\n");
      }
    }

    logObject.argumentsArray.forEach((argument: unknown | IErrorObject) => {
      const typeStr: string =
        this.settings.displayTypes === true
          ? LoggerHelper.styleString(["grey", "bold"], typeof argument + ":") +
            " "
          : "";

      const errorObject: IErrorObject = argument as IErrorObject;
      if (typeof argument === "object" && errorObject?.isError === true) {
        this._printPrettyError(std, errorObject);
      } else if (
        typeof argument === "object" &&
        errorObject?.isError !== true
      ) {
        std.write(
          "\n" +
            typeStr +
            this._inspectAndHideSensitive(
              argument,
              this.settings.prettyInspectOptions
            )
        );
      } else {
        std.write(typeStr + this._formatAndHideSesitive(argument) + " ");
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
        (errorObject.message != null
          ? `\t${this._formatAndHideSesitive(errorObject.message)}`
          : "")
    );

    if (Object.values(errorObject.details).length > 0) {
      std.write(LoggerHelper.styleString(["underline", "bold"], "\ndetails:"));
      std.write(
        "\n" +
          this._inspectAndHideSensitive(
            errorObject.details,
            this.settings.prettyInspectOptions
          )
      );
    }

    if (printStackTrace === true && errorObject?.stack?.length > 0) {
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
      std.write(LoggerHelper.styleString(["gray"], "• "));

      if (stackObject.fileName != null) {
        std.write(
          LoggerHelper.styleString(["yellowBright"], stackObject.fileName)
        );
      }

      if (stackObject.lineNumber != null) {
        std.write(LoggerHelper.styleString(["gray"], ":"));
        std.write(LoggerHelper.styleString(["yellow"], stackObject.lineNumber));
      }

      std.write(
        LoggerHelper.styleString(
          ["white"],
          " " + (stackObject.functionName ?? "<anonymous>")
        )
      );

      if (
        stackObject.filePath != null &&
        stackObject.lineNumber != null &&
        stackObject.columnNumber != null
      ) {
        std.write("\n    ");
        std.write(
          fileNormalize(
            LoggerHelper.styleString(
              ["gray"],
              `${stackObject.filePath}:${stackObject.lineNumber}:${stackObject.columnNumber}`
            )
          )
        );
      }
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

  private _logObjectToJson(logObject: ILogObject): ILogObjectStringifiable {
    return {
      ...logObject,
      argumentsArray: logObject.argumentsArray.map(
        (argument: unknown | IErrorObject) => {
          const errorObject: IErrorObject = argument as IErrorObject;
          if (typeof argument === "object" && errorObject.isError) {
            return {
              ...errorObject,
              nativeError: undefined,
              errorString: this._formatAndHideSesitive(errorObject.nativeError),
            } as IErrorObjectStringifiable;
          } else if (typeof argument === "object") {
            return this._inspectAndHideSensitive(
              argument,
              this.settings.jsonInspectOptions
            );
          } else {
            return this._formatAndHideSesitive(argument);
          }
        }
      ),
    };
  }

  private _printJsonLog(logObject: ILogObject): void {
    const std: IStd =
      logObject.logLevelId < this._minLevelToStdErr
        ? this.settings.stdOut
        : this.settings.stdErr;

    std.write(JSON.stringify(logObject) + "\n");
  }

  private _inspectAndHideSensitive(
    object: unknown,
    options: InspectOptions
  ): string {
    let inspectedString: string = inspect(object, options);

    if (this._maskValuesOfKeysRegExp != null) {
      inspectedString = inspectedString.replace(
        this._maskValuesOfKeysRegExp,
        "$1$2 " +
          LoggerHelper.styleString(
            [this.settings.prettyInspectHighlightStyles.string],
            `'${this.settings.maskPlaceholder}'`
          ) +
          "$3"
      );
    }

    return this._maskAnyRegExp != null
      ? inspectedString.replace(
          this._maskAnyRegExp,
          this.settings.maskPlaceholder
        )
      : inspectedString;
  }

  private _formatAndHideSesitive(
    formatParam: unknown,
    ...param: unknown[]
  ): string {
    const formattedStr: string = format(formatParam, ...param);
    return this._maskAnyRegExp != null
      ? formattedStr.replace(this._maskAnyRegExp, this.settings.maskPlaceholder)
      : formattedStr;
  }
}
