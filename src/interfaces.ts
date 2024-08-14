import { InspectOptions } from "./runtime/browser/index.js";
export { InspectOptions };

export type TStyle =
  | null
  | string
  | string[]
  | {
      [value: string]: null | string | string[];
    };

export interface IPrettyLogStyles {
  yyyy?: TStyle;
  mm?: TStyle;
  dd?: TStyle;
  hh?: TStyle;
  MM?: TStyle;
  ss?: TStyle;
  ms?: TStyle;
  dateIsoStr?: TStyle;
  logLevelName?: TStyle;
  fileName?: TStyle;
  filePath?: TStyle;
  fileLine?: TStyle;
  filePathWithLine?: TStyle;
  name?: TStyle;
  nameWithDelimiterPrefix?: TStyle;
  nameWithDelimiterSuffix?: TStyle;
  errorName?: TStyle;
  errorMessage?: TStyle;
}

export interface ISettingsParam<LogObj> {
  type?: "json" | "pretty" | "hidden";
  name?: string;
  parentNames?: string[];
  minLevel?: number;
  argumentsArrayName?: string;
  hideLogPositionForProduction?: boolean;
  prettyLogTemplate?: string;
  prettyErrorTemplate?: string;
  prettyErrorStackTemplate?: string;
  prettyErrorParentNamesSeparator?: string;
  prettyErrorLoggerNameDelimiter?: string;
  stylePrettyLogs?: boolean;
  prettyLogTimeZone?: "UTC" | "local";
  prettyLogStyles?: IPrettyLogStyles;
  prettyInspectOptions?: InspectOptions;
  metaProperty?: string;
  maskPlaceholder?: string;
  maskValuesOfKeys?: string[];
  maskValuesOfKeysCaseInsensitive?: boolean;
  /** Mask all occurrences (case-sensitive) from values in logs (e.g. all secrets from ENVs etc.). Will be replaced with [***] */
  maskValuesRegEx?: RegExp[];
  /**  Prefix every log message of this logger. */
  prefix?: unknown[];
  /**  Array of attached Transports. Use Method `attachTransport` to attach transports. */
  attachedTransports?: ((transportLogger: LogObj & ILogObjMeta) => void)[];
  overwrite?: {
    addPlaceholders?: (logObjMeta: IMeta, placeholderValues: Record<string, string | number>) => void;
    mask?: (args: unknown[]) => unknown[];
    toLogObj?: (args: unknown[], clonesLogObj?: LogObj) => LogObj;
    addMeta?: (logObj: LogObj, logLevelId: number, logLevelName: string, defaultMeta?: IMeta) => LogObj & ILogObjMeta;
    includeDefaultMetaInAddMeta?: boolean;
    formatMeta?: (meta?: IMeta) => string;
    formatLogObj?: (maskedArgs: unknown[], settings: ISettings<LogObj>) => { args: unknown[]; errors: string[] };
    transportFormatted?: (logMetaMarkup: string, logArgs: unknown[], logErrors: string[], settings: ISettings<LogObj>) => void;
    transportJSON?: (json: unknown) => void;
  };
}

export interface ISettings<LogObj> extends ISettingsParam<LogObj> {
  type: "json" | "pretty" | "hidden";
  name?: string;
  parentNames?: string[];
  minLevel: number;
  argumentsArrayName?: string;
  hideLogPositionForProduction: boolean;
  prettyLogTemplate: string;
  prettyErrorTemplate: string;
  prettyErrorStackTemplate: string;
  prettyErrorParentNamesSeparator: string;
  prettyErrorLoggerNameDelimiter: string;
  stylePrettyLogs: boolean;
  prettyLogTimeZone: "UTC" | "local";
  prettyLogStyles: {
    yyyy?: TStyle;
    mm?: TStyle;
    dd?: TStyle;
    hh?: TStyle;
    MM?: TStyle;
    ss?: TStyle;
    ms?: TStyle;
    dateIsoStr?: TStyle;
    logLevelName?: TStyle;
    fileName?: TStyle;
    fileNameWithLine?: TStyle;
    filePath?: TStyle;
    fileLine?: TStyle;
    filePathWithLine?: TStyle;
    name?: TStyle;
    nameWithDelimiterPrefix?: TStyle;
    nameWithDelimiterSuffix?: TStyle;
    errorName?: TStyle;
    errorMessage?: TStyle;
  };
  prettyInspectOptions: InspectOptions;
  metaProperty: string;
  maskPlaceholder: string;
  maskValuesOfKeys: string[];
  maskValuesOfKeysCaseInsensitive: boolean;
  prefix: unknown[];
  attachedTransports: ((transportLogger: LogObj & ILogObjMeta) => void)[];
}

export interface ILogObj {
  [name: string]: unknown;
}

export interface ILogObjMeta {
  [name: string]: IMeta;
}

export interface IStackFrame {
  fullFilePath?: string;
  fileName?: string;
  fileNameWithLine?: string;
  filePath?: string;
  fileLine?: string;
  fileColumn?: string;
  filePathWithLine?: string;
  method?: string;
}

/**
 * Object representing an error with a stack trace
 * @public
 */
export interface IErrorObject {
  /** Name of the error*/
  name: string;
  /** Error message */
  message: string;
  /** native Error object */
  nativeError: Error;
  /** Stack trace of the error */
  stack: IStackFrame[];
}

/**
 * ErrorObject that can safely be "JSON.stringifed". All circular structures have been "util.inspected" into strings
 * @public
 */
export interface IErrorObjectStringifiable extends IErrorObject {
  nativeError: never;
  errorString: string;
}

/**
 * Object representing an error with a stack trace
 * @public
 */
export interface IErrorObject {
  /** Name of the error*/
  name: string;
  /** Error message */
  message: string;
  /** native Error object */
  nativeError: Error;
  /** Stack trace of the error */
  stack: IStackFrame[];
}

/*
  RUNTIME TYPES
*/
export interface IMetaStatic {
  name?: string;
  parentNames?: string[];
  runtime: string;
}

export interface IMeta extends IMetaStatic {
  date: Date;
  logLevelId: number;
  logLevelName: string;
  path?: IStackFrame;
}

export interface IRuntime {
  getMeta: (
    logLevelId: number,
    logLevelName: string,
    stackDepthLevel: number,
    hideLogPositionForPerformance: boolean,
    name?: string,
    parentNames?: string[]
  ) => IMeta;
  getCallerStackFrame: (stackDepthLevel: number, error: Error) => IStackFrame;
  getErrorTrace: (error: Error) => IStackFrame[];
  isError: (e: Error | unknown) => boolean;
  prettyFormatLogObj: <LogObj>(maskedArgs: unknown[], settings: ISettings<LogObj>) => { args: unknown[]; errors: string[] };
  prettyFormatErrorObj: <LogObj>(error: Error, settings: ISettings<LogObj>) => string;
  transportFormatted: <LogObj>(logMetaMarkup: string, logArgs: unknown[], logErrors: string[], settings: ISettings<LogObj>) => void;
  transportJSON: <LogObj>(json: LogObj & ILogObjMeta) => void;
  isBuffer: (b: unknown) => boolean;
}
