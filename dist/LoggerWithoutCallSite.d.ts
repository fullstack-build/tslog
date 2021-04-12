/// <reference types="node" />
import { IErrorObject, ILogObject, ISettings, ISettingsParam, IStd, TTransportLogger, TLogLevelName } from "./interfaces";
import { Logger } from "./Logger";
/**
 * 📝 Expressive TypeScript Logger for Node.js
 * @public
 */
export declare class LoggerWithoutCallSite {
    private readonly _logLevels;
    private readonly _minLevelToStdErr;
    private _parentOrDefaultSettings;
    private _mySettings;
    private _childLogger;
    private _maskAnyRegExp;
    /**
     * @param settings - Configuration of the logger instance  (all settings are optional with sane defaults)
     * @param parentSettings - Used internally to
     */
    constructor(settings?: ISettingsParam, parentSettings?: ISettings);
    /** Readonly settings of the current logger instance. Used for testing. */
    get settings(): ISettings;
    /**
     *  Change settings during runtime
     *  Changes will be propagated to potential child loggers
     *
     * @param settings - Settings to overwrite with. Only this settings will be overwritten, rest will remain the same.
     * @param parentSettings - INTERNAL USE: Is called by a parent logger to propagate new settings.
     */
    setSettings(settings: ISettingsParam, parentSettings?: ISettings): ISettings;
    /**
     *  Returns a child logger based on the current instance with inherited settings
     *
     * @param settings - Overwrite settings inherited from parent logger
     */
    getChildLogger(settings?: ISettingsParam): Logger;
    /**
     *  Attaches external Loggers, e.g. external log services, file system, database
     *
     * @param transportLogger - External logger to be attached. Must implement all log methods.
     * @param minLevel        - Minimum log level to be forwarded to this attached transport logger. (e.g. debug)
     */
    attachTransport(transportLogger: TTransportLogger<(message: ILogObject) => void>, minLevel?: TLogLevelName): void;
    /**
     * Logs a silly message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    silly(...args: unknown[]): ILogObject;
    /**
     * Logs a trace message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    trace(...args: unknown[]): ILogObject;
    /**
     * Logs a debug message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    debug(...args: unknown[]): ILogObject;
    /**
     * Logs an info message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    info(...args: unknown[]): ILogObject;
    /**
     * Logs a warn message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    warn(...args: unknown[]): ILogObject;
    /**
     * Logs an error message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    error(...args: unknown[]): ILogObject;
    /**
     * Logs a fatal message.
     * @param args  - Multiple log attributes that should be logged out.
     */
    fatal(...args: unknown[]): ILogObject;
    /**
     * Helper: Pretty print error without logging it
     * @param error - Error object
     * @param print - Print the error or return only? (default: true)
     * @param exposeErrorCodeFrame  - Should the code frame be exposed? (default: true)
     * @param exposeStackTrace  - Should the stack trace be exposed? (default: true)
     * @param stackOffset - Offset lines of the stack trace (default: 0)
     * @param stackLimit  - Limit number of lines of the stack trace (default: Infinity)
     * @param std - Which std should the output be printed to? (default: stdErr)
     */
    prettyError(error: Error, print?: boolean, exposeErrorCodeFrame?: boolean, exposeStackTrace?: boolean, stackOffset?: number, stackLimit?: number, std?: IStd): IErrorObject;
    protected _callSiteWrapper: (callSite: NodeJS.CallSite) => NodeJS.CallSite;
    private _handleLog;
    private _buildLogObject;
    private _buildErrorObject;
    private _toStackObjectArray;
    /**
     * Pretty print the log object to the designated output.
     *
     * @param std - output where to pretty print the object
     * @param logObject - object to pretty print
     **/
    printPrettyLog(std: IStd, logObject: ILogObject): void;
    private _printPrettyError;
    private _printPrettyStack;
    private _printPrettyCodeFrame;
    private _logObjectToJson;
    private _printJsonLog;
    private _inspectAndHideSensitive;
    private _formatAndHideSensitive;
    private _maskValuesOfKeys;
    private _maskAny;
}
