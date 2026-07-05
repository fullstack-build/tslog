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
  // Additive custom levels win when present (so e.g. minLevel: "NOTICE" resolves). Lookup is fully
  // case-insensitive — a level registered as `{ audit: 8 }` must resolve from "AUDIT" and vice versa,
  // exactly like the seven default names (the fast exact/upper probes cover the common casings).
  if (customLevels != null) {
    const fromCustom = customLevels[level] ?? customLevels[level.toUpperCase()];
    if (typeof fromCustom === "number") {
      return fromCustom;
    }
    const lowered = level.toLowerCase();
    for (const key of Object.keys(customLevels)) {
      if (key.toLowerCase() === lowered && typeof customLevels[key] === "number") {
        return customLevels[key];
      }
    }
  }
  // Prefer the explicit name table, then fall back to the enum (kept for source compatibility).
  const fromTable = NAME_TO_ID[level] ?? NAME_TO_ID[level.toUpperCase()];
  if (typeof fromTable === "number") {
    return fromTable;
  }
  const fromEnum = (LogLevel as unknown as Record<string, number>)[level.toUpperCase()];
  /* v8 ignore next -- the LogLevel enum's string keys are identical to NAME_TO_ID's, so if the table miss above fell through, the enum misses too; `fromEnum` is always undefined here and the `? fromEnum` branch is unreachable */
  return typeof fromEnum === "number" ? fromEnum : undefined;
}

/**
 * Validate an additive custom level (M2.14): the name must be a non-empty string that does not collide
 * (case-insensitively) with one of the canonical seven, and the id must be a finite number (fractional ids
 * such as `3.5` are allowed so a level can slot between two defaults). Throws a `RangeError`/`TypeError` on
 * violation so misconfiguration fails fast at `addLevel`/normalize time.
 */
/**
 * Lower-cased logger members a custom level method could otherwise clobber. Mixed-case members
 * (`getSubLogger`, `attachTransport`, …) cannot collide because installed method names are always
 * lower-cased; this list covers the members that ARE all-lowercase.
 */
const RESERVED_MEMBER_NAMES = new Set(["log", "child", "settings", "runtime", "flush", "use"]);

export function validateCustomLevel(name: string, id: number, existing?: Record<string, number>): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError(`tslog: custom level name must be a non-empty string (got ${JSON.stringify(name)}).`);
  }
  if (typeof id !== "number" || !Number.isFinite(id)) {
    throw new TypeError(`tslog: custom level id for "${name}" must be a finite number (got ${JSON.stringify(id)}).`);
  }
  if (NAME_TO_ID[name.toUpperCase()] != null) {
    throw new RangeError(`tslog: custom level "${name}" collides with a canonical level name; the seven default names are reserved.`);
  }
  const lowered = name.toLowerCase();
  if (RESERVED_MEMBER_NAMES.has(lowered)) {
    // Throwing keeps the TYPE surface honest: TCustomLevelMethods/addLevel would advertise a method
    // that could never be installed, and a call would silently route into the generic log().
    throw new RangeError(`tslog: custom level "${name}" collides with the logger member "${lowered}"; pick a different name.`);
  }
  if (existing != null) {
    for (const key of Object.keys(existing)) {
      if (key !== name && key.toLowerCase() === lowered) {
        throw new RangeError(`tslog: custom level "${name}" differs only by case from the already-registered "${key}"; level names are case-insensitive.`);
      }
    }
  }
}

/** Resolve a numeric id back to its canonical name, or `undefined` if it is not a default level. */
export function logLevelName(id: number): string | undefined {
  return DEFAULT_LOG_LEVEL_NAMES[id];
}
