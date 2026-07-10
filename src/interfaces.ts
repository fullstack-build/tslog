import type { InspectOptions } from "./internal/InspectOptions.interface.js";
export type { InspectOptions };

/** The log level ids used by the default logging methods (silly … fatal). */
export enum LogLevel {
  SILLY = 0,
  TRACE = 1,
  DEBUG = 2,
  INFO = 3,
  WARN = 4,
  ERROR = 5,
  FATAL = 6,
}

/** The names of the default log levels, accepted by `minLevel` as a self-documenting alternative to the numeric id. */
export type TLogLevelName = keyof typeof LogLevel;

/** A default log level expressed as its numeric id, the {@link LogLevel} enum, or its name (e.g. `"WARN"`). */
export type TLogLevel = number | LogLevel | TLogLevelName;

export type TStyle =
  | null
  | string
  | string[]
  | {
      [value: string]: null | string | string[];
    };

/** Maps a log level name (e.g. "WARN") or "*" to the console method used to output it. */
export type TPrettyLogLevelMethod = {
  [logLevelName: string]: (...args: unknown[]) => void;
};

/**
 * Built-in output formats, or a custom {@link LogFormatter}. Used both as the logger-wide `type`
 * (where only the two string formats apply) and as a per-{@link Transport} `format` override.
 */
export type TLogFormat<LogObj> = "pretty" | "json" | LogFormatter<LogObj>;

/**
 * Turns a finished, meta-decorated log record into the single line that a transport writes.
 *
 * A formatter receives the fully-built `record` (the user's `LogObj` plus the runtime `_logMeta` block)
 * and the live {@link ISettings}, and returns the string to emit. The two built-in formats
 * (`"pretty"`, `"json"`) are themselves formatters; supplying a function lets a single logger feed
 * different transports different representations (e.g. JSON to a file, pretty to the console).
 *
 * @example
 * // A minimal CSV-ish formatter for a custom transport:
 * const csv: LogFormatter<MyLog> = (record, settings) =>
 *   `${record[settings.meta.property].logLevelName},${record[settings.meta.property].date.toISOString()}`;
 */
export type LogFormatter<LogObj> = (record: LogObj & ILogObjMeta, settings: ISettings<LogObj>) => string;

/**
 * The mutable context threaded through the {@link LogMiddleware} chain for a single `log()` call.
 *
 * Middleware may read and mutate any field before the record is built: drop the log (by returning
 * `null`/`false`), rewrite the arguments, change the level, or stash request/trace state on `meta`
 * for a later format stage to pick up.
 *
 * @example
 * logger.use((ctx) => {
 *   ctx.meta.traceId = currentTraceId();   // enrich every log
 *   if (ctx.logLevelId < 3) return null;   // drop everything below INFO
 *   return ctx;
 * });
 */
export interface LogContext<LogObj> {
  /** Numeric id of the level this log was emitted at (e.g. `3` for INFO). */
  logLevelId: number;
  /** Name of the level this log was emitted at (e.g. `"INFO"`). */
  logLevelName: string;
  /** The (already prefix-prepended) arguments passed to the log call; may be replaced in place. */
  args: unknown[];
  /** The live, resolved settings of the emitting logger. Treat as read-only. */
  settings: ISettings<LogObj>;
  /** Free-form, per-call scratch space for middleware to attach trace/correlation/cost fields. */
  meta: Record<string, unknown>;
}

/**
 * A middleware function registered via `logger.use(...)`. Replaces the removed `overwrite.*` hooks
 * with a single composable chain.
 *
 * Middleware run in registration order, each receiving the {@link LogContext} produced by the
 * previous one. Return the (possibly mutated) context to continue, or `null`/`false` to drop the log
 * entirely (nothing is formatted, no transport runs). Returning `void` keeps the passed-in context.
 *
 * @example
 * // Sampling + enrichment in one chain:
 * logger.use((ctx) => { ctx.meta.region = "eu"; return ctx; });
 * logger.use((ctx) => (Math.random() < 0.1 ? ctx : null)); // sample 10%
 */
export type LogMiddleware<LogObj> = (context: LogContext<LogObj>) => LogContext<LogObj> | null | false | undefined;

/**
 * A single stage in the format pipeline that turns a meta-decorated record into output. Stages are
 * tree-shakeable factories (e.g. `timestamp()`, `errors()`, `json()`, `pretty()`); the default
 * console output is itself expressed as a built-in pipeline so the core has one path.
 *
 * Each stage receives the finished `record` and the live {@link ISettings} and returns the string it
 * contributes (or transforms). Composing stages yields the final line handed to transports.
 *
 * @example
 * const upper: FormatStage<MyLog> = (record, settings) => json()(record, settings).toUpperCase();
 */
