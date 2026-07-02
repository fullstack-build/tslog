import type { TLogLevel } from "../interfaces.js";
import { LogLevel } from "../interfaces.js";

/**
 * Canonical default level table: id -> name. The seven names are stable across v5; additive custom
 * levels (M2.14) extend this map per-logger rather than mutating it.
 */
export const DEFAULT_LOG_LEVEL_NAMES: Readonly<Record<number, string>> = Object.freeze({
  0: "SILLY",
  1: "TRACE",
  2: "DEBUG",
  3: "INFO",
  4: "WARN",
  5: "ERROR",
  6: "FATAL",
});

/** Reverse lookup name -> id, used to resolve a string `minLevel` like "WARN". */
const NAME_TO_ID: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.entries(DEFAULT_LOG_LEVEL_NAMES).map(([id, name]) => [name, Number(id)])),
);

/**
 * Resolve a {@link TLogLevel} (number, {@link LogLevel} enum, or a level name like "WARN")
 * to its numeric id. Returns `undefined` for unknown names so the caller can apply its own default.
 *
 * @param customLevels - optional additive name→id map (M2.14) consulted, case-insensitively, before the
 *   default table so a string `minLevel` referring to a custom level resolves correctly.
 */
export function resolveLogLevelId(level: TLogLevel | undefined, customLevels?: Record<string, number>): number | undefined {
  if (level == null) {
    return undefined;
  }
  if (typeof level === "number") {
    return level;
  }
  // Additive custom levels win when present (so e.g. minLevel: "NOTICE" resolves), looked up by exact
  // then upper-cased name so callers may use either casing for their custom level names.
  if (customLevels != null) {
    const fromCustom = customLevels[level] ?? customLevels[level.toUpperCase()];
    if (typeof fromCustom === "number") {
      return fromCustom;
    }
  }
  // Prefer the explicit name table, then fall back to the enum (kept for source compatibility).
  const fromTable = NAME_TO_ID[level] ?? NAME_TO_ID[level.toUpperCase()];
  if (typeof fromTable === "number") {
    return fromTable;
  }
  const fromEnum = (LogLevel as unknown as Record<string, number>)[level.toUpperCase()];
  return typeof fromEnum === "number" ? fromEnum : undefined;
}

/**
 * Validate an additive custom level (M2.14): the name must be a non-empty string that does not collide
 * (case-insensitively) with one of the canonical seven, and the id must be a finite number (fractional ids
 * such as `3.5` are allowed so a level can slot between two defaults). Throws a `RangeError`/`TypeError` on
 * violation so misconfiguration fails fast at `addLevel`/normalize time.
 */
export function validateCustomLevel(name: string, id: number): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError(`tslog: custom level name must be a non-empty string (got ${JSON.stringify(name)}).`);
  }
  if (typeof id !== "number" || !Number.isFinite(id)) {
    throw new TypeError(`tslog: custom level id for "${name}" must be a finite number (got ${JSON.stringify(id)}).`);
  }
  if (NAME_TO_ID[name.toUpperCase()] != null) {
    throw new RangeError(`tslog: custom level "${name}" collides with a canonical level name; the seven default names are reserved.`);
  }
}

/** Resolve a numeric id back to its canonical name, or `undefined` if it is not a default level. */
export function logLevelName(id: number): string | undefined {
  return DEFAULT_LOG_LEVEL_NAMES[id];
}
