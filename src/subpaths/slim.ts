import { BaseLogger } from "../BaseLogger.js";
import { TslogConfigError } from "../core/config.js";
import type { CoreFeatures } from "../core/features.js";
import type { EnvironmentProvider } from "../env/environment.js";
import { createSlimEnvironment } from "../env/environment.slim.js";
import type { ILogObj, ILogObjMeta, ISettingsParam, TCustomLevelMethods } from "../interfaces.js";
import { renderJsonUnplanned } from "../render/json.js";

/**
 * `tslog/slim` — the smallest structured-JSON build of tslog (S1).
 *
 * The SAME `Logger` pipeline as the main entries — levels, sub-loggers with merged settings, bindings,
 * custom levels, middleware, async-context correlation, transports with per-transport `minLevel`, flat
 * fields-first JSON with `_meta` — minus the subsystems a size-critical browser/edge bundle rarely
 * wants. What the main entries include and slim deliberately does NOT:
 *
 *  - **masking** — `mask` settings THROW a {@link TslogConfigError} here instead of being silently
 *    ignored (a logger that drops your redaction config is a security incident, not a size win);
 *  - **pretty output** — `type: "pretty"` (and `pretty.enabled: true`) throw; the default `type` is
 *    `"json"` (not env-aware);
 *  - **stack capture / trace parsing** — `_meta.path` is never attached; logged Errors keep
 *    name/message/cause with an empty `stack` array;
 *  - **settings validation** — no unknown-key / did-you-mean diagnostics (develop against the full
 *    entry, ship slim);
 *  - **`Logger.fromEnv`** and the precompiled JSON line plan (output stays byte-identical — slim uses
 *    the plan-free renderer the differential suite pins against the planned one).
 *
 * For a console-passthrough logger that keeps native devtools line numbers, see `tslog/lite` instead —
 * slim is a real structured logger, lite is a console wrapper.
 *
 * @example
 * import { Logger } from "tslog/slim";
 * const log = new Logger({ name: "edge", bindings: { service: "checkout" } });
 * log.info("hello", { requestId: "r-1" });
 */

/** Reject the settings that name subsystems this entry does not ship. Runs BEFORE normalization. */
function validateSlimSettings<LogObj>(settings: ISettingsParam<LogObj> | undefined): void {
  /* v8 ignore next 3 -- unreachable via the slim entry: the constructor always runs settings through withJsonTypeDefault (which turns null into { type: "json" }) before validation, and sub-loggers pass a fully-built settings object; the guard only satisfies the CoreFeatures.validateSettings(undefined) contract. */
  if (settings == null) {
    return;
  }
  // Only ACTIVE masking config counts: sub-loggers re-validate the parent's RESOLVED settings, whose
  // mask group always carries inert defaults (placeholder/caseInsensitive/empty arrays).
  const maskGroup = settings.mask;
  const masksSomething =
    maskGroup != null &&
    ((maskGroup.keys?.length ?? 0) > 0 || (maskGroup.regex?.length ?? 0) > 0 || (maskGroup.paths?.length ?? 0) > 0 || maskGroup.censor != null);
  if (masksSomething) {
    throw new TslogConfigError({
      code: "SLIM_NO_MASKING",
      setting: "mask",
      message: "tslog/slim does not include the masking engine, so these mask settings would be silently ignored and secrets would be logged in plaintext.",
      suggestion: 'Import the full logger (`import { Logger } from "tslog"`) where masking is required, or remove the mask settings.',
    });
  }
  if (settings.type === "pretty" || settings.pretty?.enabled === true) {
    throw new TslogConfigError({
      code: "SLIM_NO_PRETTY",
      setting: "type",
      message: 'tslog/slim does not include the pretty renderer; use type "json" (the slim default) or "hidden".',
      suggestion: 'Import the full logger (`import { Logger } from "tslog"`) for pretty output.',
    });
  }
}

/**
 * Default `type` to `"json"` WITHOUT a spread: a spread would drop prototype-held getters and
 * non-enumerable own properties (e.g. a class-based config whose `mask` lives on the prototype) before
 * validation ever saw them — silently bypassing the SLIM_NO_MASKING throw. A descriptor-faithful clone
 * keeps every property observable exactly as on the original.
 */