export type FormatStage<LogObj> = (record: LogObj & ILogObjMeta, settings: ISettings<LogObj>) => string;

/**
 * A full-featured transport: an output sink that receives every emitted log (subject to its own
 * {@link minLevel}) as both the structured `record` and a pre-formatted `line`, and may flush and/or
 * dispose asynchronously. Attach via `logger.attachTransport(...)`, which returns a detach function.
 *
 * A plain {@link TransportFn} is accepted too and is wrapped into a `Transport` with no `flush`.
 *
 * @example
 * // A buffered file transport with per-transport JSON formatting and a flush:
 * const lines: string[] = [];
 * logger.attachTransport({
 *   name: "file",
 *   minLevel: "WARN",          // this sink only sees WARN and above
 *   format: "json",            // receives a JSON line regardless of the logger's `type`
 *   write: (_record, line) => { lines.push(line); },
 *   flush: async () => { await fs.appendFile("app.log", lines.join("\n")); lines.length = 0; },
 * });
 */
export interface Transport<LogObj> {
  /** Optional human-readable name, used in diagnostics (e.g. when a transport throws). */
  name?: string;
  /**
   * Per-transport minimum level: this sink only receives logs at or above it, independent of the
   * logger's own `minLevel`. Accepts a numeric id or a level name. Omitted → receives everything the
   * logger emits.
   * @example { minLevel: "ERROR" }
   */
  minLevel?: number | TLogLevelName;
  /**
   * Per-transport output format, isolating this sink from the logger-wide `type`. `"pretty"`/`"json"`
   * select a built-in formatter; a {@link LogFormatter} supplies a custom one. The `line` passed to
   * {@link write} is produced with this format (computed lazily, once per format used). Omitted → the
   * line follows the logger's `type`.
   * @example { format: "json" }
   */
  format?: TLogFormat<LogObj>;
  /**
   * Consume one log. `record` is the finished log object (user fields + `_logMeta`); `line` is the
   * already-formatted string for this transport's {@link format}. May be async; a rejected/thrown
   * result is isolated so it never breaks logging or sibling transports.
   */
  write(record: LogObj & ILogObjMeta, line: string): void | Promise<void>;
  /**
   * Flush any buffered output. Awaited by `logger.flush()` and by the logger's `[Symbol.asyncDispose]`.
   * @example flush: async () => { await stream.write(buffer); buffer = ""; }
   */
  flush?(): Promise<void>;
  /** Async disposer (`await using`), invoked by the logger's own disposal; should flush then release resources. */
  [Symbol.asyncDispose]?(): Promise<void>;
}

/** The call signature installed for a registered custom level (see `addLevel`/`customLevels`). */
export type TCustomLevelMethod<LogObj> = (...args: unknown[]) => (LogObj & ILogObjMeta) | undefined;

/**
 * The level methods a `customLevels` map adds to a logger, keyed by the lower-cased level names.
 * Used by the per-entry `createLogger` helper to type `logger.audit(...)` from
 * `createLogger({ customLevels: { AUDIT: 7 } })`, and by `addLevel`'s return type.
 */
export type TCustomLevelMethods<S, LogObj> = S extends { customLevels: infer C }
  ? string extends keyof C
    ? unknown // non-literal key set (Record<string, number>): no methods can be typed soundly
    : { [K in keyof C & string as Lowercase<K>]: TCustomLevelMethod<LogObj> }
  : unknown;

/**
 * A bare transport function: receives the finished, meta-decorated record. Accepted by
 * `attachTransport` for convenience and wrapped into a {@link Transport} (with no `flush`).
 *
 * @example
 * logger.attachTransport((record) => myQueue.push(record));
 */
export type TransportFn<LogObj> = (record: LogObj & ILogObjMeta) => void | Promise<void>;

/**
 * Controls the shape of the structured (`type: "json"`) output: which top-level keys carry the
 * message, level, time, and error, and whether a numeric level id and stable key ordering are emitted.
 * The user's logged fields are spread alongside these keys; runtime metadata stays nested under
 * {@link IMetaSettings.property} (default `"_logMeta"`).
 *
 * @example
 * // Emit Elastic Common Schema-ish keys:
 * { json: { messageKey: "message", levelKey: "log.level", timeKey: "@timestamp", numericLevel: false } }
 */
