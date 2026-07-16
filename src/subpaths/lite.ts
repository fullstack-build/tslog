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
 * {@link LiteLogger.getSubLogger} keeps that guarantee: a named sub-logger partially applies its label
 * with `Function.prototype.bind`, which returns another *native* function, so the devtools badge still
 * points at your call site. That is why labels are plain strings and not `%c` format specifiers — a
 * specifier would consume the argument after it instead of styling the label.
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
 *
 * const cart = log.getSubLogger({ name: "cart" });
 * cart.error("boom"); // -> console.error("cart", "boom"), still blamed on YOUR line
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
  /**
   * Label prepended to every logged line as a leading argument. Sub-loggers created with
   * {@link LiteLogger.getSubLogger} join their name onto the parent's with {@link nameSeparator}.
   *
   * Use a plain string: a `%c`/`%s` format specifier would consume the argument that follows it
   * rather than styling the label.
   */
  name?: string;
  /**
   * Separator joining a parent's `name` to a sub-logger's when nesting. Defaults to `":"`, so a
   * `"app"` logger's `"cart"` sub-logger is labeled `"app:cart"`.
   */
  nameSeparator?: string;
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
 *
 * A non-empty `name` is partially applied as the first argument. `bind` is load-bearing rather than a
 * style choice: it returns another native function, so the runtime still attributes the log to the
 * caller. Prepending the label inside a wrapper (`(...args) => fn(name, ...args)`) would make that
 * wrapper the blamed frame and defeat the entire point of this module.
 */
function bindLevel(levelId: number, minLevelId: number, sink: Partial<Console>, name?: string): LiteLogFn {
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
  return name != null && name !== "" ? (fn as LiteLogFn).bind(sink, name) : (fn as LiteLogFn).bind(sink);
}

/** Join a parent label to a child's, tolerating either side being absent. */
function joinName(parent: string | undefined, child: string | undefined, separator: string): string | undefined {
  if (parent == null || parent === "") {
    return child;
  }
  if (child == null || child === "") {
    return parent;
  }
  return `${parent}${separator}${child}`;
}

/**
 * The minimal leveled logger. Construct one with a `minLevel`, or use the ready-made {@link lite}
 * instance. Cheaper alternative: {@link createLiteLogger}, which returns the same shape from a plain
 * factory call.
 */
export class LiteLogger implements LiteLogMethods {
  /** Resolved minimum level id; levels below this are no-ops. */
  public readonly minLevel: number;
  /** Resolved label prepended to every line, or `undefined` for an unlabeled logger. */
  public readonly name: string | undefined;

  public readonly silly: LiteLogFn;
  public readonly trace: LiteLogFn;
  public readonly debug: LiteLogFn;
  public readonly info: LiteLogFn;
  public readonly warn: LiteLogFn;
  public readonly error: LiteLogFn;
  public readonly fatal: LiteLogFn;

  /** Retained so {@link getSubLogger} can re-bind against the same sink and separator. */
  readonly #sink: Partial<Console>;
  readonly #nameSeparator: string;

  constructor(options: LiteLoggerOptions = {}) {
    const sink: Partial<Console> = options.console ?? console;
    // Unknown / unresolvable level names fall back to 0 so a typo never silences the logger entirely.
    this.minLevel = resolveLogLevelId(options.minLevel) ?? 0;
    this.name = options.name === "" ? undefined : options.name;
    this.#sink = sink;
    this.#nameSeparator = options.nameSeparator ?? ":";

    this.silly = bindLevel(0, this.minLevel, sink, this.name);
    this.trace = bindLevel(1, this.minLevel, sink, this.name);
    this.debug = bindLevel(2, this.minLevel, sink, this.name);
    this.info = bindLevel(3, this.minLevel, sink, this.name);
    this.warn = bindLevel(4, this.minLevel, sink, this.name);
    this.error = bindLevel(5, this.minLevel, sink, this.name);
    this.fatal = bindLevel(6, this.minLevel, sink, this.name);
  }

  /**
   * A labeled child logger. Its `name` is appended to this logger's with `nameSeparator`, and every
   * setting not named in `options` is inherited — so `getSubLogger({ name: "cart" })` on an `"app"`
   * logger labels lines `"app:cart"` and keeps the parent's `minLevel` and sink.
   *
   * Unlike the full `Logger`'s sub-loggers this adds no wrapper frame: the child's level methods are
   * the same native `console.*` functions with the label partially applied, so devtools keeps blaming
   * your call site. Sub-loggers nest to any depth.
   *
   * @example
   * const app = new LiteLogger({ name: "app", minLevel: "INFO" });
   * const cart = app.getSubLogger({ name: "cart" });
   * cart.info("checkout"); // -> console.info("app:cart", "checkout")
   */
  public getSubLogger(options: LiteLoggerOptions = {}): LiteLogger {
    return new LiteLogger({
      minLevel: options.minLevel ?? this.minLevel,
      console: options.console ?? this.#sink,
      nameSeparator: options.nameSeparator ?? this.#nameSeparator,
      name: joinName(this.name, options.name, options.nameSeparator ?? this.#nameSeparator),
    });
  }

  /** Alias of {@link getSubLogger}, matching the full `Logger`'s `child()`. */
  public child(options: LiteLoggerOptions = {}): LiteLogger {
    return this.getSubLogger(options);
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
