import { IMeta, InspectOptions } from "./runtime/nodejs";

export type TStyle =
  | null
  | string
  | string[]
  | {
      [value: string]: null | string | string[];
    };

export interface ISettingsParam<LogObj> {
  type?: "json" | "pretty" | "hidden";
  argumentsArrayName?: string;
  prettyLogTemplate?: string;
  prettyErrorTemplate?: string;
  prettyErrorStackTemplate?: string;
  stylePrettyLogs?: boolean;
  prettyLogStyles?: {
    yyyy?: TStyle;
    mm?: TStyle;
    dd?: TStyle;
    hh?: TStyle;
    MM?: TStyle;
    ss?: TStyle;
    ms?: TStyle;
    dateIsoStr?: TStyle;
    logLevelName?: TStyle;
    filePath?: TStyle;
    fileLine?: TStyle;
  };
  metaProperty?: string;
  prettyInspectOptions?: InspectOptions;
  maskPlaceholder?: string;
  maskValuesOfKeys?: string[];
  maskValuesOfKeysCaseInsensitive?: boolean;
  overwrite?: {
    mask?: (args: unknown[]) => unknown[];
    toLogObj?: (args: unknown[]) => LogObj;
    addMeta?: (logObj: LogObj, logLevelId: number, logLevelName: string) => LogObj & ILogObjMeta;
    formatMeta?: (meta?: IMeta) => string;
    formatLogObj?: (maskedArgs: unknown[], settings: ISettings<LogObj>) => { args: unknown[]; errors: string[] };
    transportFormatted?: (logMetaMarkup: string, logArgs: unknown[], logErrors: string[], settings: ISettings<LogObj>) => void;
    transportJSON?: (json: unknown) => void;
  };
  /**  Array of attached Transports. Use Method `attachTransport` to attach transports. */
  attachedTransports?: ((transportLogger: LogObj & ILogObjMeta) => void)[];
  /**  Prefix every log message of this logger. */
  prefix?: unknown[];
  /** Mask all occurrences (case-sensitive) from values in logs (e.g. all secrets from ENVs etc.). Will be replaced with [***] */
  maskValuesRegEx?: RegExp[];
}

export interface ISettings<LogObj> extends ISettingsParam<LogObj> {
  type: "json" | "pretty" | "hidden";
  argumentsArrayName?: string;
  prettyLogTemplate: string;
  prettyErrorTemplate: string;
  prettyErrorStackTemplate: string;
  stylePrettyLogs: boolean;
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
    filePath?: TStyle;
    fileLine?: TStyle;
    filePathWithLine?: TStyle;
    errorName?: TStyle;
    errorMessage?: TStyle;
  };
  metaProperty: string;
  prettyInspectOptions: InspectOptions;
  maskPlaceholder: string;
  maskValuesOfKeys: string[];
  maskValuesOfKeysCaseInsensitive: boolean;
  attachedTransports: ((transportLogger: LogObj & ILogObjMeta) => void)[];
  prefix: unknown[];
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