export interface IJsonOutputSettings {
  /**
   * Top-level key under which a bare-string log message is placed. Default: `"message"`.
   * @example { json: { messageKey: "msg" } } // pino-style
   */
  messageKey?: string;
  /**
   * Top-level key holding the level *name* (e.g. `"INFO"`). Default: `"level"`.
   * @example { json: { levelKey: "severity" } }
   */
  levelKey?: string;
  /**
   * Top-level key holding the numeric level *id* (e.g. `3`), emitted only when {@link numericLevel}
   * is `true`. Default: `"levelId"`.
   * @example { json: { numericLevel: true, levelIdKey: "level_id" } }
   */
  levelIdKey?: string;
  /**
   * Top-level key holding the timestamp. Default: `"time"`. The JSON timestamp is always a UTC
   * ISO-8601 string (`pretty.timeZone` only affects pretty output) unless {@link time} overrides
   * the representation.
   * @example { json: { timeKey: "@timestamp" } }
   */
  timeKey?: string;
  /**
   * How the top-level {@link timeKey} value is rendered (`_logMeta.date` always stays a UTC ISO string):
   * - `"iso"` (default): UTC ISO-8601 string, e.g. `"2026-07-04T10:11:12.000Z"`.
   * - `"epoch"`: epoch **milliseconds** as a number (pino's default `time`; cheaper to produce).
   * - `false`: omit the top-level time key entirely (diff-friendly/CI output; a user field named
   *   like {@link timeKey} then passes through instead of being reserved).
   * - a function `(date) => string | number`: custom rendering, e.g. nanoseconds for Loki. Must not
   *   throw; if it does, the ISO string is emitted instead.
   * @example { json: { time: "epoch" } }
   * @example { json: { time: (d) => String(BigInt(d.getTime()) * 1_000_000n) } } // ns for Loki
   */
  time?: "iso" | "epoch" | false | ((date: Date) => string | number);
  /**
   * Top-level key under which logged errors are serialized as an {@link IErrorObjectStringifiable}
   * (following the `cause` chain). Default: `"error"`.
   * @example { json: { errorKey: "err" } } // pino-style
   */
  errorKey?: string;
  /**
   * When `true` (default), also emit the numeric level id under {@link levelIdKey} alongside the
   * level name. Set `false` to emit only the name.
   * @example { json: { numericLevel: false } }
   */
  numericLevel?: boolean;
  /**
   * When `true`, additionally emit the user's fields (and nested objects, recursively) in sorted key
   * order so identical payloads produce byte-identical lines — useful for snapshot tests and diffing.
   * Default `false`: the well-known head keys (message, level, time, …) always come first in a stable
   * order, but user fields keep their insertion order and skip the deep sorted copy that costs
   * throughput on every log.
   * @example { json: { stableKeyOrder: true } }
   */
  stableKeyOrder?: boolean;
}

/**
 * The `mask` group: every secret-redaction control. Key/regex masking ({@link keys}/{@link regex}) and
 * path-based (JSONPath-lite) masking ({@link paths}) are composed in a single pass; a leaf is censored
 * when its key is in {@link keys}, its string value matches a {@link regex}, or its full dotted path
 * matches one of {@link paths} (`*` matches any single path segment).
 *
 * @example
 * // Keep secrets and prompts/PII out of your logs (key masking):
 * { mask: { keys: ["password", "apiKey", "authorization", "token", "prompt", "email"] } }
 * @example
 * // Redact a nested password and any top-level *.token (path masking):
 * { mask: { paths: ["user.password", "*.token", "a.b.c"] } }
 * @example
 * // Drop the matched key entirely instead of replacing its value:
 * { mask: { paths: ["headers.authorization"], censor: "remove" } }
 * @example
 * // Custom censor that keeps the last 4 chars:
 * { mask: { paths: ["card.number"], censor: (v) => `****${String(v).slice(-4)}` } }
 */
