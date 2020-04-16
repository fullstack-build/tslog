import * as chalk from "chalk";
import { highlight } from "cli-highlight";
import {
  basename as fileBasename,
  normalize as fileNormalize,
  sep as pathSeparator,
} from "path";
import { format, types } from "util";
import {
  IErrorObject,
  ILogLevel,
  ILogObject,
  ISettingsParam,
  IStackFrame,
  ITransportLogger,
  ITransportProvider,
  TLogLevel,
} from "./interfaces";
import { LoggerHelper } from "./LoggerHelper";
export { ITransportLogger };

export class Logger {
  private readonly logLevels: ILogLevel = {
    0: "silly",
    1: "trace",
    2: "debug",
    3: "info",
    4: "warn",
    5: "error",
    6: "fatal",
  };
  private ignoreStackLevels = 3;
  private attachedTransports: ITransportProvider[] = [];
  private readonly minLevelToStdErr: number = 4;

  // Settings
  private readonly name?: string;
  private readonly minLevel: number;
  private readonly exposeStack: boolean;
  private readonly doOverwriteConsole: boolean;
  private readonly logAsJson: boolean;
  private readonly logLevelsColors: ILogLevel;

  constructor(private readonly nodeId: string, settings: ISettingsParam) {
    this.name = settings.name;
    this.minLevel = settings.minLevel ?? 0;
    this.exposeStack = settings.exposeStack ?? false;
    this.doOverwriteConsole = settings.doOverwriteConsole ?? false;
    this.logAsJson = settings.logAsJson ?? false;
    this.logLevelsColors = settings.logLevelsColors ?? {
      0: "#B0B0B0",
      1: "#FFFFFF",
      2: "#63C462",
      3: "#2020C0",
      4: "#CE8743",
      5: "#CD444C",
      6: "#FF0000",
    };

    LoggerHelper.errorToJsonHelper();
    if (this.doOverwriteConsole) {
      LoggerHelper.overwriteConsole(this, this.handleLog);
    }
  }

  public attachTransport(
    logger: ITransportLogger<(...args: any[]) => void>,
    minLevel: TLogLevel = 0
  ) {
    this.attachedTransports.push({
      minLevel,
      logger,
    });
  }

  public silly(...args: any[]) {
    return this.handleLog.apply(this, [0, args]);
  }

  public trace(...args: any[]) {
    return this.handleLog.apply(this, [1, args, true]);
  }

  public debug(...args: any[]) {
    return this.handleLog.apply(this, [2, args]);
  }

  public info(...args: any[]) {
    return this.handleLog.apply(this, [3, args]);
  }

  public warn(...args: any[]) {
    return this.handleLog.apply(this, [4, args]);
  }

  public error(...args: any[]) {
    return this.handleLog.apply(this, [5, args]);
  }

  public fatal(...args: any[]) {
    return this.handleLog.apply(this, [6, args]);
  }

  private handleLog(
    logLevel: TLogLevel,
    logArguments: any[],
    doExposeStack: boolean = this.exposeStack
  ): ILogObject {
    const logObject = this.buildLogObject(
      logLevel,
      logArguments,
      doExposeStack
    );

    if (logLevel >= this.minLevel) {
      if (!this.logAsJson) {
        this.printPrettyLog(logObject);
      } else {
        this.printJsonLog(logObject);
      }
    }

    this.attachedTransports.forEach((transport: ITransportProvider) => {
      if (logLevel >= transport.minLevel) {
        transport[this.logLevels[logLevel]](logObject);
      }
    });

    return logObject;
  }

