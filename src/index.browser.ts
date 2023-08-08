import { BaseLogger } from "./BaseLogger.js";
import { ILogObj, ILogObjMeta, ISettingsParam } from "./interfaces.js";

export * from "./interfaces.js";
export * from "./BaseLogger.js";

export class Logger<LogObj> extends BaseLogger<LogObj> {
  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj) {
    const isBrowser = ![typeof window, typeof document].includes("undefined");
    const isBrowserBlinkEngine = isBrowser
      ? ((window?.["chrome"] || (window.Intl && (Intl as unknown as { v8BreakIterator: unknown })?.v8BreakIterator)) && "CSS" in window) != null
      : false;
    const isSafari = isBrowser ? /^((?!chrome|android).)*safari/i.test(navigator.userAgent) : false;

    settings = settings || {};
    // style only for blink browsers
    settings.stylePrettyLogs = settings.stylePrettyLogs && isBrowser && !isBrowserBlinkEngine ? false : settings.stylePrettyLogs;

    super(settings, logObj, isSafari ? 4 : 5);
  }

  /**
   * Logs a message with a custom log level.
   * @param logLevelId    - Log level ID e.g. 0
   * @param logLevelName  - Log level name e.g. silly
   * @param args          - Multiple log attributes that should be logged out.
   */
  public log(logLevelId: number, logLevelName: string, ...args: unknown[]): (LogObj & ILogObjMeta & ILogObj) | undefined {
    return super.log(logLevelId, logLevelName, ...args);
  }

  /**
   * Logs a silly message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public silly(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(0, "SILLY", ...args);
  }

  /**
   * Logs a trace message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public trace(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(1, "TRACE", ...args);
  }

  /**
   * Logs a debug message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public debug(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(2, "DEBUG", ...args);
  }

  /**
   * Logs an info message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public info(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(3, "INFO", ...args);
  }

  /**
   * Logs a warn message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public warn(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(4, "WARN", ...args);
  }

  /**
   * Logs an error message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public error(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(5, "ERROR", ...args);
  }

  /**
   * Logs a fatal message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public fatal(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(6, "FATAL", ...args);
  }

  /**
   *  Returns a child logger based on the current instance with inherited settings
   *
   * @param settings - Overwrite settings inherited from parent logger
   * @param logObj - Overwrite logObj for sub-logger
   */
  public getSubLogger(settings?: ISettingsParam<LogObj>, logObj?: LogObj): Logger<LogObj> {
    return super.getSubLogger(settings, logObj) as Logger<LogObj>;
  }
}
