export interface ISettingsParam {
  name?: string;
  minLevel?: number;
  exposeStack?: boolean;
  doOverwriteConsole?: boolean;
  logAsJson?: boolean;
  logLevelsColors?: ILogLevel;
}

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

export interface ILogObject extends IStackFrame {
  loggerName: string;
  date: Date;
  logLevel: number;
  logLevelName: string;
  argumentsArray: (string | object)[];
  stack?: IStackFrame[];
}

export interface IErrorObject {
  isError: true;
  name: string;
  message: string;
  stack: IStackFrame[];
}

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
  logger: ITransportLogger<(...args: any[]) => void>;
}
