import { BaseLogger } from "./BaseLogger.js";
import type { ILogObj, ILogObjMeta, ISettingsParam } from "./interfaces.js";
import { DefaultLogLevels } from "./interfaces.js";

export * from "./BaseLogger.js";
export * from "./interfaces.js";

/**
 * Universal TypeScript logger for Node.js, browsers, Deno, Bun, and workers. Zero runtime dependencies,
 * pretty or JSON output, sub-loggers, secret masking, and structured error/cause formatting.
 *
 * @example
 * // Pretty, colorized output — best for local development:
 * import { Logger } from "tslog";
 * const log = new Logger();
 * log.info("ready");
 *
 * @example
 * // Structured JSON for production / observability / LLM ingestion:
 * const log = new Logger({ type: "json", minLevel: "INFO" });
 * log.info({ event: "tool_call", tool: "search", durationMs: 142, tokens: 318 });
 *
 * @example
 * // A child logger per request/agent — settings and fields are inherited automatically:
 * const requestLog = log.getSubLogger({ name: "agent:planner" });
 *
 * @typeParam LogObj - Shape of your structured log object; defaults are fine for most apps.
 */
export class Logger<LogObj> extends BaseLogger<LogObj> {
  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj) {
    const isBrowser = ![typeof window, typeof document].includes("undefined");

    const normalizedSettings = settings ? { ...settings } : {};

    if (isBrowser && normalizedSettings.stylePrettyLogs == null) {
      normalizedSettings.stylePrettyLogs = true;
    }

    // Auto-detect the caller frame the same way as the Node entry point. The previous hardcoded
    // Safari/other frame counts (4/5) are brittle across engines (Safari, Bun, Deno collapse or omit
    // frames differently); pattern-based detection finds the first non-tslog frame regardless of runtime.
    super(normalizedSettings, logObj, Number.NaN);
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
    return super.log(DefaultLogLevels.SILLY, "SILLY", ...args);
  }

  /**
   * Logs a trace message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public trace(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(DefaultLogLevels.TRACE, "TRACE", ...args);
  }

  /**
   * Logs a debug message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public debug(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(DefaultLogLevels.DEBUG, "DEBUG", ...args);
  }

  /**
   * Logs an info message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public info(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(DefaultLogLevels.INFO, "INFO", ...args);
  }

  /**
   * Logs a warn message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public warn(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(DefaultLogLevels.WARN, "WARN", ...args);
  }

  /**
   * Logs an error message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public error(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(DefaultLogLevels.ERROR, "ERROR", ...args);
  }

  /**
   * Logs a fatal message.
   * @param args  - Multiple log attributes that should be logged out.
   */
  public fatal(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(DefaultLogLevels.FATAL, "FATAL", ...args);
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

/**
 * A ready-to-use default logger instance with pretty output — import and log without any setup.
 * For structured logs, masking, or custom settings, create your own `new Logger({ ... })` instead.
 *
 * @example
 * import { log } from "tslog";
 * log.info("hello");
 */
export const log: Logger<ILogObj> = new Logger<ILogObj>();
