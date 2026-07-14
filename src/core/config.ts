import type { ISettingsParam } from "../interfaces.js";

/**
 * A typed configuration error (E6). Thrown by {@link import("./settings.js").validateSettingsParam} for a
 * hard misconfiguration when the opt-in `strictConfig: true` setting is set (default `false` keeps the
 * warn-only behavior). Carries a stable {@link code}, the offending {@link setting} path, and a
 * human-readable {@link suggestion} so editors/agents and `catch` blocks can act on it programmatically.
 *
 * @example
 * try {
 *   new Logger({ strictConfig: true, minLevel: "LOUD" as never });
 * } catch (e) {
 *   if (e instanceof TslogConfigError) console.error(e.code, e.setting, e.suggestion);
 * }
 */
export class TslogConfigError extends Error {
  /** Stable machine-readable error code (e.g. `"UNKNOWN_MIN_LEVEL"`). */
  public readonly code: string;
  /** The dotted settings path that triggered the error (e.g. `"minLevel"` or `"pretty.template"`). */
  public readonly setting: string;
  /** A short, actionable hint describing how to fix the configuration. */
  public readonly suggestion: string;

  constructor(args: { code: string; setting: string; message: string; suggestion: string }) {
    super(`tslog: ${args.message}`);
    this.name = "TslogConfigError";
    this.code = args.code;
    this.setting = args.setting;
    this.suggestion = args.suggestion;
    // Restore the prototype chain so `instanceof TslogConfigError` holds when targeting older runtimes.
    Object.setPrototypeOf(this, TslogConfigError.prototype);
  }
}

/**
 * Identity helper (E5) for authoring a tslog settings object with full editor/agent autocomplete and
 * type-checking on the grouped settings shape. Returns its input unchanged — it exists purely so a
 * standalone config object is checked against {@link ISettingsParam} at its definition site.
 *
 * @example
 * import { defineConfig } from "tslog";
 * export const logConfig = defineConfig({ type: "json", minLevel: "INFO", mask: { keys: ["password"] } });
 * const logger = new Logger(logConfig);
 *
 * @typeParam LogObj - Shape of your structured log object; inferred from the settings when omitted.
 */
export function defineConfig<LogObj = unknown>(settings: ISettingsParam<LogObj>): ISettingsParam<LogObj> {
  return settings;
}