export interface IMaskOptions {
  /**
   * Redact the values of these object keys anywhere in the logged data (case-sensitive by default).
   * Use this to keep secrets and sensitive data — passwords, API keys, tokens, and (for AI/agentic apps)
   * prompts and PII — out of your logs.
   * @example { mask: { keys: ["password", "apiKey", "authorization", "token"] } }
   * @example { mask: { keys: ["prompt", "completion", "email"] } } // agentic apps
   */
  keys?: string[];
  /** Match {@link keys} case-insensitively (so `"password"` also masks `"Password"`/`"PASSWORD"`). Default: `false`. */
  caseInsensitive?: boolean;
  /**
   * Replace every substring matching these patterns in string values (e.g. secrets pulled from env vars,
   * emails, IPs). Applied with the {@link placeholder}.
   * @example { mask: { regex: [/\b[A-Za-z0-9]{32,}\b/g] } } // long token-like strings
   */
  regex?: RegExp[];
  /** String used to replace masked values. Default: `"[***]"`. */
  placeholder?: string;
  /**
   * Dotted paths whose matching leaf values are censored. `*` matches exactly one segment.
   * Compiled once and composed with key/regex masking; an empty/omitted list keeps the masking
   * fast path (normalize-only) intact.
   * @example { mask: { paths: ["user.password", "*.token"] } }
   */
  paths?: string[];
  /**
   * How a path-matched value is censored:
   * - `"remove"` to delete the key from the cloned output,
   * - `"hash"` to replace the value with a SHORT, stable, **non-cryptographic** correlation token
   *   (e.g. `"[hash:1a2b3c4d]"`) so the same value always yields the same token — letting you
   *   correlate occurrences of a secret across logs without ever exposing it. The hash is a fast,
   *   synchronous FNV-1a over the stringified value (no Web Crypto, no async on the hot path); it is
   *   for correlation only and must NOT be relied on for security. Customize the token label via
   *   {@link hashLabel}.
   * - any other `string` is used verbatim as the replacement (defaults to {@link placeholder} when omitted), or
   * - a function `(value, path) => unknown` returning the replacement (receives the matched value
   *   and its dotted path).
   * @example { mask: { paths: ["pin"], censor: "remove" } }
   * @example { mask: { paths: ["userId"], censor: "hash" } }      // "[hash:1a2b3c4d]"
   * @example { mask: { paths: ["ssn"], censor: (v, path) => `redacted@${path}` } }
   */
  censor?: string | "remove" | "hash" | ((value: unknown, path: string) => unknown);
  /**
   * Label used inside the `"hash"` correlation token, i.e. the `xxx` in `"[xxx:1a2b3c4d]"`.
   * Only consulted when {@link censor} is `"hash"`. Default: `"hash"`.
   * @example { mask: { paths: ["userId"], censor: "hash", hashLabel: "id" } } // "[id:1a2b3c4d]"
   */
  hashLabel?: string;
}

/**
 * The `stack` group: controls how (and whether) the calling code position is captured for `_logMeta.path`.
 *
 * @example { stack: { capture: "off" } }      // never capture a stack (cheapest)
 * @example { stack: { internalFramePatterns: [/myWrapper\.ts/] } } // skip a wrapper file in auto-detection
 */
export interface IStackSettings {
  /**
   * Controls how the calling code position is captured for `_logMeta.path`.
   * - `"off"`: never capture a stack — cheapest, no code position in output.
   * - `"lazy"`: capture the `Error` cheaply but only parse frames on first read of `_logMeta.path`.
   * - `"auto"` (default for `type: "pretty"`): capture only when the pretty template references a code-position placeholder.
   * - `"full"`: always capture and parse the stack eagerly.
   *
   * Defaults to `"auto"` for `type: "pretty"` and `"off"` for `type: "json"`.
   * @example { stack: { capture: "lazy" } }
   */
  capture?: "off" | "lazy" | "auto" | "full";
  /**
   * Additional RegExp patterns matched against stack frame file paths that should be treated as
   * "internal" when auto-detecting the calling code position. Use this so a wrapper/custom logger
   * reports the position of *its* caller instead of the wrapper file itself.
   * @example { stack: { internalFramePatterns: [/myLogger\.ts/] } }
   */
  internalFramePatterns?: RegExp[];
}

/**
 * The `meta` group: controls the runtime metadata block attached to every log.
 *
 * @example { meta: { property: "$meta" } }
 * @example { meta: { attachContext: false } } // disable async-context auto-attach
 */
export interface IMetaSettings {
  /** Property name under which runtime metadata (date, level, code position, runtime) is attached. Default: `"_logMeta"`. */
  property?: string;
  /**
   * Async context (M2.13) propagation. When `true` (the default), the fields of the active context set via
   * `logger.runInContext(ctx, fn)` are attached onto every log's `_logMeta` block (under {@link property})
   * for the duration of `fn`, across `await`/timers/nested calls. Set `false` to disable the attach while
   * still allowing `runInContext`/`getContext` to be used (e.g. only by the otel preset's trace getter).
   * On runtimes without `AsyncLocalStorage` (browsers/edge) this is a graceful no-op regardless of the flag.
   * @example { meta: { attachContext: false } }
   */
  attachContext?: boolean;
}

/**
 * The `pretty` group: every control for the human-readable (`type: "pretty"`) output — the log/error
 * templates, the timezone, the per-token styles, the level→console-method map, and the inspect options.
 *
 * @example
 * { pretty: { template: "{{logLevelName}}\t{{filePathWithLine}}\t", timeZone: "local" } }
 */
