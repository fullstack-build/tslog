import type { ISettingsParam, TLogLevel } from "../interfaces.js";
import { safeEnvGet } from "../internal/environment.js";

/**
 * Build an {@link ISettingsParam} from the environment (E3): reads `TSLOG_LEVEL` → `minLevel`,
 * `TSLOG_TYPE` → `type` (only the three valid values are accepted; anything else is ignored), and
 * `TSLOG_NAME` → `name`. `NO_COLOR`/`FORCE_COLOR` are already honored downstream by `normalizeSettings`.
 * The returned object is then shallow-merged under caller `overrides` by {@link Logger.fromEnv}.
 *
 * Exported so the per-entry `Logger.fromEnv` statics share one env-reading implementation.
 */
export function settingsFromEnv<LogObj>(overrides?: ISettingsParam<LogObj>): ISettingsParam<LogObj> {
  const fromEnv: ISettingsParam<LogObj> = {};

  // Each read is individually guarded (safeEnvGet): on Deno the permission check fires per property
  // GET, so an unguarded read would throw NotCapable without --allow-env.
  const level = safeEnvGet("TSLOG_LEVEL");
  if (level != null && level !== "") {
    // A numeric string becomes a numeric id; otherwise it's a level name resolved by normalizeSettings.
    const numeric = Number(level);
    fromEnv.minLevel = (Number.isNaN(numeric) ? level : numeric) as TLogLevel;
  }

  const type = safeEnvGet("TSLOG_TYPE");
  if (type === "json" || type === "pretty" || type === "hidden") {
    fromEnv.type = type;
  }

  const name = safeEnvGet("TSLOG_NAME");
  if (name != null && name !== "") {
    fromEnv.name = name;
  }

  // Caller overrides win over env-derived settings.
  return { ...fromEnv, ...overrides };
}
