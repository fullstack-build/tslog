import type { ISettings, ISettingsParam } from "../interfaces.js";
import { forceColorRequested, noColorRequested, resolveDefaultType, safeEnvGet } from "../internal/environment.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";
import { TslogConfigError } from "./config.js";
import { resolveLogLevelId, validateCustomLevel } from "./levels.js";
import { normalizeTransport } from "./transports.js";

// Re-export the canonical level resolver so callers can pull it from the settings module
// without redefining it (it lives in ./levels.js as the single source of truth).
export { resolveLogLevelId };

/** Valid values for the `stack.capture` setting. */
export type TStackCapture = "off" | "lazy" | "auto" | "full";

/**
 * Pretty-log template placeholders recognized by tslog. Used to warn (in development only) about
 * likely typos such as `{{loglevelname}}` instead of `{{logLevelName}}`.
 */
export const KNOWN_PRETTY_PLACEHOLDERS = new Set([
  "yyyy",
  "mm",
  "dd",
  "hh",
  "MM",
  "ss",
  "ms",
  "dateIsoStr",
  "rawIsoStr",
  "logLevelName",
  "name",
  "nameWithDelimiterPrefix",
  "nameWithDelimiterSuffix",
  "fullFilePath",
  "filePathWithLine",
  "fileNameWithLine",
  "fileName",
  "filePath",
  "fileLine",
  "fileColumn",
]);

/** Every key accepted at the top level of {@link ISettingsParam}. Drives the unknown-key check. */
const KNOWN_TOP_LEVEL_KEYS = new Set([
  "type",
  "name",
  "parentNames",
  "minLevel",
  "argumentsArrayName",
  "persistLevel",
  "persistLevelKey",
  "pretty",
  "json",
  "mask",
  "stack",
  "meta",
  "prefix",
  "attachedTransports",
  "middleware",
  "customLevels",
  "bindings",
  "strictConfig",
  "contextStorage",
  "clock",
]);

/** The keys accepted inside each settings group. Drives the unknown-key check for nested typos. */
const KNOWN_GROUP_KEYS: Record<string, Set<string>> = {
  pretty: new Set([
    "enabled",
    "template",
    "errorTemplate",
    "errorStackTemplate",
    "errorParentNamesSeparator",
    "errorLoggerNameDelimiter",
    "style",
    "timeZone",
    "styles",
    "levelMethod",
    "inspectOptions",
  ]),
  json: new Set(["messageKey", "levelKey", "levelIdKey", "timeKey", "time", "errorKey", "numericLevel", "stableKeyOrder"]),
  mask: new Set(["keys", "caseInsensitive", "regex", "placeholder", "paths", "censor", "hashLabel"]),
  stack: new Set(["capture", "internalFramePatterns"]),
  meta: new Set(["property", "attachContext"]),
};

/**
 * v4 flat settings keys mapped to their v5 home, so a config carried over from v4 gets a precise
 * migration hint instead of being silently ignored (which for `maskValuesOfKeys` would mean logging
 * secrets in plaintext). Mirrors the mapping table in MIGRATION_v4_to_v5.md.
 */
const V4_KEY_MIGRATIONS: Record<string, string> = {
  prettyLogTemplate: "pretty.template",
  prettyErrorTemplate: "pretty.errorTemplate",
  prettyErrorStackTemplate: "pretty.errorStackTemplate",
  prettyErrorParentNamesSeparator: "pretty.errorParentNamesSeparator",
  prettyErrorLoggerNameDelimiter: "pretty.errorLoggerNameDelimiter",
  stylePrettyLogs: "pretty.style",
  prettyLogTimeZone: "pretty.timeZone",
  prettyLogStyles: "pretty.styles",
  prettyInspectOptions: "pretty.inspectOptions",
  maskValuesOfKeys: "mask.keys",
  maskValuesOfKeysCaseInsensitive: "mask.caseInsensitive",
  maskValuesRegEx: "mask.regex",
  maskPlaceholder: "mask.placeholder",
  metaProperty: "meta.property",
  internalFramePatterns: "stack.internalFramePatterns",
  prettyLogLevelMethod: "pretty.levelMethod",
  hideLogPositionForProduction: 'stack.capture ("off" hides positions)',
  overwrite: "middleware / logger.use()",
  stackDepthLevel: "the callerFrame constructor argument",
};