export interface IPrettySettings {
  /**
   * Explicitly enable/disable pretty output regardless of the default `type` resolution. When `false`,
   * the logger falls back to `"json"` (unless an explicit `type` is set). When omitted, `type` defaults to
   * `"pretty"` on every runtime; only the coloring is environment-aware (colored on an interactive TTY and
   * in the browser, uncolored when piped/redirected). `NO_COLOR` strips styling but never switches the
   * format to json — JSON is opt-in via `type: "json"`, `TSLOG_TYPE=json`, or a JSON transport.
   * @example { pretty: { enabled: false } }
   */
  enabled?: boolean;
  /**
   * The pretty log line template. Recognized placeholders include `{{yyyy}}`/`{{mm}}`/`{{dd}}`,
   * `{{hh}}`/`{{MM}}`/`{{ss}}`/`{{ms}}`, `{{dateIsoStr}}`, `{{logLevelName}}`, `{{filePathWithLine}}`,
   * `{{name}}`, and the name-delimiter variants.
   * @example { pretty: { template: "{{logLevelName}}\t{{name}}\t" } }
   */
  template?: string;
  /**
   * Template for the error header (name + message) when an `Error` is logged in pretty mode.
   * @example { pretty: { errorTemplate: "\n{{errorName}} {{errorMessage}}\n{{errorStack}}" } }
   */
  errorTemplate?: string;
  /**
   * Template for each rendered stack frame of a logged error.
   * @example { pretty: { errorStackTemplate: "  • {{fileName}}\t{{method}}\n\t{{filePathWithLine}}" } }
   */
  errorStackTemplate?: string;
  /** Separator placed between parent logger names in pretty/error output. Default: `":"`. */
  errorParentNamesSeparator?: string;
  /** Delimiter placed around the (combined) logger name in pretty/error output. Default: `"\t"`. */
  errorLoggerNameDelimiter?: string;
  /**
   * Whether to apply ANSI (Node) / CSS `%c` (browser) styling to pretty output. Default: `true`.
   * Honored alongside `NO_COLOR`/`FORCE_COLOR` at normalize time.
   * @example { pretty: { style: false } }
   */
  style?: boolean;
  /** Timezone used to render the pretty timestamp (`"UTC"` or `"local"`). Default: `"UTC"`. */
  timeZone?: "UTC" | "local";
  /** Per-token styles (ANSI color names / arrays / level maps) for pretty output. See {@link IPrettyLogStyles}. */
  styles?: IPrettyLogStyles;
  /** Maps a log level name (or `"*"`) to the console method used to print it. See {@link TPrettyLogLevelMethod}. */
  levelMethod?: TPrettyLogLevelMethod;
  /**
   * Pass non-Error arguments to the console method as their raw values instead of pre-rendering them
   * into the log string via `util.inspect`/`formatWithOptions`. Default: `false`.
   *
   * With this on, the styled meta prefix is still printed, but objects and arrays are handed to
   * `console.log`/`console.error`/… untouched — so a browser DevTools console renders them as
   * interactive, collapsible trees (issues #263/#295) and `console.error`/`console.warn` (via
   * {@link IPrettySettings.levelMethod}) attach their own expandable stack group (issue #226).
   * `inspectOptions` no longer applies to those args (the console owns the rendering); `Error`
   * arguments are still formatted through the pretty error template.
   * @example { pretty: { passObjectsNatively: true, levelMethod: { error: "error", warn: "warn" } } }
   */
  passObjectsNatively?: boolean;
  /** Options passed to the runtime's `util.inspect`/`formatWithOptions` when rendering pretty args. */
  inspectOptions?: InspectOptions;
}

export interface IPrettyLogStyles {
  yyyy?: TStyle;
  mm?: TStyle;
  dd?: TStyle;
  hh?: TStyle;
  MM?: TStyle;
  ss?: TStyle;
  ms?: TStyle;
  dateIsoStr?: TStyle;
  logLevelName?: TStyle;
  fileName?: TStyle;
  fileNameWithLine?: TStyle;
  filePath?: TStyle;
  fileLine?: TStyle;
  filePathWithLine?: TStyle;
  name?: TStyle;
  nameWithDelimiterPrefix?: TStyle;
  nameWithDelimiterSuffix?: TStyle;
  errorName?: TStyle;
  errorMessage?: TStyle;
}

