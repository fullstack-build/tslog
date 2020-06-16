import { InspectOptions } from "util";
import DateTimeFormatPartTypes = Intl.DateTimeFormatPartTypes;

/**
 * All possible log levels
 * @public
 */
export interface ILogLevel {
  0: "silly";
  1: "trace";
  2: "debug";
  3: "info";
  4: "warn";
  5: "error";
  6: "fatal";
}

/**
 * Log level IDs (0 - 6)
 * @public
 */
export type TLogLevelId = keyof ILogLevel;

/**
 * Log level names (sill - fatal)
 * @public
 */
export type TLogLevelName = ILogLevel[TLogLevelId];

/**
 * Hex colors of different log levels
 * @public
 */
export type TLogLevelColor = {
  [key in TLogLevelId]: TUtilsInspectColors;
};

/**
 * Constructor: logger settings
 * all values are optional and will be pre-filled with default values
 * @public
 */
export interface ISettingsParam {
  /** Print log pretty or as a stringified json, default: `pretty` */
  type?: "json" | "pretty";

  /** Name of the instance name, default: _host name_ */
  instanceName?: string;

  /** Optional name of the logger instance, default: `undefined` */
  name?: string;

  /** Use the name of the caller type as the name of the logger, default: `false` */
  setCallerAsLoggerName?: boolean;

  /** Minimum output log level (e.g. debug), default: "silly" */
  minLevel?: TLogLevelName;

  /** Expose stack with EVERY log message, default: `false`  */
  exposeStack?: boolean;

  /** Get Code Frame of an Error and expose it, default: `true` */
  exposeErrorCodeFrame?: boolean;

  /** Capture lines before and after a code frame, default: `5` */
  exposeErrorCodeFrameLinesBeforeAndAfter?: number;

  /** Suppress any log output to std out / std err */
  suppressStdOutput?: boolean;

  /** Catch logs going to console (e.g. console.log). Last instantiated Log instance wins */
  overwriteConsole?: boolean;

  /**  Overwrite colors of log messages of different log levels */
  logLevelsColors?: TLogLevelColor;

  /**  Overwrite colors json highlighting */
  prettyInspectHighlightStyles?: IHighlightStyles;

  /**  Options to be set for utils.inspect when output is set to pretty, default: `setting` */
  prettyInspectOptions?: InspectOptions;

  /**  Options to be set for utils.inspect when output is set to json (\{ type: "json" \}) */
  jsonInspectOptions?: InspectOptions;

  /**  DateTime pattern based on Intl.DateTimeFormat.formatToParts with additional milliseconds, default: `year-month-day hour:minute:second.millisecond` */
  dateTimePattern?: string;

  /** DateTime timezone, e.g. `utc`, or `Europe/Berlin`, `Europe/Moscow`. You can use `Intl.DateTimeFormat().resolvedOptions().timeZone` for local timezone, default: "utc" */
  dateTimeTimezone?: string;

  /** Print log message in a new line below meta information, default: `false` */
  printLogMessageInNewLine?: boolean;

  /** Display date time at the beginning of a log message, default: `true` */
  displayDateTime?: boolean;

  /** Display log level, default: `true` */
  displayLogLevel?: boolean;

  /** Display instanceName or not, default: `false` */
  displayInstanceName?: boolean;

  /** Display name of the logger. Will only be visible if `name` was set, default: `true` */
  displayLoggerName?: boolean;

  /** Display file path, default "hideNodeModulesOnly" */
  displayFilePath?: "hidden" | "displayAll" | "hideNodeModulesOnly";

  /** Display function name, default: `true`*/
  displayFunctionName?: boolean;

  /** Display type information for each attribute passed. */
  displayAttributeType?: boolean;

  /**  Overwrite default std out */
  stdOut?: IStd;

  /**  Overwrite default std err */
  stdErr?: IStd;

  /**  Prefix every log message of this logger. */
  prefix?: unknown[];
}

/**
 * The actual settings object
 * Based on ISettingsParam, however pre-filled with defaults in case no value was provided.
 * @public
 */
export interface ISettings extends ISettingsParam {
  type: "json" | "pretty";
  instanceName?: string;
  name?: string;
  setCallerAsLoggerName: boolean;
  minLevel: TLogLevelName;
  exposeStack: boolean;
  exposeErrorCodeFrame: boolean;
  exposeErrorCodeFrameLinesBeforeAndAfter: number;
  suppressStdOutput: boolean;
  overwriteConsole: boolean;
  logLevelsColors: TLogLevelColor;
  prettyInspectHighlightStyles: IHighlightStyles;
  prettyInspectOptions: InspectOptions;
  jsonInspectOptions: InspectOptions;
  dateTimePattern: string;
  dateTimeTimezone: string;
  printLogMessageInNewLine: boolean;
  displayDateTime: boolean;
  displayLogLevel: boolean;
  displayInstanceName: boolean;
  displayLoggerName?: boolean;
  displayFilePath: "hidden" | "displayAll" | "hideNodeModulesOnly";
  displayFunctionName: boolean;
  displayAttributeType: boolean;
  stdOut: IStd;
  stdErr: IStd;
  prefix: unknown[];
}