  private buildLogObject(
    logLevel: TLogLevel,
    logArguments: any[],
    doExposeStack: boolean = true
  ): ILogObject {
    const callSites: NodeJS.CallSite[] = LoggerHelper.getCallSites();
    const relevantCallSites = callSites.splice(this.ignoreStackLevels);
    const stackFrame = LoggerHelper.wrapCallSiteOrIgnore(relevantCallSites[0]);
    const stackFrameObject = Logger.toStackFrameObject(stackFrame);

    const logObject: ILogObject = {
      loggerName: this.name ?? "",
      date: new Date(),
      logLevel: logLevel,
      logLevelName: this.logLevels[logLevel],
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

    logArguments.forEach((arg: any) => {
      if (typeof arg === "object" && !types.isNativeError(arg)) {
        logObject.argumentsArray.push(JSON.parse(JSON.stringify(arg)));
      } else if (typeof arg === "object" && types.isNativeError(arg)) {
        const errorStack = LoggerHelper.getCallSites(arg);
        const errorObject: IErrorObject = JSON.parse(JSON.stringify(arg));
        errorObject.name = errorObject.name ?? "Error";
        errorObject.isError = true;
        errorObject.stack = this.toStackObjectArray(errorStack);
        logObject.argumentsArray.push(errorObject);
      } else {
        logObject.argumentsArray.push(format(arg));
      }
    });

    if (doExposeStack) {
      logObject.stack = this.toStackObjectArray(relevantCallSites);
    }

    return logObject;
  }

  private toStackObjectArray(jsStack: NodeJS.CallSite[]): IStackFrame[] {
    let prettyStack: IStackFrame[] = Object.values(jsStack).reduce(
      (iPrettyStack: IStackFrame[], stackFrame: NodeJS.CallSite) => {
        iPrettyStack.push(
          Logger.toStackFrameObject(
            LoggerHelper.wrapCallSiteOrIgnore(stackFrame)
          )
        );
        return iPrettyStack;
      },
      []
    );
    return prettyStack;
  }

  private static toStackFrameObject(stackFrame: NodeJS.CallSite): IStackFrame {
    const filePath = stackFrame.getFileName();

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

  private printPrettyLog(logObject: ILogObject) {
    // only errors should go to stdErr
    const std =
      logObject.logLevel < this.minLevelToStdErr
        ? process.stdout
        : process.stderr;
    const nowStr = logObject.date
      .toISOString()
      .replace("T", " ")
      .replace("Z", "");
    const hexColor = this.logLevelsColors[logObject.logLevel];

    std.write(chalk`{grey ${nowStr}}\t`);
    std.write(
      chalk.hex(hexColor).bold(` ${logObject.logLevelName.toUpperCase()}\t`)
    );

    const functionName = logObject.isConstructor
      ? `${logObject.typeName}.constructor`
      : logObject.methodName != null
      ? `${logObject.typeName}.${logObject.methodName}`
      : `${logObject.functionName}`;
    std.write(
      chalk.gray(
        `[${logObject.loggerName}@${this.nodeId} ${logObject.filePath}:${logObject.lineNumber} ${functionName}]\t`
      )
    );

    logObject.argumentsArray.forEach((arg: any) => {
      if (typeof arg === "object" && !arg.isError) {
        std.write(
          "\n" +
            highlight(JSON.stringify(arg, null, 2), { language: "JSON" }) +
            " "
        );
      } else if (typeof arg === "object" && arg.isError) {
        std.write(
          format(
            chalk`\n{whiteBright.bgRed.bold ${arg.name}}{grey :} ${format(
              arg.message
            )}\n`
          )
        );

        this.printPrettyStack(std, arg.stack);
      } else {
        std.write(format(arg + " "));
      }
    });
    std.write("\n");

    if (logObject.stack != null) {
      std.write(chalk`{underline.bold log stack:\n}`);
      this.printPrettyStack(std, logObject.stack);
    }
  }

  private printPrettyStack(
    std: NodeJS.WriteStream,
    stackObjectArray: IStackFrame[]
  ) {
    std.write("\n");
    Object.values(stackObjectArray).forEach((stackObject: IStackFrame) => {
      std.write(
        chalk`    {grey •} {yellowBright ${
          stackObject.fileName
        }}{grey :}{yellow ${stackObject.lineNumber}} {white ${
          stackObject.functionName ?? "<anonumous>"
        }}`
      );
      std.write("\n    ");
      std.write(
        fileNormalize(
          chalk`{grey ${stackObject.fullFilePath}:${stackObject.lineNumber}:${stackObject.columnNumber}}`
        )
      );
      std.write("\n\n");
    });
  }

  private printJsonLog(logObject: ILogObject) {
    // only errors should go to stdErr
    const std =
      logObject.logLevel < this.minLevelToStdErr
        ? process.stdout
        : process.stderr;
    std.write(highlight(JSON.stringify(logObject)) + "\n");
  }
}
