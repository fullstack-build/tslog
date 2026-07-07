import { BaseLogger } from "./BaseLogger.js";
import { fullCoreFeatures } from "./core/features.full.js";
export { fullCoreFeatures };
export type { CoreFeatures, MaskingFeatureDeps, MaskingLike } from "./core/features.js";

import { settingsFromEnv } from "./core/fromEnv.js";
import { createBrowserEnvironment } from "./env/environment.browser.js";
import type { EnvironmentProvider } from "./env/environment.js";
import type { ILogObj, ILogObjMeta, ISettingsParam, TCustomLevelMethods } from "./interfaces.js";
import { LogLevel } from "./interfaces.js";

export * from "./BaseLogger.js";
export * from "./core/config.js";
// Re-export the runtime's environment provider factory so advanced users can construct a BaseLogger
// directly (BaseLogger requires an injected EnvironmentProvider as of v5 — BC11).
export { createBrowserEnvironment } from "./env/environment.browser.js";
export * from "./interfaces.js";

declare global {
  interface Window {
    chrome?: unknown;
  }
}

// Lazily memoized browser provider — created on first logger construction, never at module top level,
// so `sideEffects: false` keeps holding and the provider is not built when the module is merely imported.
let browserEnvironment: EnvironmentProvider | undefined;
function getBrowserEnvironment(): EnvironmentProvider {
  if (browserEnvironment == null) {
    browserEnvironment = createBrowserEnvironment();
  }
  return browserEnvironment;
}

/**
 * Universal TypeScript logger for Node.js, browsers, Deno, Bun, React Native, and workers. Zero runtime dependencies,
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
    // The browser's default `type` (pretty, with CSS `%c` styling) and `pretty.style` (on unless
    // NO_COLOR) are resolved inside normalizeSettings (M3.2) via resolveDefaultType/resolveStyle, so the
    // entry no longer needs to force a styling flag.
    //
    // Auto-detect the caller frame (NaN) rather than hardcoding Safari/other frame counts (4/5), which
    // are brittle across engines (Safari, Bun, Deno collapse or omit frames differently). The provider's
    // pattern-based detection finds the first non-tslog frame regardless of runtime.
    super(settings, logObj, getBrowserEnvironment(), Number.NaN, fullCoreFeatures);
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
   * @example log.silly("user logged in", { userId: 42 });   // string-first
   * @example log.silly({ userId: 42 }, "user logged in");   // pino-style fields-first
   */
  public silly(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public silly(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public silly(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(LogLevel.SILLY, "SILLY", ...args);
  }

  /**
   * Logs a trace message.
   * @example log.trace("entering fn", { arg: 1 });
   * @example log.trace({ arg: 1 }, "entering fn");
   */
  public trace(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public trace(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public trace(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(LogLevel.TRACE, "TRACE", ...args);
  }

  /**
   * Logs a debug message.
   * @example log.debug("cache miss", { key });
   * @example log.debug({ key }, "cache miss");
   */
  public debug(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public debug(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public debug(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(LogLevel.DEBUG, "DEBUG", ...args);
  }

  /**
   * Logs an info message.
   * @example log.info("server started", { port: 3000 });
   * @example log.info({ port: 3000 }, "server started");
   */
  public info(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public info(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public info(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(LogLevel.INFO, "INFO", ...args);
  }

  /**
   * Logs a warn message.
   * @example log.warn("slow query", { ms: 812 });
   * @example log.warn({ ms: 812 }, "slow query");
   */
  public warn(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public warn(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public warn(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(LogLevel.WARN, "WARN", ...args);
  }

  /**
   * Logs an error message.
   * @example log.error("request failed", err);
   * @example log.error({ requestId }, "request failed");
   */
  public error(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public error(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public error(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(LogLevel.ERROR, "ERROR", ...args);
  }

  /**
   * Logs a fatal message.
   * @example log.fatal("out of memory", err);
   * @example log.fatal({ pid }, "out of memory");
   */
  public fatal(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public fatal(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public fatal(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(LogLevel.FATAL, "FATAL", ...args);
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

  /**
   * Alias for {@link getSubLogger} (E2) — the pino/bunyan/winston `child(...)` convention. Returns a typed
   * `Logger<LogObj>` sub-logger with inherited, merged settings.
   *
   * @param settings - Overwrite settings inherited from parent logger
   * @param logObj - Overwrite logObj for sub-logger
   */
  public child(settings?: ISettingsParam<LogObj>, logObj?: LogObj): Logger<LogObj> {
    return super.getSubLogger(settings, logObj) as Logger<LogObj>;
  }

  /**
   * Build a {@link Logger} from environment variables (E3): `TSLOG_LEVEL` → `minLevel`, `TSLOG_TYPE` →
   * `type`, `TSLOG_NAME` → `name` (plus `NO_COLOR`/`FORCE_COLOR`, already honored at normalize time). The
   * `overrides` are shallow-merged on top of the env-derived settings and win on any collision. In a browser
   * without a `process.env` bag this simply yields the `overrides` (env reads degrade to empty).
   *
   * @example Logger.fromEnv({ name: "ui" })
   */
  public static fromEnv<LogObj = ILogObj>(overrides?: ISettingsParam<LogObj>): Logger<LogObj> {
    return new Logger<LogObj>(settingsFromEnv(overrides));
  }
}

/**
 * A ready-to-use default logger instance — pretty everywhere by default (colored on a TTY, uncolored when piped); JSON is opt-in (M3.2).
 * Import and log without any setup.
 * For structured logs, masking, or custom settings, create your own `new Logger({ ... })` instead.
 *
 * @example
 * import { log } from "tslog";
 * log.info("hello");
 */
/**
 * Construct a {@link Logger} whose `customLevels` are visible as typed methods:
 *
 * @example
 * const log = createLogger({ type: "json", customLevels: { AUDIT: 7 } });
 * log.audit("permission granted", { userId: 42 }); // fully typed
 *
 * Notes: generic inference absorbs excess/typo'd settings keys at the TYPE level (the runtime
 * validator still reports them, and throws under `strictConfig`); and passing an explicit `LogObj`
 * type argument disables the settings inference (TypeScript has no partial inference) — in that case
 * register levels via `addLevel(...)`, which types its method on the return value.
 */
export function createLogger<LogObj = ILogObj, const S extends ISettingsParam<LogObj> = ISettingsParam<LogObj>>(
  settings?: S,
  logObj?: LogObj,
): Logger<LogObj> & TCustomLevelMethods<S, LogObj> {
  return new Logger<LogObj>(settings, logObj) as Logger<LogObj> & TCustomLevelMethods<S, LogObj>;
}

export const log: Logger<ILogObj> = /* @__PURE__ */ new Logger<ILogObj>();