/**
 * Bounded Levenshtein distance for did-you-mean suggestions. Bails out early once the distance
 * exceeds `max`, so comparing a typo against every known key stays cheap.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) {
        rowMin = current[j];
      }
    }
    if (rowMin > max) {
      return max + 1;
    }
    previous = current;
  }
  return previous[b.length];
}

/** The closest known key within a small edit distance, or `undefined` when nothing is plausibly meant. */
function nearestKey(key: string, known: Iterable<string>): string | undefined {
  const lowered = key.toLowerCase();
  const max = key.length <= 4 ? 1 : 2;
  let best: string | undefined;
  let bestDistance = max + 1;
  for (const candidate of known) {
    // A pure casing mistake ("Mask", "minlevel") is always the intended key.
    if (candidate.toLowerCase() === lowered) {
      return candidate;
    }
    const distance = editDistance(key, candidate, max);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Whether to emit developer diagnostics. Off in production and when explicitly disabled via TSLOG_DISABLE_WARNINGS. */
export function devWarningsEnabled(): boolean {
  // Guarded per-property reads: Deno's process.env proxy throws NotCapable per GET without --allow-env.
  if (safeEnvGet("TSLOG_DISABLE_WARNINGS") != null) {
    return false;
  }
  return safeEnvGet("NODE_ENV") !== "production";
}

// Malformed contextStorage instances already reported once — getSubLogger re-validates the parent's
// resolved settings on every child construction, and one root typo must not warn per descendant.
const reportedContextStorages = new WeakSet<object>();

// Callers gate on devWarningsEnabled() before building a message, so this only emits.
export function emitConfigWarning(message: string): void {
  try {
    nativeConsoleMethod("warn")(`tslog: ${message}`);
  } catch {
    // never let a diagnostic crash logging
  }
}

/**
 * Validate user-provided settings (E6). By default this is a best-effort developer aid: it warns (in
 * development only) about likely mistakes, never throws, and never changes behavior. When the opt-in
 * `strictConfig: true` setting is set, the same hard misconfigurations instead throw a typed
 * {@link TslogConfigError} (with a `code`, `setting`, and `suggestion`) — regardless of `NODE_ENV`, so a
 * strict config fails fast in production too. The out-of-range placeholder/minLevel checks are unchanged.
 */
export function validateSettingsParam<LogObj>(settings: ISettingsParam<LogObj> | undefined): void {
  if (settings == null) {
    return;
  }
  const strict = settings.strictConfig === true;
  // Skip the whole pass when neither strict-mode is on nor dev warnings are enabled (production default).
  if (!strict && !devWarningsEnabled()) {
    return;
  }

  // In strict mode a hard error throws the typed TslogConfigError; otherwise it emits a dev warning.
  const report = (issue: { code: string; setting: string; message: string; suggestion: string }): void => {
    if (strict) {
      throw new TslogConfigError(issue);
    }
    emitConfigWarning(issue.message);
  };

  // Out-of-range / unknown minLevel. Custom levels (M2.14) are valid minLevel targets, so consult them.
  if (settings.minLevel != null) {
    const resolved = resolveLogLevelId(settings.minLevel, settings.customLevels);
    if (resolved == null) {
      report({
        code: "UNKNOWN_MIN_LEVEL",
        setting: "minLevel",
        message: `unknown minLevel ${JSON.stringify(settings.minLevel)}; expected a number 0-6 or a level name like "WARN".`,
        suggestion: 'Use a number 0-6, a LogLevel enum value, or a level name like "WARN" — or register it via customLevels.',
      });
    } else if (typeof settings.minLevel === "number" && (resolved < 0 || resolved > 6)) {
      report({
        code: "MIN_LEVEL_OUT_OF_RANGE",
        setting: "minLevel",
        message: `minLevel ${resolved} is outside the default range 0-6; no default log method will be filtered as you might expect.`,
        suggestion: "Set minLevel to a number between 0 (SILLY) and 6 (FATAL), or register a customLevel for the out-of-range id.",
      });
    }
  }

  // A malformed contextStorage would otherwise degrade to the no-op store and only surface as the
  // (easily missed) runInContext warning — flag the shape mismatch at construction, where the typo is.
  // Guarded reads (a throwing accessor counts as malformed), and each bad instance is reported once per
  // process: sub-loggers re-validate the parent's resolved settings, which would re-warn per child.
  try {
    const storage = settings.contextStorage as { run?: unknown; getStore?: unknown } | null | undefined;
    if (storage != null) {
      let malformed = false;
      try {
        malformed = typeof storage.run !== "function" || typeof storage.getStore !== "function";
      } catch {
        malformed = true;
      }
      if (malformed && (strict || !reportedContextStorages.has(storage as object))) {
        try {
          reportedContextStorages.add(storage as object);
        } catch {
          // primitives can't be WeakSet'd — still report, just without dedup
        }
        report({
          code: "INVALID_CONTEXT_STORAGE",
          setting: "contextStorage",
          message: "contextStorage does not look like an AsyncLocalStorage instance (needs run() and getStore()); runInContext will not propagate context.",
          suggestion: 'Pass an INSTANCE, e.g. `contextStorage: new AsyncLocalStorage()` from "node:async_hooks" — not the class itself.',
        });
      }
    }
  } catch (error) {
    // reading settings.contextStorage itself threw — hostile settings object; strict mode still throws
    if (error instanceof TslogConfigError) {
      throw error;
    }
  }

  // A clock that is not a function silently degrades to the runtime date; flag the typo at construction.
  try {
    if (settings.clock != null && typeof settings.clock !== "function") {
      report({
        code: "INVALID_CLOCK",
        setting: "clock",
        message: "clock must be a function returning a Date (e.g. `clock: () => new Date()`); it will be ignored.",
        suggestion: "Pass a zero-argument function returning a valid Date.",
      });
    }
    const time = settings.json?.time;
    if (time != null && time !== false && time !== "iso" && time !== "epoch" && typeof time !== "function") {
      report({
        code: "INVALID_JSON_TIME",
        setting: "json.time",
        message: `unknown json.time value ${JSON.stringify(time)}; expected "iso", "epoch", false, or a (date) => string | number function.`,
        suggestion: 'Use json.time: "iso" | "epoch" | false | ((date) => string | number).',
      });
    }
  } catch (error) {
    // hostile settings getters — strict mode still throws its typed error
    if (error instanceof TslogConfigError) {
      throw error;
    }
  }

  // Unknown / relocated settings keys — the #1 hazard of the grouped-settings migration. A stale v4
  // flat key (`maskValuesOfKeys`), a typo'd group (`masks:`), or a typo inside a group
  // (`json: { messagKey }`) would otherwise be silently ignored; for masking that means secrets
  // logged in plaintext. TypeScript catches literal typos at compile time, but JS callers,
  // spread/merged configs, and JSON-loaded configs only have this check.
  // Enumeration is guarded: a hostile Proxy (throwing ownKeys trap) must not crash construction in
  // warn-only mode. `report` still throws for strictConfig — only the key ENUMERATION is defensive.
  let topLevelKeys: string[] = [];
  try {
    topLevelKeys = Object.keys(settings);
  } catch {
    // unreadable settings object — skip the key checks, the resolved defaults still apply
  }
  for (const key of topLevelKeys) {
    if (KNOWN_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }
    // hasOwn guard: keys named after Object.prototype members ("constructor", "toString") must not
    // resolve prototype methods as migration hints.
    const migrated = Object.hasOwn(V4_KEY_MIGRATIONS, key) ? V4_KEY_MIGRATIONS[key] : undefined;
    if (migrated != null) {
      report({
        code: "V4_FLAT_KEY",
        setting: key,
        message: `"${key}" was removed in v5 — use ${migrated} instead (see MIGRATION_v4_to_v5.md).`,
        suggestion: `Move "${key}" to ${migrated}.`,
      });
      continue;
    }
    const closest = nearestKey(key, KNOWN_TOP_LEVEL_KEYS);
    report({
      code: "UNKNOWN_SETTING",
      setting: key,
      message: `unknown setting "${key}"${closest != null ? ` — did you mean "${closest}"?` : ""}`,
      suggestion: closest != null ? `Rename "${key}" to "${closest}".` : `Remove "${key}" — it is not a tslog setting.`,
    });
  }
  for (const [group, knownKeys] of Object.entries(KNOWN_GROUP_KEYS)) {
    let groupValue: unknown;
    try {
      groupValue = (settings as unknown as Record<string, unknown>)[group];
    } catch {
      continue;
    }
    if (groupValue == null || typeof groupValue !== "object" || Array.isArray(groupValue)) {
      continue;
    }
    let groupKeys: string[] = [];
    try {
      groupKeys = Object.keys(groupValue);
    } catch {
      continue;
    }
    for (const key of groupKeys) {
      if (knownKeys.has(key)) {
        continue;
      }
      const closest = nearestKey(key, knownKeys);
      report({
        code: "UNKNOWN_SETTING",
        setting: `${group}.${key}`,
        message: `unknown setting "${group}.${key}"${closest != null ? ` — did you mean "${group}.${closest}"?` : ""}`,
        suggestion: closest != null ? `Rename "${group}.${key}" to "${group}.${closest}".` : `Remove "${group}.${key}" — it is not a tslog setting.`,
      });
    }
  }

  // Unknown template placeholders (typos like {{loglevelname}}).
  const template = settings.pretty?.template;
  if (typeof template === "string") {
    const placeholderRegex = /{{\s*(.+?)\s*}}/g;
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
    while ((match = placeholderRegex.exec(template)) != null) {
      const key = match[1];
      if (!KNOWN_PRETTY_PLACEHOLDERS.has(key)) {
        report({
          code: "UNKNOWN_PRETTY_PLACEHOLDER",
          setting: "pretty.template",
          message: `pretty.template references unknown placeholder "{{${key}}}"; check the spelling (e.g. "{{logLevelName}}").`,
          suggestion: `Remove or fix "{{${key}}}" — see the recognized placeholders (e.g. "{{logLevelName}}", "{{filePathWithLine}}").`,
        });
      }
    }
  }
}

/**
 * Resolve the effective {@link TStackCapture} mode from the (possibly partial) user settings.
 *
 * Precedence:
 * 1. An explicit `stack.capture` value wins.
 * 2. Otherwise default by output type: `"json"` -> `"off"`, everything else (pretty/hidden) -> `"auto"`.
 */
function resolveStackCapture<LogObj>(settings: ISettingsParam<LogObj> | undefined, type: ISettings<LogObj>["type"]): TStackCapture {
  if (settings?.stack?.capture != null) {
    return settings.stack.capture;
  }
  return type === "json" ? "off" : "auto";
}

/**
 * Resolve the effective output `type` (M3.2). An explicit `type` always wins. Otherwise, when
 * `pretty.enabled` is set it decides (`true` -> "pretty", `false` -> "json"); when it is unset the
 * type is resolved from the environment (interactive non-CI TTY -> "pretty", else "json"; browser,
 * worker, and React Native -> "pretty"; NO_COLOR only strips styling, never switches the format).
 */
function resolveType<LogObj>(settings: ISettingsParam<LogObj> | undefined): "json" | "pretty" | "hidden" {
  if (settings?.type != null) {
    return settings.type;
  }
  if (settings?.pretty?.enabled != null) {
    return settings.pretty.enabled ? "pretty" : "json";
  }
  return resolveDefaultType();
}

/**
 * Resolve pretty styling. Precedence: an EXPLICIT `pretty.style` wins (per no-color.org, a user's
 * deliberate configuration outranks the env hints — this is also what lets the CLI's --color/--no-color
 * flags work under a conflicting NO_COLOR/FORCE_COLOR), then `FORCE_COLOR` forces styling on, then
 * `NO_COLOR` forces it off, then the default `true`.
 */
function resolveStyle<LogObj>(settings: ISettingsParam<LogObj> | undefined): boolean {
  if (settings?.pretty?.style != null) {
    return settings.pretty.style;
  }
  if (forceColorRequested()) {
    return true;
  }
  if (noColorRequested()) {
    return false;
  }
  return true;
}

/**
 * Normalize a partial {@link ISettingsParam} into a fully populated {@link ISettings} with every default applied.
 *
 * This owns the defaults block previously inlined in the `BaseLogger` constructor: it resolves the
 * environment-aware `type` (M3.2), `minLevel`, derives `stack.capture`, clones array/object inputs so
 * callers cannot mutate the logger's settings by reference, and fills in every pretty/json/mask/stack/meta
 * default under the grouped resolved shape.
 */
export function normalizeSettings<LogObj>(settings?: ISettingsParam<LogObj>): ISettings<LogObj> {
  const type = resolveType(settings);
  const stackCapture = resolveStackCapture(settings, type);

  // Resolve additive custom levels first (M2.14): validate each, then make the map available so a string
  // `minLevel` referring to a custom level (e.g. "NOTICE") resolves correctly below.
  const customLevels: Record<string, number> = {};
  if (settings?.customLevels != null) {
    for (const [name, id] of Object.entries(settings.customLevels)) {
      validateCustomLevel(name, id, customLevels);
      customLevels[name] = id;
    }
  }

  return {
    type,
    name: settings?.name,
    parentNames: settings?.parentNames,
    minLevel: resolveLogLevelId(settings?.minLevel, customLevels) ?? 0,
    argumentsArrayName: settings?.argumentsArrayName,
    // M4.6: opt-in browser log-level persistence flags pass through unchanged (default off).
    persistLevel: settings?.persistLevel,
    persistLevelKey: settings?.persistLevelKey,
    pretty: {
      template:
        settings?.pretty?.template ?? "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t{{filePathWithLine}}{{nameWithDelimiterPrefix}}\t",
      errorTemplate: settings?.pretty?.errorTemplate ?? "\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}",
      errorStackTemplate: settings?.pretty?.errorStackTemplate ?? "  • {{fileName}}\t{{method}}\n\t{{filePathWithLine}}",
      errorParentNamesSeparator: settings?.pretty?.errorParentNamesSeparator ?? ":",
      errorLoggerNameDelimiter: settings?.pretty?.errorLoggerNameDelimiter ?? "\t",
      style: resolveStyle(settings),
      timeZone: settings?.pretty?.timeZone ?? "UTC",
      styles: settings?.pretty?.styles ?? {
        logLevelName: {
          "*": ["bold", "black", "bgWhiteBright", "dim"],
          SILLY: ["bold", "white"],
          TRACE: ["bold", "whiteBright"],
          DEBUG: ["bold", "green"],
          INFO: ["bold", "blue"],
          WARN: ["bold", "yellow"],
          ERROR: ["bold", "red"],
          FATAL: ["bold", "redBright"],
        },
        dateIsoStr: "white",
        filePathWithLine: "white",
        name: ["white", "bold"],
        nameWithDelimiterPrefix: ["white", "bold"],
        nameWithDelimiterSuffix: ["white", "bold"],
        errorName: ["bold", "bgRedBright", "whiteBright"],
        fileName: ["yellow"],
        fileNameWithLine: "white",
      },
      levelMethod: settings?.pretty?.levelMethod ?? {},
      inspectOptions: settings?.pretty?.inspectOptions ?? {
        colors: true,
        compact: false,
        depth: Infinity,
      },
    },
    json: {
      messageKey: settings?.json?.messageKey ?? "message",
      levelKey: settings?.json?.levelKey ?? "level",
      levelIdKey: settings?.json?.levelIdKey ?? "levelId",
      timeKey: settings?.json?.timeKey ?? "time",
      errorKey: settings?.json?.errorKey ?? "error",
      numericLevel: settings?.json?.numericLevel ?? true,
      // `false` is a meaningful value (omit the time key) — only nullish falls back to "iso".
      time: settings?.json?.time ?? "iso",
      // Off by default: the deep sorted copy costs real throughput on every log, and insertion order is
      // what users wrote (and what every other structured logger emits). Head keys are stable either way.
      stableKeyOrder: settings?.json?.stableKeyOrder ?? false,
    },
    mask: {
      keys: [...(settings?.mask?.keys ?? [])],
      caseInsensitive: settings?.mask?.caseInsensitive ?? false,
      regex: [...(settings?.mask?.regex ?? [])],
      placeholder: settings?.mask?.placeholder ?? "[***]",
      paths: [...(settings?.mask?.paths ?? [])],
      censor: settings?.mask?.censor,
      hashLabel: settings?.mask?.hashLabel,
    },
    stack: {
      capture: stackCapture,
      internalFramePatterns: [...(settings?.stack?.internalFramePatterns ?? [])],
    },
    meta: {
      property: settings?.meta?.property ?? "_meta",
      attachContext: settings?.meta?.attachContext ?? true,
    },
    prefix: [...(settings?.prefix ?? [])],
    // Bare TransportFns passed via settings are normalized into Transports so the resolved-settings
    // contract (attachedTransports: Transport[]) holds and dispatch/flush can assume a uniform shape.
    attachedTransports: (settings?.attachedTransports ?? []).map((transport) => normalizeTransport(transport)),
    middleware: [...(settings?.middleware ?? [])],
    customLevels,
    bindings: settings?.bindings != null ? { ...settings.bindings } : undefined,
    strictConfig: settings?.strictConfig ?? false,
    // Kept by REFERENCE (never cloned): this is a live AsyncLocalStorage instance whose identity is
    // the whole point — sub-loggers must share the exact same store the caller injected.
    contextStorage: settings?.contextStorage,
    // The injectable time seam — passed through by reference so sub-loggers inherit the same clock.
    clock: settings?.clock,
  };
}