export interface ISettingsParam<LogObj> {
  /**
   * Output format.
   * - `"pretty"` (default): human-readable, colorized — best for local development.
   * - `"json"`: one structured JSON object per line — best for production, observability backends, and LLM ingestion.
   * - `"hidden"`: suppress console output (still returns the log object and runs attached transports).
   * @example { type: "json" }
   */
  type?: "json" | "pretty" | "hidden";
  /** Optional name for this logger, shown in pretty output and inherited by sub-loggers (e.g. per-module or per-agent). */
  name?: string;
  parentNames?: string[];
  /**
   * Minimum level to emit; lower levels are skipped. Accepts a number, the {@link LogLevel} enum, or a level name.
   * Levels: `SILLY`(0) `TRACE`(1) `DEBUG`(2) `INFO`(3) `WARN`(4) `ERROR`(5) `FATAL`(6).
   * @example { minLevel: "WARN" }
   * @example { minLevel: LogLevel.INFO }
   */
  minLevel?: TLogLevel;
  argumentsArrayName?: string;
  /**
   * Opt-in browser log-level persistence (M4.6). When `true` and running in a browser, the logger reads its
   * initial `minLevel` from `localStorage["tslog:level"]` (a numeric id or a level name like `"WARN"`) on
   * construction, and `setMinLevel(...)` persists the new level back to the same key for the next page load —
   * letting you flip log verbosity live from the devtools console without a rebuild. All `localStorage` access
   * is `try/catch`-guarded (private mode throws) and is a NO-OP off-browser, so this never affects Node/Bun/Deno
   * behavior. Default `false`. The custom key can be set via {@link persistLevelKey}.
   * @example { type: "pretty", persistLevel: true } // then in devtools: localStorage["tslog:level"] = "DEBUG"
   */
  persistLevel?: boolean;
  /**
   * The `localStorage` key used when {@link persistLevel} is enabled. Defaults to `"tslog:level"`. Ignored when
   * {@link persistLevel} is `false` or off-browser.
   * @example { persistLevel: true, persistLevelKey: "myapp:logLevel" }
   */
  persistLevelKey?: string;
  /**
   * Injectable clock (the time seam): called once per log to produce the record's `_logMeta.date`
   * (and thus the JSON `time` and pretty timestamp). Defaults to the runtime's `new Date()`.
   * Use it for deterministic tests, monotonic stamping, or an offset clock. Must return a valid
   * `Date`; a throwing clock or an invalid result is ignored (the runtime date is kept), so a bad
   * clock can never break logging. Inherited by sub-loggers.
   * @example { clock: () => new Date(0) } // frozen time for snapshot tests
   */
  clock?: () => Date;
  /**
   * The `pretty` group: every control for the human-readable (`type: "pretty"`) output — templates,
   * timezone, per-token styles, the level→console-method map, and inspect options. See {@link IPrettySettings}.
   * @example { type: "pretty", pretty: { timeZone: "local", style: true } }
   */
  pretty?: IPrettySettings;
  /**
   * Configure the structured (`type: "json"`) output: the top-level key names for message/level/time/error,
   * whether a numeric level id is emitted, and whether well-known keys are written in a stable order.
   * The user's logged fields are spread at the top level next to these keys; runtime meta stays under
   * {@link IMetaSettings.property}. See {@link IJsonOutputSettings}.
   * @example { type: "json", json: { messageKey: "msg", levelKey: "level", timeKey: "@timestamp" } }
   */
  json?: IJsonOutputSettings;
  /**
   * The `mask` group: secret redaction by key ({@link IMaskOptions.keys}), regex
   * ({@link IMaskOptions.regex}), and dotted path ({@link IMaskOptions.paths}), with the
   * {@link IMaskOptions.placeholder}/{@link IMaskOptions.censor} replacement. See {@link IMaskOptions}.
   * @example { mask: { keys: ["password", "apiKey", "prompt"], caseInsensitive: true } }
   * @example { mask: { paths: ["user.password", "*.token"], censor: "remove" } }
   */
  mask?: IMaskOptions;
  /**
   * The `stack` group: how (and whether) the calling code position is captured for `_logMeta.path`, plus
   * extra internal-frame patterns for wrapper loggers. See {@link IStackSettings}.
   * @example { stack: { capture: "off" } }
   */
  stack?: IStackSettings;
  /**
   * The `meta` group: the runtime metadata property name and the async-context auto-attach flag.
   * See {@link IMetaSettings}.
   * @example { meta: { property: "$meta", attachContext: false } }
   */
  meta?: IMetaSettings;
  /**  Prefix every log message of this logger. */
  prefix?: unknown[];
  /**
   * Output sinks attached to this logger. Each entry is a full {@link Transport} or a bare
   * {@link TransportFn} (which is wrapped into a `Transport` with no `flush`). Prefer the
   * `attachTransport(...)` method, which returns a detach function and keeps this array as the storage.
   * @example { attachedTransports: [(record) => myQueue.push(record)] }
   */
  attachedTransports?: (Transport<LogObj> | TransportFn<LogObj>)[];
  /**
   * Middleware run, in order, on every log before the record is built — the replacement for the removed
   * `overwrite.*` hooks. Each can enrich/rewrite the {@link LogContext} or drop the log (return
   * `null`/`false`). Prefer the `use(...)` method to append at runtime; this seeds the initial chain.
   * @example
   * // Attach a trace id to every log and drop anything below INFO:
   * { middleware: [(ctx) => { ctx.meta.traceId = getTraceId(); return ctx.logLevelId >= 3 ? ctx : null; }] }
   */
  middleware?: LogMiddleware<LogObj>[];
  /**
   * Additive custom log levels (M2.14): a map of `name → numeric id` registered on top of the canonical
   * seven (`SILLY`(0) … `FATAL`(6)), which always keep working. Use these to express domain levels (e.g.
   * `{ NOTICE: 3.5, AUDIT: 7 }`) that `log(id, name, ...)` emits with the right `logLevelId`/`logLevelName`
   * and that a string `minLevel` (e.g. `"NOTICE"`) resolves against. A name colliding with a default level
   * throws. No syslog set is shipped in core — define your own. Sub-loggers inherit and may extend the map.
   * Also addable at runtime via `logger.addLevel(name, id)`.
   * @example { customLevels: { NOTICE: 3.5, AUDIT: 7 } }
   */
  customLevels?: Record<string, number>;
  /**
   * Static fields bound to every record this logger emits (JSON output), the idiomatic channel for
   * per-request/per-tenant correlation data. Bindings merge down the sub-logger chain
   * (`child({ bindings })` extends the parent's) and always LOSE to per-call fields on a key
   * collision, so a single log call can override a bound value. Values are plain data — functions
   * are not invoked (use the `logObj` constructor argument for per-call generators). Masked once at
   * logger construction with the `mask` settings; treat the resolved `settings.bindings` as
   * read-only afterwards (runtime reassignment bypasses masking — create a child with `bindings`
   * instead). Keys colliding with the configured message/meta keys, `__proto__`, or integer-like
   * names are dropped with a development warning.
   * @example { name: "api", bindings: { tenant: "acme", region: "eu" } }
   */
  bindings?: Record<string, unknown>;
  /**
   * Opt-in strict configuration validation (E6). When `true`, a hard misconfiguration that would otherwise
   * only emit a development warning (e.g. an unknown `minLevel` name or a typo'd pretty template placeholder)
   * instead throws a typed {@link TslogConfigError} carrying a `code`, the offending `setting` path, and a
   * `suggestion`. Default `false` preserves the existing warn-only, never-throwing behavior. Throwing happens
   * regardless of `NODE_ENV`, so a strict config fails fast in production too.
   * @example { strictConfig: true }
   */
  strictConfig?: boolean;
  /**
   * Bring-your-own `AsyncLocalStorage` for `runInContext`/`getContext`. tslog resolves the runtime's
   * `AsyncLocalStorage` automatically on Node, Deno, and Bun; pass one here only where automatic
   * resolution cannot work — most notably Cloudflare Workers with the `nodejs_als` compatibility flag,
   * which enables the `node:async_hooks` import but no `process.getBuiltinModule`:
   *
   * ```ts
   * import { AsyncLocalStorage } from "node:async_hooks"; // needs nodejs_als or nodejs_compat
   * const log = new Logger({ contextStorage: new AsyncLocalStorage() });
   * ```
   *
   * Accepts any object with `AsyncLocalStorage`'s `run`/`getStore` shape, so a custom scheduler-based
   * implementation works too. Sub-loggers inherit it. When set, it takes precedence over the automatic
   * resolution.
   */
  // biome-ignore lint/suspicious/noExplicitAny: existential — AsyncLocalStorage<T> for ANY user T must be assignable
  contextStorage?: IContextStorage<any>;
}

