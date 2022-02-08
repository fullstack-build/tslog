import { hostname } from "os";
import { normalize as fileNormalize } from "path";
import { inspect, formatWithOptions } from "util";

import {
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
  ICodeFrame,
  ILogObjectStringifiable,
  TUtilsInspectColors,
  IErrorObjectStringifiable,
  IFullDateTimeFormatPart,
} from "./interfaces";
import { LoggerHelper } from "./LoggerHelper";
import { InspectOptions } from "util";
import { Logger } from "./Logger";

/**
 * 📝 Expressive TypeScript Logger for Node.js
 * @public
 */
export class LoggerWithoutCallSite {
  private readonly _logLevels: TLogLevelName[] = [
    "silly",
    "trace",
    "debug",
    "info",
    "warn",
    "error",
    "fatal",
  ];

  private readonly _minLevelToStdErr: number = 4;
  private _parentOrDefaultSettings: ISettings;
  private _mySettings: ISettingsParam = {};
  private _childLogger: Logger[] = [];
  private _maskAnyRegExp: RegExp | undefined;

  /**
   * @param settings - Configuration of the logger instance  (all settings are optional with sane defaults)
   * @param parentSettings - Used internally to
   */
  public constructor(settings?: ISettingsParam, parentSettings?: ISettings) {
    this._parentOrDefaultSettings = {
      type: "pretty",
      instanceName: undefined,
      hostname: parentSettings?.hostname ?? hostname(),
      name: undefined,
      setCallerAsLoggerName: false,
      requestId: undefined,
      minLevel: "silly",
      exposeStack: false,
      exposeErrorCodeFrame: true,
      exposeErrorCodeFrameLinesBeforeAndAfter: 5,
      ignoreStackLevels: 3,
      suppressStdOutput: false,
      overwriteConsole: false,
      colorizePrettyLogs: true,
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
      delimiter: " ",
      dateTimePattern: undefined,
      // local timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      dateTimeTimezone: undefined,

      prefix: [],
      maskValuesOfKeys: ["password"],
      maskAnyRegEx: [],
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
      attachedTransports: [],
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

    if (
      this.settings.prettyInspectOptions?.colors != null ||
      this.settings.prettyInspectOptions?.colors === true
    ) {
      this.settings.prettyInspectOptions.colors =
        this.settings.colorizePrettyLogs;
    }

    this._mySettings.instanceName =
      this._mySettings.instanceName ?? this._mySettings.hostname;

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

    this._maskAnyRegExp =
      this.settings.maskAnyRegEx?.length > 0
        ? // eslint-disable-next-line @rushstack/security/no-unsafe-regexp
          new RegExp(Object.values(this.settings.maskAnyRegEx).join("|"), "g")
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

    const childLogger: Logger = new (this.constructor as new (
      settings?: ISettingsParam,
      parentSettings?: ISettings
    ) => this)(settings, childSettings);

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
    this.settings.attachedTransports.push({
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

  protected _callSiteWrapper: (callSite: NodeJS.CallSite) => NodeJS.CallSite = (
    callSite: NodeJS.CallSite
  ) => callSite;

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
      const std: IStd =
        logObject.logLevelId < this._minLevelToStdErr
          ? this.settings.stdOut
          : this.settings.stdErr;

      if (this.settings.type === "pretty") {
        this.printPrettyLog(std, logObject);
      } else if (this.settings.type === "json") {
        this._printJsonLog(std, logObject);
      } else {
        // don't print (e.g. "hidden")
      }
    }

    this.settings.attachedTransports.forEach(
      (transport: ITransportProvider) => {
        if (
          logObject.logLevelId >=
          Object.values(this._logLevels).indexOf(transport.minLevel)
        ) {
          transport.transportLogger[logLevel](logObject);
        }
      }
    );

    return logObject;
  }

  private _buildLogObject(
    logLevel: TLogLevelName,
    logArguments: unknown[],
    exposeStack: boolean = true
  ): ILogObject {
    const callSites: NodeJS.CallSite[] = LoggerHelper.getCallSites();

    const relevantCallSites: NodeJS.CallSite[] = callSites.splice(
      this.settings.ignoreStackLevels
    );
    const stackFrame: NodeJS.CallSite | undefined =
      relevantCallSites[0] != null
        ? this._callSiteWrapper(relevantCallSites[0])
        : undefined;

    const stackFrameObject: IStackFrame | undefined =
      stackFrame != null
        ? LoggerHelper.toStackFrameObject(stackFrame)
        : undefined;

    const requestId: string | undefined =
      this.settings.requestId instanceof Function
        ? this.settings.requestId()
        : this.settings.requestId;

    const logObject: ILogObject = {
      instanceName: this.settings.instanceName,
      loggerName: this.settings.name,
      hostname: this.settings.hostname,
      requestId,
      date: new Date(),
      logLevel: logLevel,
      logLevelId: this._logLevels.indexOf(logLevel) as TLogLevelId,
      filePath: stackFrameObject?.filePath,
      fullFilePath: stackFrameObject?.fullFilePath,
      fileName: stackFrameObject?.fileName,
      lineNumber: stackFrameObject?.lineNumber,
      columnNumber: stackFrameObject?.columnNumber,
      isConstructor: stackFrameObject?.isConstructor,
      functionName: stackFrameObject?.functionName,
      typeName: stackFrameObject?.typeName,
      methodName: stackFrameObject?.methodName,
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

    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      name: _name,
      ...errorWithoutName
    } = error;

    const errorObject: IErrorObject = {
      nativeError: error,
      details: { ...errorWithoutName },
      name: error.name ?? "Error",
      isError: true,
      message: error.message,
      stack: this._toStackObjectArray(relevantCallSites),
    };

    if (errorObject.stack.length > 0) {
      const errorCallSite: IStackFrame = LoggerHelper.toStackFrameObject(
        this._callSiteWrapper(relevantCallSites[0])
      );
      if (exposeErrorCodeFrame && errorCallSite.lineNumber != null) {
        if (
          errorCallSite.fullFilePath != null &&
          errorCallSite.fullFilePath.indexOf("node_modules") < 0
        ) {
          errorObject.codeFrame = LoggerHelper._getCodeFrame(
            errorCallSite.fullFilePath,
            errorCallSite.lineNumber,
            errorCallSite?.columnNumber,
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
          LoggerHelper.toStackFrameObject(this._callSiteWrapper(callsite))
        );
        return stackFrameObj;
      },
      []
    );
    return stackFrame;
  }

  /**
   * Pretty print the log object to the designated output.
   *
   * @param std - output where to pretty print the object
   * @param logObject - object to pretty print
   **/
  public printPrettyLog(std: IStd, logObject: ILogObject): void {
    if (this.settings.displayDateTime === true) {
      let nowStr: string = "";
      if (
        this.settings.dateTimePattern != null ||
        this.settings.dateTimeTimezone != null
      ) {
        const dateTimePattern =
          this.settings.dateTimePattern ??
          "year-month-day hour:minute:second.millisecond";
        const dateTimeTimezone = this.settings.dateTimeTimezone ?? "utc";

        const dateTimeParts: IFullDateTimeFormatPart[] = [
          ...(new Intl.DateTimeFormat("en", {
            weekday: undefined,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hourCycle: "h23",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: dateTimeTimezone,
          }).formatToParts(logObject.date) as IFullDateTimeFormatPart[]),
          {
            type: "millisecond",
            value: ("00" + logObject.date.getMilliseconds()).slice(-3),
          } as IFullDateTimeFormatPart,
        ];

        nowStr = dateTimeParts.reduce(
          (prevStr: string, thisStr: IFullDateTimeFormatPart) =>
            prevStr.replace(thisStr.type, thisStr.value),
          dateTimePattern
        );
      } else {
        nowStr = new Date().toISOString().replace("T", " ").replace("Z", " ");
      }

      std.write(
        LoggerHelper.styleString(
          ["gray"],
          `${nowStr}${this.settings.delimiter}`,
          this.settings.colorizePrettyLogs
        )
      );
    }

    if (this.settings.displayLogLevel) {
      const colorName: TUtilsInspectColors =
        this.settings.logLevelsColors[logObject.logLevelId];

      std.write(
        LoggerHelper.styleString(
          [colorName, "bold"],
          logObject.logLevel.toUpperCase(),
          this.settings.colorizePrettyLogs
        ) +
          (logObject.logLevel === "info"
            ? this.settings.delimiter.repeat(2)
            : this.settings.delimiter)
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
          : logObject.typeName !== null
          ? `${logObject.typeName}.<anonymous>`
          : ""
        : "";

    let fileLocation: string = "";
    if (
      this.settings.displayFilePath === "displayAll" ||
      (this.settings.displayFilePath === "hideNodeModulesOnly" &&
        logObject.filePath != null &&
        logObject.filePath.indexOf("node_modules") < 0)
    ) {
      fileLocation = `${logObject.filePath}:${logObject.lineNumber}`;
    }
    const concatenatedMetaLine: string = [name, fileLocation, functionName]
      .join(" ")
      .trim();

    if (concatenatedMetaLine.length > 0) {
      std.write(
        LoggerHelper.styleString(
          ["gray"],
          `[${concatenatedMetaLine}]`,
          this.settings.colorizePrettyLogs
        )
      );

      if (this.settings.printLogMessageInNewLine === false) {
        std.write(`${this.settings.delimiter}`);
      } else {
        std.write("\n");
      }
    }

    logObject.argumentsArray.forEach((argument: unknown | IErrorObject) => {
      const typeStr: string =
        this.settings.displayTypes === true
          ? LoggerHelper.styleString(
              ["grey", "bold"],
              typeof argument + ":",
              this.settings.colorizePrettyLogs
            ) + this.settings.delimiter
          : "";

      const errorObject: IErrorObject = argument as IErrorObject;
      if (argument == null) {
        std.write(
          typeStr +
            this._inspectAndHideSensitive(
              argument as null,
              this.settings.prettyInspectOptions
            ) +
            " "
        );
      } else if (
        typeof argument === "object" &&
        errorObject?.isError === true
      ) {
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
        std.write(
          typeStr +
            this._formatAndHideSensitive(
              argument,
              this.settings.prettyInspectOptions
            ) +
            this.settings.delimiter
        );
      }
    });
    std.write("\n");

    if (logObject.stack != null) {
      std.write(
        LoggerHelper.styleString(
          ["underline", "bold"],
          "log stack:\n",
          this.settings.colorizePrettyLogs
        )
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
          ` ${errorObject.name}${this.settings.delimiter}`,
          this.settings.colorizePrettyLogs
        ) +
        (errorObject.message != null
          ? `${this.settings.delimiter}${this._formatAndHideSensitive(
              errorObject.message,
              this.settings.prettyInspectOptions
            )}`
          : "")
    );

    if (Object.values(errorObject.details).length > 0) {
      std.write(
        LoggerHelper.styleString(
          ["underline", "bold"],
          "\ndetails:",
          this.settings.colorizePrettyLogs
        )
      );
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
        LoggerHelper.styleString(
          ["underline", "bold"],
          "\nerror stack:",
          this.settings.colorizePrettyLogs
        )
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
        LoggerHelper.styleString(
          ["gray"],
          "• ",
          this.settings.colorizePrettyLogs
        )
      );

      if (stackObject.fileName != null) {
        std.write(
          LoggerHelper.styleString(
            ["yellowBright"],
            stackObject.fileName,
            this.settings.colorizePrettyLogs
          )
        );
      }

      if (stackObject.lineNumber != null) {
        std.write(
          LoggerHelper.styleString(
            ["gray"],
            ":",
            this.settings.colorizePrettyLogs
          )
        );
        std.write(
          LoggerHelper.styleString(
            ["yellow"],
            stackObject.lineNumber,
            this.settings.colorizePrettyLogs
          )
        );
      }

      std.write(
        LoggerHelper.styleString(
          ["white"],
          " " + (stackObject.functionName ?? "<anonymous>"),
          this.settings.colorizePrettyLogs
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
              `${stackObject.filePath}:${stackObject.lineNumber}:${stackObject.columnNumber}`,
              this.settings.colorizePrettyLogs
            )
          )
        );
      }
      std.write("\n\n");
    });
  }

  private _printPrettyCodeFrame(std: IStd, codeFrame: ICodeFrame): void {
    std.write(
      LoggerHelper.styleString(
        ["underline", "bold"],
        "code frame:\n",
        this.settings.colorizePrettyLogs
      )
    );

    let lineNumber: number = codeFrame.firstLineNumber;
    codeFrame.linesBefore.forEach((line: string) => {
      std.write(`  ${LoggerHelper.lineNumberTo3Char(lineNumber)} | ${line}\n`);
      lineNumber++;
    });

    std.write(
      LoggerHelper.styleString(["red"], ">", this.settings.colorizePrettyLogs) +
        " " +
        LoggerHelper.styleString(
          ["bgRed", "whiteBright"],
          LoggerHelper.lineNumberTo3Char(lineNumber),
          this.settings.colorizePrettyLogs
        ) +
        " | " +
        LoggerHelper.styleString(
          ["yellow"],
          codeFrame.relevantLine,
          this.settings.colorizePrettyLogs
        ) +
        "\n"
    );
    lineNumber++;

    if (codeFrame.columnNumber != null) {
      const positionMarker: string =
        new Array(codeFrame.columnNumber + 8).join(" ") + `^`;
      std.write(
        LoggerHelper.styleString(
          ["red"],
          positionMarker,
          this.settings.colorizePrettyLogs
        ) + "\n"
      );
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
          if (typeof argument === "object" && errorObject?.isError) {
            return {
              ...errorObject,
              nativeError: undefined,
              errorString: this._formatAndHideSensitive(
                errorObject.nativeError,
                this.settings.jsonInspectOptions
              ),
            } as IErrorObjectStringifiable;
          } else if (typeof argument === "object") {
            return this._inspectAndHideSensitive(
              argument,
              this.settings.jsonInspectOptions
            );
          } else {
            return this._formatAndHideSensitive(
              argument,
              this.settings.jsonInspectOptions
            );
          }
        }
      ),
    };
  }

  private _printJsonLog(std: IStd, logObject: ILogObject): void {
    std.write(JSON.stringify(logObject) + "\n");
  }

  private _inspectAndHideSensitive(
    object: object | null,
    inspectOptions: InspectOptions
  ): string {
    let formatted;
    try {
      const maskedObject = this._maskValuesOfKeys(object);
      formatted = inspect(maskedObject, inspectOptions);
    } catch {
      formatted = inspect(object, inspectOptions);
    }

    return this._maskAny(formatted);
  }

  private _formatAndHideSensitive(
    formatParam: unknown,
    inspectOptions: InspectOptions,
    ...param: unknown[]
  ): string {
    return this._maskAny(
      formatWithOptions(inspectOptions, formatParam, ...param)
    );
  }

  private _maskValuesOfKeys<T>(object: T): T {
    return LoggerHelper.logObjectMaskValuesOfKeys(
      object,
      this.settings.maskValuesOfKeys,
      this.settings.maskPlaceholder
    );
  }

  private _maskAny(str: string): string {
    const formattedStr = str;

    return this._maskAnyRegExp != null
      ? formattedStr.replace(this._maskAnyRegExp, this.settings.maskPlaceholder)
      : formattedStr;
  }
}
