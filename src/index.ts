/**
 * Expressive TypeScript Logger for Node.js
 * @packageDocumentation
 */

import { format } from "util";
import { hostname } from "os";
import { normalize as fileNormalize } from "path";
import { wrapCallSite } from "source-map-support";
import * as chalk from "chalk";

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
  IJsonHighlightColors,
  TLogLevelColor,
  ICodeFrame,
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
  IJsonHighlightColors,
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
    this.settings = {
      displayInstanceName: displayInstanceName,
      instanceName: displayInstanceName
        ? settings?.instanceName ?? hostname()
        : undefined,
      name: settings?.name ?? "",
      minLevel: settings?.minLevel ?? "silly",
      logAsJson: settings?.logAsJson ?? false,
      exposeStack: settings?.exposeStack ?? false,
      exposeErrorCodeFrame: settings?.exposeErrorCodeFrame ?? true,
      exposeErrorCodeFrameLinesBeforeAndAfter:
        settings?.exposeErrorCodeFrameLinesBeforeAndAfter ?? 5,
      suppressStdOutput: settings?.suppressStdOutput ?? false,
      overwriteConsole: settings?.overwriteConsole ?? false,
      logLevelsColors: settings?.logLevelsColors ?? {
        0: "#B0B0B0",
        1: "#FFFFFF",
        2: "#63C462",
        3: "#2b98ba",
        4: "#CE8743",
        5: "#EE444C",
        6: "#900000",
      },
      jsonHighlightColors: settings?.jsonHighlightColors ?? {
        number: "#FF6188",
        key: "#A9DC76",
        string: "#FFD866",
        boolean: "#FC9867",
        null: "#AB9DF2",
      },
      stdOut: settings?.stdOut ?? process.stdout,
      stdErr: settings?.stdErr ?? process.stderr,
    };

    LoggerHelper.errorToJsonHelper();
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

  private _handleLog(
    logLevel: TLogLevelName,
    logArguments: unknown[],
    doExposeStack: boolean = this.settings.exposeStack
  ): ILogObject {
    const logObject: ILogObject = this._buildLogObject(
      logLevel,
      logArguments,
      doExposeStack
    );

    if (
      !this.settings.suppressStdOutput &&
      logObject.logLevelId >= this._logLevels.indexOf(this.settings.minLevel)
    ) {
      if (!this.settings.logAsJson) {
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
    doExposeStack: boolean = true
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
      loggerName: this.settings.name ?? "",
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
        const errorStack: NodeJS.CallSite[] = LoggerHelper.getCallSites(
          arg as Error
        );
        const errorObject: IErrorObject = JSON.parse(JSON.stringify(arg));
        errorObject.name = errorObject.name ?? "Error";
        errorObject.isError = true;
        errorObject.stack = this._toStackObjectArray(errorStack);
        const errorCallSite: IStackFrame = LoggerHelper.toStackFrameObject(
          wrapCallSite(errorStack[0])
        );
        if (
          this.settings.exposeErrorCodeFrame &&
          errorCallSite.lineNumber != null
        ) {
          errorObject.codeFrame = LoggerHelper._getCodeFrame(
            errorCallSite.fullFilePath,
            errorCallSite.lineNumber,
            errorCallSite.columnNumber,
            this.settings.exposeErrorCodeFrameLinesBeforeAndAfter
          );
        }
        logObject.argumentsArray.push(errorObject);
      } else {
        logObject.argumentsArray.push(arg);
      }
    });

    if (doExposeStack) {
      logObject.stack = this._toStackObjectArray(relevantCallSites);
    }

    return logObject;
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
    const hexColor: string = this.settings.logLevelsColors[
      logObject.logLevelId
    ];

    std.write(chalk`{grey ${nowStr}}\t`);
    std.write(
      chalk.hex(hexColor).bold(` ${logObject.logLevel.toUpperCase()}\t`)
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
        ? `@${this.settings.instanceName} `
        : "";

    std.write(
      chalk`{grey [${logObject.loggerName}${instanceName}${logObject.filePath}:${logObject.lineNumber}${functionName}]}\t`
    );

    logObject.argumentsArray.forEach((argument: unknown | IErrorObject) => {
      const errorArgument: IErrorObject = argument as IErrorObject;
      if (typeof argument === "object" && !errorArgument.isError) {
        std.write(
          "\n" +
            LoggerHelper.colorizeJson(
              argument ?? "",
              chalk,
              this.settings.jsonHighlightColors,
              true
            ) +
            " "
        );
      } else if (typeof argument === "object" && errorArgument.isError) {
        std.write(
          chalk.bgHex("AA0A0A").bold(`\n ${errorArgument.name} `) +
            `  ${format(errorArgument.message)}\n`
        );

        this._printPrettyStack(std, errorArgument.stack);
        if (errorArgument.codeFrame != null) {
          this._printPrettyCodeFrame(std, errorArgument.codeFrame);
        }
      } else {
        std.write(format(argument) + " ");
      }
    });
    std.write("\n");

    if (logObject.stack != null) {
      std.write(chalk`{underline.bold log stack:\n}`);
      this._printPrettyStack(std, logObject.stack);
    }
  }

  private _printPrettyStack(std: IStd, stackObjectArray: IStackFrame[]): void {
    std.write("\n");
    Object.values(stackObjectArray).forEach((stackObject: IStackFrame) => {
      std.write(
        chalk`    {grey •} {yellowBright ${
          stackObject.fileName
        }}{grey :}{yellow ${stackObject.lineNumber}} {white ${
          stackObject.functionName ?? "<anonymous>"
        }}`
      );
      std.write("\n    ");
      std.write(
        fileNormalize(
          chalk`{grey ${stackObject.filePath}:${stackObject.lineNumber}:${stackObject.columnNumber}}`
        )
      );
      std.write("\n\n");
    });
  }

  private _printPrettyCodeFrame(std: IStd, codeFrame: ICodeFrame): void {
    std.write(chalk`{underline.bold code frame:\n}`);
    let lineNumber: number = codeFrame.firstLineNumber;
    codeFrame.linesBefore.forEach((line: string) => {
      std.write(
        chalk`  ${LoggerHelper.lineNumberTo3Char(lineNumber)} | ${line}\n`
      );
      lineNumber++;
    });

    std.write(
      chalk`{red >} {bgRed.whiteBright ${LoggerHelper.lineNumberTo3Char(
        lineNumber
      )}} | {yellow ${codeFrame.relevantLine}}\n`
    );
    lineNumber++;

    if (codeFrame.columnNumber != null) {
      const positionMarker: string =
        new Array(codeFrame.columnNumber + 8).join(" ") + chalk`{red ^}`;
      std.write(`${positionMarker}\n`);
    }

    codeFrame.linesAfter.forEach((line: string) => {
      std.write(
        chalk`  ${LoggerHelper.lineNumberTo3Char(lineNumber)} | ${line}\n`
      );
      lineNumber++;
    });
  }

  private _printJsonLog(logObject: ILogObject): void {
    const std: IStd =
      logObject.logLevelId < this._minLevelToStdErr
        ? this.settings.stdOut
        : this.settings.stdErr;
    std.write(JSON.stringify(logObject) + "\n");
  }
}
