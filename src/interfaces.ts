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

/** The names of the default log levels, accepted by `minLevel` as a self-documenting alternative to the numeric id. */
export type TLogLevelName = keyof typeof DefaultLogLevels;

/** A default log level expressed as its numeric id, the {@link DefaultLogLevels} enum, or its name (e.g. `"WARN"`). */
export type TLogLevel = number | DefaultLogLevels | TLogLevelName;

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
  /**
   * Output format.
   * - `"pretty"` (default): human-readable, colorized — best for local development.
   * - `"json"`: one structured JSON object per line — best for production, observability backends, and LLM ingestion.
   * - `"hidden"`: suppress console output (still returns the log object and runs attached transports).
   * @example { type: "json" }
   */
  type?: "json" | "pretty" | "hidden";
  /** Optional name for this logger, shown in pretty output and inherited by sub-loggers (e.g. per-module or per-agent). */
  name?: string;
  parentNames?: string[];
  /**
   * Minimum level to emit; lower levels are skipped. Accepts a number, the {@link DefaultLogLevels} enum, or a level name.
   * Levels: `SILLY`(0) `TRACE`(1) `DEBUG`(2) `INFO`(3) `WARN`(4) `ERROR`(5) `FATAL`(6).
   * @example { minLevel: "WARN" }
   * @example { minLevel: DefaultLogLevels.INFO }
   */
  minLevel?: TLogLevel;
  argumentsArrayName?: string;
  /**
   * Additional RegExp patterns matched against stack frame file paths that should be treated as
   * "internal" when auto-detecting the calling code position. Use this so a wrapper/custom logger
   * reports the position of *its* caller instead of the wrapper file itself.
   */
  internalFramePatterns?: RegExp[];
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
  /** Property name under which runtime metadata (date, level, code position, runtime) is attached. Default: `"_meta"`. */
  metaProperty?: string;
  /** String used to replace masked values. Default: `"[***]"`. */
  maskPlaceholder?: string;
  /**
   * Redact the values of these object keys anywhere in the logged data (case-sensitive by default).
   * Use this to keep secrets and sensitive data — passwords, API keys, tokens, and (for AI/agentic apps) prompts and PII — out of your logs.
   * @example { maskValuesOfKeys: ["password", "apiKey", "authorization", "token"] }
   * @example { maskValuesOfKeys: ["prompt", "completion", "email"] } // agentic apps
   */
  maskValuesOfKeys?: string[];
  /** Match {@link maskValuesOfKeys} case-insensitively (so `"password"` also masks `"Password"`/`"PASSWORD"`). Default: `false`. */
  maskValuesOfKeysCaseInsensitive?: boolean;
  /**
   * Replace every substring matching these patterns in string values (e.g. secrets pulled from env vars, emails, IPs).
   * Applied with the {@link maskPlaceholder}.
   * @example { maskValuesRegEx: [/\b[A-Za-z0-9]{32,}\b/g] } // long token-like strings
   */
  maskValuesRegEx?: RegExp[];
  /**  Prefix every log message of this logger. */
  prefix?: unknown[];
  /**  Array of attached Transports. Use Method `attachTransport` to attach transports. */
  attachedTransports?: ((transportLogger: LogObj & ILogObjMeta) => void)[];
  /**
   * Hooks to override individual steps of the log pipeline (mask → toLogObj → addMeta → format → transport).
   * The most common use is `addMeta`, to attach correlation/trace ids and cost fields to every log.
   */
  overwrite?: {
    addPlaceholders?: (logObjMeta: IMeta, placeholderValues: Record<string, string | number>) => void;
    mask?: (args: unknown[]) => unknown[];
    toLogObj?: (args: unknown[], clonesLogObj?: LogObj) => LogObj;
    /**
     * Attach custom metadata to every log object. Set {@link includeDefaultMetaInAddMeta} to receive the default
     * runtime meta as `defaultMeta` and extend it instead of replacing it.
     * @example
     * // Inject a request/trace id and token cost into every log (great for agentic apps):
     * addMeta: (logObj, _id, _name, defaultMeta) => ({ ...logObj, _meta: { ...defaultMeta, traceId: getTraceId() } })
     */
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
  internalFramePatterns?: RegExp[];
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
