import { DEFAULT_LOG_LEVEL_NAMES, resolveLogLevelId } from "../core/levels.js";
import type { TLogLevel, TLogLevelName } from "../interfaces.js";

/**
 * `tslog/lite` — the smallest possible leveled logger (M3.12).
 *
 * A {@link LiteLogger} is seven thin wrappers (`silly` … `fatal`) over the native `console.*`
 * methods with NO masking, NO stack-trace capture, NO object cloning and NO `_logMeta` enrichment.
 * It is meant for hot paths and tiny edge/browser bundles where the full {@link Logger} pipeline is
 * more than you need.
 *
 * Each enabled level method is the *bound native console function itself* (`console.log.bind(console)`,
 * etc.) — not a tslog wrapper around it. That means the runtime's "logged from" annotation (the
 * file:line shown by browser devtools, Node's `--enable-source-maps`, etc.) points at YOUR call site
 * rather than at a tslog frame. Levels below `minLevel` are replaced by a shared no-op so disabled
 * logging costs a single property read and an empty call.
 *
 * The module has no import-time side effects (it only declares bindings), so bundlers can drop it
 * when unused.
 *
 * @example
 * import { LiteLogger, lite } from "tslog/lite";
 *
 * lite.info("ready"); // -> console.info("ready"), native line numbers preserved
 *
 * const log = new LiteLogger({ minLevel: "WARN" });
 * log.debug("noisy"); // suppressed (DEBUG=2 < WARN=4)
 * log.error("boom");  // -> console.error("boom")
 */

/** The seven default level names in id order, used to build the method set. */
const LEVEL_NAMES = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;

/** A single lite level method: forwards every argument straight to the underlying console method. */
export type LiteLogFn = (...args: unknown[]) => void;

/** The shape of a {@link LiteLogger}: one method per default level, all forwarding to `console.*`. */
export type LiteLogMethods = {
  readonly [K in (typeof LEVEL_NAMES)[number]]: LiteLogFn;
};

/** Options for {@link LiteLogger} / {@link createLiteLogger}. */
export interface LiteLoggerOptions {
  /**
   * Minimum level to emit; lower levels become a no-op. Accepts a numeric id, the
   * {@link LogLevel} enum, or a default level name like `"WARN"`. Defaults to `0` (SILLY),
   * i.e. everything is logged.
   */
  minLevel?: TLogLevel;
  /**
   * Console-like sink to forward to. Defaults to the global `console`. Useful for tests or for
   * routing lite output somewhere else without paying for the full transport machinery.
   */
  console?: Partial<Console>;
}

/** Shared no-op used for every level below `minLevel` — declared once so disabled levels share it. */
const NOOP: LiteLogFn = () => {};

/** Map a default level id to the native console method that best matches it. */
function consoleMethodFor(levelId: number): "debug" | "info" | "warn" | "error" {
  if (levelId >= 5) {
    return "error"; // ERROR, FATAL
  }
  if (levelId === 4) {
    return "warn"; // WARN
  }
  if (levelId >= 3) {
    return "info"; // INFO
  }
  return "debug"; // SILLY, TRACE, DEBUG
}

/**
 * Build the bound level method for `levelId`: the native `console.*` function bound to the sink so it
 * keeps the caller's source position, or the shared {@link NOOP} when the level is below `minLevel`.
 */
function bindLevel(levelId: number, minLevelId: number, sink: Partial<Console>): LiteLogFn {
  if (levelId < minLevelId) {
    return NOOP;
  }
  const methodName = consoleMethodFor(levelId);
  const fn = sink[methodName] ?? sink.log;
  if (typeof fn !== "function") {
    return NOOP;
  }
  // Bind to the sink so `this` is correct and, crucially, so the call frame the runtime attributes
  // the log to is the USER's call site rather than a tslog wrapper.
  return (fn as LiteLogFn).bind(sink);
}

/**
 * The minimal leveled logger. Construct one with a `minLevel`, or use the ready-made {@link lite}
 * instance. Cheaper alternative: {@link createLiteLogger}, which returns the same shape from a plain
 * factory call.
 */
export class LiteLogger implements LiteLogMethods {
  /** Resolved minimum level id; levels below this are no-ops. */
  public readonly minLevel: number;

  public readonly silly: LiteLogFn;
  public readonly trace: LiteLogFn;
  public readonly debug: LiteLogFn;
  public readonly info: LiteLogFn;
  public readonly warn: LiteLogFn;
  public readonly error: LiteLogFn;
  public readonly fatal: LiteLogFn;

  constructor(options: LiteLoggerOptions = {}) {
    const sink: Partial<Console> = options.console ?? console;
    // Unknown / unresolvable level names fall back to 0 so a typo never silences the logger entirely.
    this.minLevel = resolveLogLevelId(options.minLevel) ?? 0;

    this.silly = bindLevel(0, this.minLevel, sink);
    this.trace = bindLevel(1, this.minLevel, sink);
    this.debug = bindLevel(2, this.minLevel, sink);
    this.info = bindLevel(3, this.minLevel, sink);
    this.warn = bindLevel(4, this.minLevel, sink);
    this.error = bindLevel(5, this.minLevel, sink);
    this.fatal = bindLevel(6, this.minLevel, sink);
  }

  /** Whether `level` would be emitted given this logger's `minLevel`. Honors level names. */
  public isLevelEnabled(level: TLogLevel): boolean {
    const id = resolveLogLevelId(level);
    return id != null && id >= this.minLevel;
  }
}

/**
 * Factory form of {@link LiteLogger} — `createLiteLogger(opts)` is equivalent to `new LiteLogger(opts)`
 * but reads as a plain function call for code that prefers factories over `new`.
 */
export function createLiteLogger(options: LiteLoggerOptions = {}): LiteLogger {
  return new LiteLogger(options);
}

/** A ready-to-use lite logger at the default level (everything is emitted). */
export const lite: LiteLogger = new LiteLogger();

export { DEFAULT_LOG_LEVEL_NAMES };
export type { TLogLevel, TLogLevelName };