function withJsonTypeDefault<LogObj>(settings: ISettingsParam<LogObj> | undefined): ISettingsParam<LogObj> {
  if (settings == null) {
    return { type: "json" };
  }
  if (settings.type != null) {
    return settings;
  }
  const clone = Object.create(Object.getPrototypeOf(settings), Object.getOwnPropertyDescriptors(settings)) as ISettingsParam<LogObj>;
  Object.defineProperty(clone, "type", { value: "json", enumerable: true, writable: true, configurable: true });
  return clone;
}

const slimFeatures: CoreFeatures = {
  renderJson: renderJsonUnplanned,
  validateSettings: validateSlimSettings,
};

let slimEnvironment: EnvironmentProvider | undefined;

/** Memoized provider (created on first Logger construction, never at module scope — `sideEffects: false`). */
function getSlimEnvironment(): EnvironmentProvider {
  if (slimEnvironment === undefined) {
    slimEnvironment = createSlimEnvironment();
  }
  return slimEnvironment;
}

/**
 * The slim `Logger`: identical call surface to the main entries (level methods, `getSubLogger`/`child`,
 * `runInContext`, `attachTransport`, `addLevel`, …), JSON output only. The default `type` is `"json"`
 * (slim skips the env-aware TTY detection); `"hidden"` is available for tests.
 */
export class Logger<LogObj> extends BaseLogger<LogObj> {
  constructor(settings?: ISettingsParam<LogObj>, logObj?: LogObj) {
    super(withJsonTypeDefault(settings), logObj, getSlimEnvironment(), Number.NaN, slimFeatures);
    // The full masking engine reads `settings.mask` LIVE on every call; slim's identity masking never
    // consults it, so a post-construction `logger.settings.mask.keys.push("password")` would be
    // SILENTLY ignored — exactly the plaintext incident the construction-time throw exists to prevent.
    // Freeze the resolved mask group so such a mutation throws loudly (ESM is strict mode) instead.
    Object.freeze(this.settings.mask.keys);
    Object.freeze(this.settings.mask.regex);
    Object.freeze(this.settings.mask.paths);
    Object.freeze(this.settings.mask);
    // ... and pin the group slot itself so `logger.settings.mask = {...}` cannot swap the frozen group.
    Object.defineProperty(this.settings, "mask", { writable: false, configurable: false });
  }

  public getSubLogger(settings?: ISettingsParam<LogObj>, logObj?: LogObj): Logger<LogObj> {
    return super.getSubLogger(settings, logObj) as Logger<LogObj>;
  }

  public child(settings?: ISettingsParam<LogObj>, logObj?: LogObj): Logger<LogObj> {
    return super.getSubLogger(settings, logObj) as Logger<LogObj>;
  }

  public log(logLevelId: number, logLevelName: string, ...args: unknown[]): (LogObj & ILogObjMeta & ILogObj) | undefined {
    return super.log(logLevelId, logLevelName, ...args);
  }

  public silly(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public silly(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public silly(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(0, "SILLY", ...args);
  }

  public trace(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public trace(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public trace(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(1, "TRACE", ...args);
  }

  public debug(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public debug(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public debug(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(2, "DEBUG", ...args);
  }

  public info(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public info(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public info(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(3, "INFO", ...args);
  }

  public warn(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public warn(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public warn(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(4, "WARN", ...args);
  }

  public error(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public error(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public error(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(5, "ERROR", ...args);
  }

  public fatal(fields: object, message?: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public fatal(message: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined;
  public fatal(...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    return super.log(6, "FATAL", ...args);
  }
}

/**
 * Construct a slim {@link Logger} whose `customLevels` are visible as typed methods — same typing rules
 * (and caveats) as the main entries' `createLogger`.
 */
export function createLogger<LogObj = ILogObj, const S extends ISettingsParam<LogObj> = ISettingsParam<LogObj>>(
  settings?: S,
  logObj?: LogObj,
): Logger<LogObj> & TCustomLevelMethods<S, LogObj> {
  return new Logger<LogObj>(settings, logObj) as Logger<LogObj> & TCustomLevelMethods<S, LogObj>;
}