/**
 * The structural `AsyncLocalStorage` subset accepted by {@link ISettingsParam.contextStorage} — an
 * instance of `node:async_hooks`' `AsyncLocalStorage<T>` satisfies it as-is, for ANY `T` (interface
 * store types have no implicit index signature, so the store slot is intentionally loose; the runtime
 * duck-check in the store wrapper is the actual guard).
 */
export interface IContextStorage<TStore = Record<string, unknown>> {
  run<T>(store: TStore, fn: () => T): T;
  getStore(): TStore | undefined;
}

/** Fully-resolved `pretty` group: every field of {@link IPrettySettings} defaulted (`enabled` resolved into `type`). */
export interface IResolvedPrettySettings extends Required<Omit<IPrettySettings, "enabled">> {}

/** Fully-resolved `stack` group: `capture` resolved by type/flags; `internalFramePatterns` always an array. */
export interface IResolvedStackSettings {
  capture: "off" | "lazy" | "auto" | "full";
  internalFramePatterns: RegExp[];
}

/** Fully-resolved `meta` group: `property` and `attachContext` always present. */
export interface IResolvedMetaSettings {
  property: string;
  attachContext: boolean;
}

/** Fully-resolved `mask` group: `keys`/`regex`/`paths` always present (possibly empty); `placeholder` defaulted. */
export interface IResolvedMaskSettings {
  keys: string[];
  caseInsensitive: boolean;
  regex: RegExp[];
  placeholder: string;
  paths: string[];
  censor?: string | "remove" | "hash" | ((value: unknown, path: string) => unknown);
  /** Label used inside the `"hash"` correlation token (`"[<label>:xxxxxxxx]"`). Default: `"hash"`. */
  hashLabel?: string;
}