/**
 * StdOut and StdErr have to implement a write function (e.g. Stream)
 * @public
 */
export interface IStd {
  /** stream.Writable */
  write: Function;
}

/**
 * All relevant information about a log message
 * @public
 */
export interface IStackFrame {
  /** Relative path based on the main folder */
  filePath: string;
  /** Full path */
  fullFilePath: string;
  /** Name of the file */
  fileName: string;
  /** Line number */
  lineNumber: number | null;
  /** Column Name */
  columnNumber: number | null;
  /** Called from constructor */
  isConstructor: boolean | null;
  /** Name of the function */
  functionName: string | null;
  /** Name of the class */
  typeName: string | null;
  /** Name of the Method */
  methodName: string | null;
}

/**
 * All relevant information about a log message.
 * @public
 */
export interface ILogObject extends IStackFrame {
  /**  Optional name of the instance this application is running on. */
  instanceName?: string;
  /**  Optional name of the logger or empty string. */
  loggerName?: string;
  /* Name of the host */
  hostname: string;
  /**  Timestamp */
  date: Date;
  /**  Log level name (e.g. debug) */
  logLevel: TLogLevelName;
  /**  Log level ID (e.g. 3) */
  logLevelId: TLogLevelId;
  /**  Log arguments */
  argumentsArray: (IErrorObject | unknown)[];
  /**  Optional Log stack trace */
  stack?: IStackFrame[];
}

export interface ILogObjectStringifiable extends ILogObject {
  argumentsArray: (IErrorObjectStringified | string)[];
}

/**
 * Object representing an error with a stack trace
 * @public
 */
export interface IErrorObject {
  /** Is this object an error? */
  isError: true;
  /** Name of the error*/
  name: string;
  /** Error message */
  message: string;
  /** additional Error details */
  details: object;
  /** native Error object */
  nativeError: Error;
  /** Stack trace of the error */
  stack: IStackFrame[];
  /** Code frame of the error */
  codeFrame?: ICodeFrame;
}

export interface IErrorObjectStringified extends IErrorObject {
  nativeError: never;
  errorString: string;
}

/**
 * List of attached transport logger with their respective min log level.
 * @public
 */
export type TTransportLogger<T> = {
  [key in TLogLevelName]: T;
};

export interface ITransportProvider {
  minLevel: TLogLevelName;
  transportLogger: TTransportLogger<(message: ILogObject) => void>;
}

/**
 * Style and color options for utils.inspect.style
 * @public
 */
export type TUtilsInspectColors =
  | "reset"
  | "bold"
  | "dim"
  | "italic"
  | "underline"
  | "blink"
  | "inverse"
  | "hidden"
  | "strikethrough"
  | "doubleunderline"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "bgBlack"
  | "bgRed"
  | "bgGreen"
  | "bgYellow"
  | "bgBlue"
  | "bgMagenta"
  | "bgCyan"
  | "bgWhite"
  | "framed"
  | "overlined"
  | "gray"
  | "grey"
  | "redBright"
  | "greenBright"
  | "yellowBright"
  | "blueBright"
  | "magentaBright"
  | "cyanBright"
  | "whiteBright"
  | "bgGray"
  | "bgRedBright"
  | "bgGreenBright"
  | "bgYellowBright"
  | "bgBlueBright"
  | "bgMagentaBright"
  | "bgCyanBright"
  | "bgWhiteBright";

/**
 * Possible style settings of utils.inspect.styles
 * Official Node.js typedefs are missing this interface.
 * @public
 */
export interface IHighlightStyles {
  name?: TUtilsInspectColors;
  special?: TUtilsInspectColors;
  number?: TUtilsInspectColors;
  bigint?: TUtilsInspectColors;
  boolean?: TUtilsInspectColors;
  undefined?: TUtilsInspectColors;
  null?: TUtilsInspectColors;
  string?: TUtilsInspectColors;
  symbol?: TUtilsInspectColors;
  date?: TUtilsInspectColors;
  regexp?: TUtilsInspectColors;
  module?: TUtilsInspectColors;
}

/**
 * Code frame of an error
 * @public
 * */
export interface ICodeFrame {
  firstLineNumber: number;
  lineNumber: number;
  columnNumber: number | null;
  linesBefore: string[];
  relevantLine: string;
  linesAfter: string[];
}

type WithMillisecond<T> = T & "millisecond";
/* Extend Intl.DateTimeFormatPart with milliseconds */
export interface IFullDateTimeFormatPart {
  type: WithMillisecond<DateTimeFormatPartTypes>;
  value: string;
}
