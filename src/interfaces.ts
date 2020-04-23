import { Chalk } from "chalk";

/**
 * @public
 */
export interface ISettingsParam {
  instanceId?: string;
  name?: string;
  minLevel?: number;
  exposeStack?: boolean;
  suppressLogging?: boolean;
  overwriteConsole?: boolean;
  logAsJson?: boolean;
  logLevelsColors?: ILogLevel;
  jsonHighlightColors?: IJsonHighlightColors;
  stdOut?: IStd;
  stdErr?: IStd;
}

export interface ISettings extends ISettingsParam {
  instanceId?: string;
  name: string;
  minLevel: number;
  exposeStack: boolean;
  suppressLogging: boolean;
  overwriteConsole: boolean;
  logAsJson: boolean;
  logLevelsColors: ILogLevel;
  jsonHighlightColors: IJsonHighlightColors;
  stdOut: IStd;
  stdErr: IStd;
}

export interface IStd {
  write: Function;
}

/**
 * @public
 */
export type TLogLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ILogLevel {
  0: string;
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: string;
}

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
 * @public
 */
export interface ILogObject extends IStackFrame {
  loggerName: string;
  date: Date;
  logLevel: number;
  logLevelName: string;
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
export interface ITransportLogger<T> {
  silly?: T;
  trace?: T;
  debug?: T;
  info?: T;
  warn?: T;
  error?: T;
  fatal?: T;
}

export interface ITransportProvider {
  minLevel: TLogLevel;
  logger: ITransportLogger<(message: ILogObject) => void>;
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