export interface ISettings<LogObj> extends ISettingsParam<LogObj> {
  type: "json" | "pretty" | "hidden";
  name?: string;
  parentNames?: string[];
  minLevel: number;
  argumentsArrayName?: string;
  /** Resolved `pretty` group with every field defaulted. See {@link IResolvedPrettySettings}. */
  pretty: IResolvedPrettySettings;
  /** Fully-resolved JSON output settings with every key defaulted. See {@link IJsonOutputSettings}. */
  json: Required<IJsonOutputSettings>;
  /** Resolved `mask` group: key/regex/path masking with the placeholder defaulted. See {@link IResolvedMaskSettings}. */
  mask: IResolvedMaskSettings;
  /** Resolved `stack` group: `capture` resolved and `internalFramePatterns` always an array. See {@link IResolvedStackSettings}. */
  stack: IResolvedStackSettings;
  /** Resolved `meta` group: `property` and `attachContext` always present. See {@link IResolvedMetaSettings}. */
  meta: IResolvedMetaSettings;
  prefix: unknown[];
  /** Resolved transports: bare {@link TransportFn}s passed in are normalized into {@link Transport}s. */
  attachedTransports: Transport<LogObj>[];
  /** Resolved middleware chain (the seed from {@link ISettingsParam.middleware} plus anything added via `use(...)`). */
  middleware: LogMiddleware<LogObj>[];
  /** Resolved additive custom levels (always present, possibly empty). See {@link ISettingsParam.customLevels}. */
  customLevels: Record<string, number>;
  /** Resolved bound fields (parent chain merged), or `undefined` when none are set. See {@link ISettingsParam.bindings}. */
  bindings?: Record<string, unknown>;
  /** Resolved strict-config flag (always present). See {@link ISettingsParam.strictConfig}. */
  strictConfig: boolean;
  /** The injected async-context storage (kept by reference), or `undefined` for automatic resolution. See {@link ISettingsParam.contextStorage}. */
  // biome-ignore lint/suspicious/noExplicitAny: existential — mirrors ISettingsParam.contextStorage
  contextStorage?: IContextStorage<any>;
  /** The injectable clock (kept by reference), or `undefined` for the runtime's `new Date()`. See {@link ISettingsParam.clock}. */
  clock?: () => Date;
}

export interface ILogObj {
  [name: string]: unknown;
}

export interface ILogObjMeta {
  [name: string]: IMeta;
}

export interface IStackFrame {
  fullFilePath?: string;
  fileName?: string;
  fileNameWithLine?: string;
  filePath?: string;
  fileLine?: string;
  fileColumn?: string;
  filePathWithLine?: string;
  method?: string;
}

/**
 * Object representing an error with a stack trace
 * @public
 */
export interface IErrorObject {
  /** Name of the error*/
  name: string;
  /** Error message */
  message: string;
  /** native Error object */
  nativeError: Error;
  /** Stack trace of the error */
  stack: IStackFrame[];
  /** Optional nested cause chain */
  cause?: IErrorObject;
}

/**
 * ErrorObject that can safely be "JSON.stringifed". All circular structures have been "util.inspected" into strings
 * @public
 */
export interface IErrorObjectStringifiable extends IErrorObject {
  nativeError: never;
  errorString: string;
  cause?: IErrorObjectStringifiable;
}

/*
  RUNTIME TYPES
*/
export interface IMetaStatic {
  name?: string;
  parentNames?: string[];
  runtime: string;
  /** Runtime version string (Node/Deno/Bun only). */
  runtimeVersion?: string;
  /** Host name of the machine (server-side runtimes only). */
  hostname?: string;
  /** Browser user agent (browser/worker runtimes only). */
  browser?: string;
}

export interface IMeta extends IMetaStatic {
  date: Date;
  logLevelId: number;
  logLevelName: string;
  path?: IStackFrame;
}
