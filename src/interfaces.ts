import { Chalk } from "chalk";

interface ILogLevel {
  0: "silly";
  1: "trace";
  2: "debug";
  3: "info";
  4: "warn";
  5: "error";
  6: "fatal";
}

export type TLogLevelId = keyof ILogLevel;

export type TLogLevelName = ILogLevel[TLogLevelId];

export type TLogLevel = {
  [key in TLogLevelId]: TLogLevelName;
};

export type TLogLevelColor = {
  [key in TLogLevelId]: string;
};

/**
 * @public
 */
export interface ISettingsParam {
  /** Name of the instance name, default: host name */
  instanceName?: string;

  /** Display instanceName or not, default: false */
  displayInstanceName?: boolean;

  /** Name of the logger instance */
  name?: string;

  /** Minimum output log level (e.g. debug) */
  minLevel?: TLogLevelName;

  /** Print log as stringified json instead of pretty */
  logAsJson?: boolean;

  /** Expose stack with EVERY log message */
  exposeStack?: boolean;

  /** Suppress any log output to std out / std err */
  suppressLogging?: boolean;

  /** Catch logs going to console (e.g. console.log). Last instantiated Log instance wins */
  overwriteConsole?: boolean;

  /**  Overwrite colors of log messages of different log levels */
  logLevelsColors?: TLogLevelColor;

  /**  Overwrite colors json highlighting */
  jsonHighlightColors?: IJsonHighlightColors;

  /**  Overwrite default std out */
  stdOut?: IStd;

  /**  Overwrite default std err */
  stdErr?: IStd;
}

export interface ISettings extends ISettingsParam {
  instanceName?: string;
  displayInstanceName?: boolean;
  name: string;
  minLevel: TLogLevelName;
  logAsJson: boolean;
  exposeStack: boolean;
  suppressLogging: boolean;
  overwriteConsole: boolean;
  logLevelsColors: TLogLevelColor;
  jsonHighlightColors: IJsonHighlightColors;
  stdOut: IStd;
  stdErr: IStd;
}

/**
 * @public
 */
export interface IStd {
  write: Function;
}

/**
 * All relevant information about a log message
 * @public
 */
export interface IStackFrame {
  filePath: string;
  fullFilePath: string;
  fileName: string;
  lineNumber: number | null;
  columnNumber: number | null;
  isConstructor: boolean | null;
  functionName: string | null;
  typeName: string | null;
  methodName: string | null;
}

/**
 * All relevant information about a log message
 * @public
 */
export interface ILogObject extends IStackFrame {
  instanceName?: string;
  loggerName: string;
  date: Date;
  logLevel: TLogLevelName;
  logLevelId: TLogLevelId;
  argumentsArray: (IErrorObject | unknown)[];
  stack?: IStackFrame[];
}

/**
 * @public
 */
export interface IErrorObject {
  isError: true;
  name: string;
  message: string;
  stack: IStackFrame[];
}

/**
 * @public
 */
export type TTransportLogger<T> = {
  [key in TLogLevelName]: T;
};

export interface ITransportProvider {
  minLevel: TLogLevelName;
  transportLogger: TTransportLogger<(message: ILogObject) => void>;
}

export interface IJsonHighlightColors {
  number: string;
  key: string;
  string: string;
  boolean: string;
  null: string;
}

export interface IJsonHighlightColorsChalk {
  number: Chalk;
  key: Chalk;
  string: Chalk;
  boolean: Chalk;
  null: Chalk;
}
