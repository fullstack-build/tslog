import type { InspectOptions } from "./internal/InspectOptions.interface.js";
export type { InspectOptions };

/** The log level ids used by the default logging methods (silly … fatal). */
export enum DefaultLogLevels {
  SILLY = 0,
  TRACE = 1,
  DEBUG = 2,
  INFO = 3,
  WARN = 4,
  ERROR = 5,
  FATAL = 6,
}

export type TStyle =
  | null
  | string
  | string[]
  | {
      [value: string]: null | string | string[];
    };

/** Maps a log level name (e.g. "WARN") or "*" to the console method used to output it. */
export type TPrettyLogLevelMethod = {
  [logLevelName: string]: (...args: unknown[]) => void;
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
  fileNameWithLine?: TStyle;
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
  prettyLogLevelMethod?: TPrettyLogLevelMethod;
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
    /** When true, the default runtime meta is passed as the 4th argument to a custom `addMeta` handler so it can extend rather than replace it. */
    includeDefaultMetaInAddMeta?: boolean;
    formatMeta?: (meta?: IMeta) => string;
    formatLogObj?: (maskedArgs: unknown[], settings: ISettings<LogObj>) => { args: unknown[]; errors: string[] };
    transportFormatted?: (logMetaMarkup: string, logArgs: unknown[], logErrors: string[], logMeta?: IMeta, settings?: ISettings<LogObj>) => void;
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
  prettyLogStyles: IPrettyLogStyles;
  prettyLogLevelMethod: TPrettyLogLevelMethod;
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
  /** Optional nested cause chain */
  cause?: IErrorObject;
}

/**
 * ErrorObject that can safely be "JSON.stringifed". All circular structures have been "util.inspected" into strings
 * @public
 */
export interface IErrorObjectStringifiable extends IErrorObject {
  nativeError: never;
  errorString: string;
  cause?: IErrorObjectStringifiable;
}

/*
  RUNTIME TYPES
*/
export interface IMetaStatic {
  name?: string;
  parentNames?: string[];
  runtime: string;
  /** Runtime version string (Node/Deno/Bun only). */
  runtimeVersion?: string;
  /** Host name of the machine (server-side runtimes only). */
  hostname?: string;
  /** Browser user agent (browser/worker runtimes only). */
  browser?: string;
}

export interface IMeta extends IMetaStatic {
  date: Date;
  logLevelId: number;
  logLevelName: string;
  path?: IStackFrame;
}
