import { Logger } from "../index.universal.js";
import type { ILogObj, ILogObjMeta, IMeta, ISettingsParam, TLogLevelName } from "../interfaces.js";
import { LogLevel } from "../interfaces.js";

/**
 * `tslog/testing` — zero-config helpers for asserting on logs in your own tests (M4.5).
 *
 * Two helpers, both pure (no global mutation, no import-time side effects):
 *
 * - {@link createTestLogger} returns a real {@link Logger} with an in-memory transport attached, plus the
 *   captured `logs` (structured records) and `lines` (formatted strings) arrays and a `clear()` to reset
 *   between cases. Output is suppressed by default (`type: "hidden"`) so your test runner stays quiet while
 *   the transport still records everything; pass `type: "json"`/`"pretty"` to also inspect formatted lines.
 *
 * - {@link mockLogger} returns a {@link MockLogger} whose seven level methods (`silly` … `fatal`) are
 *   recorders: every call is captured (level + args) and forwarded to the real pipeline, so you can assert
 *   `mock.silly.mock.calls` / `mock.calls` consola-style without wiring up a transport.
 *
 * @example
 * import { createTestLogger } from "tslog/testing";
 *
 * const { logger, logs, lines, clear } = createTestLogger({ minLevel: "INFO" });
 * logger.warn("disk almost full", { pct: 92 });
 * expect(logs).toHaveLength(1);
 * expect(logs[0]._meta.logLevelName).toBe("WARN");
 * clear();
 * expect(logs).toHaveLength(0);
 *
 * @example
 * import { mockLogger } from "tslog/testing";
 *
 * const log = mockLogger();
 * log.info("hi", 1);
 * expect(log.info.calls).toEqual([["hi", 1]]);
 * expect(log.calls).toEqual([{ level: "info", args: ["hi", 1] }]);
 */

/** The seven default level names, lower-cased — the method set shared by {@link Logger} and {@link MockLogger}. */
const LEVEL_NAMES = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;

/** One of the seven default level method names (`"silly"` … `"fatal"`). */
export type TLevelMethodName = (typeof LEVEL_NAMES)[number];

/** A finished, meta-decorated record captured by {@link createTestLogger}. */
export type CapturedLog<LogObj> = LogObj & ILogObjMeta;

/**
 * What {@link createTestLogger} returns: a ready-to-use {@link Logger} plus the live capture buffers and a
 * reset. The `logs`/`lines` arrays are the same references across calls (so they may be captured once before
 * the logging happens); {@link clear} empties them in place without detaching the transport.
 */
export interface ITestLogger<LogObj> {
  /** A real logger with the in-memory capture transport already attached. Use it exactly like any logger. */
  logger: Logger<LogObj>;
  /** Captured structured records, oldest first — one per emitted log (at or above `minLevel`). */
  logs: CapturedLog<LogObj>[];
  /** The formatted string for each captured record, oldest first (JSON or pretty per the resolved `type`). */
  lines: string[];
  /** Empty both {@link logs} and {@link lines} in place (keeps the references stable). */
  clear(): void;
}

/** Options for {@link createTestLogger} beyond plain logger settings. */
export interface ITestLoggerOptions {
  /**
   * Per-logger test clock: called once per log to stamp `_meta.date` (and thus the JSON `time` /
   * pretty timestamp). May return a `Date` or epoch milliseconds. Unlike `vi.useFakeTimers()` this
   * freezes ONLY this logger's timestamps — interval-driven transports and user timers keep running.
   * Sugar for the `clock` setting (an explicit `settings.clock` wins).
   * @example createTestLogger({ type: "json" }, { now: () => new Date("2026-01-01T00:00:00Z") })
   */
  now?: () => Date | number;
  /**
   * Pin every machine-/run-varying meta field so `logs`/`lines` are snapshot-stable: the clock is
   * frozen at the epoch (unless {@link now}/`clock` is set), stack capture defaults off (no `path`),
   * and captured records/lines are stored as {@link normalizeMeta}-normalized COPIES (hostname →
   * `"<hostname>"`, runtimeVersion → `"<runtimeVersion>"`). The record other transports receive is untouched.
   * @example
   * const { logger, lines } = createTestLogger({ type: "json" }, { normalize: true });
   * logger.info("ready");
   * expect(lines[0]).toMatchSnapshot(); // stable across runs, machines, and runtimes
   */
  normalize?: boolean;
}

/**
 * Create a {@link Logger} wired to an in-memory transport that records every emitted log, for easy
 * assertions in tests. Returns the `logger` plus the captured `logs` (records) and `lines` (formatted
 * strings) and a `clear()` to reset between cases.
 *
 * `minLevel` is honored exactly as on a normal logger: calls below it are short-circuited before the
 * transport, so level filtering is reflected in `logs`/`lines`. Output defaults to `type: "hidden"` so the
 * test runner stays quiet; pass `{ type: "json" }` (or `"pretty"`) to also capture rendered `lines`.
 *
 * Pure: nothing global is mutated and importing this module performs no work.
 *
 * @param settings - optional logger settings, merged over the quiet (`type: "hidden"`) defaults.
 * @param options - deterministic-output helpers: a per-logger `now` clock and snapshot `normalize`.
 * @example
 * const { logger, logs, clear } = createTestLogger();
 * logger.info("ready");
 * expect(logs.at(-1)?._meta.logLevelName).toBe("INFO");
 *
 * @example
 * // Snapshot-stable lines: frozen clock, pinned hostname/runtimeVersion, no stack path.
 * const { logger, lines } = createTestLogger({ type: "json" }, { normalize: true });
 * logger.info("ready");
 * expect(lines[0]).toMatchSnapshot();
 */
export function createTestLogger<LogObj = ILogObj>(settings?: ISettingsParam<LogObj>, options?: ITestLoggerOptions): ITestLogger<LogObj> {
  const logs: CapturedLog<LogObj>[] = [];
  const lines: string[] = [];

  // Default to hidden so attaching a test logger never spams the runner; the transport still records
  // everything. The user may override `type` (e.g. "json") to also exercise the formatter via `lines`.
  const merged: ISettingsParam<LogObj> = { type: "hidden", ...settings };
  const now = options?.now;
  if (now != null && merged.clock == null) {
    merged.clock = (): Date => {
      const value = now();
      return value instanceof Date ? value : new Date(value);
    };
  }
  const normalize = options?.normalize === true;
  if (normalize) {
    // Deterministic at the SOURCE where possible: freeze the clock at the epoch and skip stack
    // capture (no churning `_meta.path`) unless the caller configured either explicitly.
    merged.clock = merged.clock ?? ((): Date => new Date(0));
    merged.stack = { capture: "off", ...settings?.stack };
  }
  const logger = new Logger<LogObj>(merged);
  const normalizeOptions: INormalizeMetaOptions = {
    metaProperty: logger.settings.meta.property,
    timeKey: logger.settings.json.timeKey,
  };

  logger.attachTransport({
    name: "tslog-test-capture",
    write(record: CapturedLog<LogObj>, line: string): void {
      if (normalize) {
        logs.push(normalizeMeta(record, normalizeOptions));
        lines.push(normalizeMeta(line, normalizeOptions));
      } else {
        logs.push(record);
        lines.push(line);
      }
    },
  });

  return {
    logger,
    logs,
    lines,
    clear(): void {
      logs.length = 0;
      lines.length = 0;
    },
  };
}

/** Options for {@link normalizeMeta}: the record's meta/time key names when they were reconfigured. */
export interface INormalizeMetaOptions {
  /** The runtime-meta property name (`meta.property` setting). Default `"_meta"`. */
  metaProperty?: string;
  /** The top-level time key of JSON lines (`json.timeKey` setting). Default `"time"`. */
  timeKey?: string;
}

/** The pinned timestamp emitted by {@link normalizeMeta} (the Unix epoch, ISO form). */
const NORMALIZED_TIME_ISO = "1970-01-01T00:00:00.000Z";

/** Matches an ISO-8601 UTC timestamp (the JSON `time`/`_meta.date` shape) inside a formatted line. */
const ISO_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;

/** Matches the default pretty template's timestamp (`yyyy.mm.dd hh:MM:ss:ms`). */
const PRETTY_TIMESTAMP_REGEX = /\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2}:\d{3}/g;

/** Matches the pretty transport-line timestamp (`yyyy-mm-dd hh:MM:ss.ms`, no `T`/`Z`). */
const PRETTY_DASH_TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/g;

/**
 * Pin the run-/machine-varying meta fields of a captured log so it can be snapshot-asserted:
 * `_meta.date` (and a JSON line's top-level time) → the Unix epoch, `hostname` → `"<hostname>"`,
 * `runtimeVersion` → `"<runtimeVersion>"`, and `_meta.path` (the churning code position) is removed.
 *
 * Accepts either a structured record (returns a shallow-cloned record with a cloned meta — the input
 * is never mutated) or a formatted line: a JSON line is parsed, normalized, and re-stringified
 * (preserving key order); a non-JSON (pretty) line gets a best-effort timestamp scrub for the ISO and
 * default-template shapes.
 *
 * @example
 * expect(normalizeMeta(lines[0])).toMatchSnapshot();
 * expect(normalizeMeta(record)._meta.hostname).toBe("<hostname>");
 */
export function normalizeMeta<T extends object>(input: T, options?: INormalizeMetaOptions): T;
export function normalizeMeta(input: string, options?: INormalizeMetaOptions): string;
export function normalizeMeta(input: object | string, options?: INormalizeMetaOptions): object | string {
  const metaProperty = options?.metaProperty ?? "_meta";
  const timeKey = options?.timeKey ?? "time";

  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return JSON.stringify(normalizeRecord(parsed as Record<string, unknown>, metaProperty, timeKey, true));
      }
    } catch {
      // not a JSON line — fall through to the pretty-line scrub
    }
    return input
      .replace(ISO_TIMESTAMP_REGEX, NORMALIZED_TIME_ISO)
      .replace(PRETTY_TIMESTAMP_REGEX, "1970.01.01 00:00:00:000")
      .replace(PRETTY_DASH_TIMESTAMP_REGEX, "1970-01-01 00:00:00.000");
  }
  return normalizeRecord(input as Record<string, unknown>, metaProperty, timeKey, false);
}

/** Shared normalization core: clone-and-pin a record (`isLine` = values came from a parsed JSON line). */
function normalizeRecord<T extends Record<string, unknown>>(record: T, metaProperty: string, timeKey: string, isLine: boolean): T {
  const clone: Record<string, unknown> = { ...record };
  // Only a parsed LINE carries the canonical top-level time; on a structured record a same-named
  // property would be a user field and is left alone.
  if (isLine && Object.hasOwn(clone, timeKey)) {
    const value = clone[timeKey];
    if (typeof value === "string" || typeof value === "number") {
      clone[timeKey] = NORMALIZED_TIME_ISO;
    }
  }
  const meta = clone[metaProperty];
  if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) {
    // The spread reads through the lazy `path` getter (fine in tests); `path` is then dropped.
    const metaClone: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
    if (Object.hasOwn(metaClone, "date")) {
      metaClone.date = isLine ? NORMALIZED_TIME_ISO : new Date(0);
    }
    if (Object.hasOwn(metaClone, "hostname")) {
      metaClone.hostname = "<hostname>";
    }
    if (Object.hasOwn(metaClone, "runtimeVersion")) {
      metaClone.runtimeVersion = "<runtimeVersion>";
    }
    delete metaClone.path;
    clone[metaProperty] = metaClone;
  }
  return clone as T;
}

/** A single recorded call on a {@link MockLogger}: which level method was invoked and with what arguments. */
export interface IMockCall {
  /** The level method name that was called (`"silly"` … `"fatal"`). */
  level: TLevelMethodName;
  /** The arguments passed to that call. */
  args: unknown[];
}

/**
 * A recorder bound to one level method of a {@link MockLogger}. It is callable (forwards to the real logger
 * and records the call) and additionally exposes the captured `calls`, a `mock.calls` alias for Jest/Vitest
 * familiarity, and a `mockClear()` that empties its own buffer.
 */
export interface MockLevelFn {
  (...args: unknown[]): void;
  /** Arguments of every call to this level method, oldest first. */
  calls: unknown[][];
  /** Jest/Vitest-style alias exposing the same `calls` array under `mock.calls`. */
  mock: { calls: unknown[][] };
  /** Empty this method's own {@link calls} buffer in place. */
  mockClear(): void;
}

/** The seven recording level methods of a {@link MockLogger}, keyed by lower-cased level name. */
export type MockLevelMethods = { [K in TLevelMethodName]: MockLevelFn };

/**
 * A {@link Logger} whose seven level methods are replaced by {@link MockLevelFn} recorders (consola's
 * `mockTypes` equivalent), plus aggregate `calls` across all levels and a `mockClear()` that resets them all.
 * Every recorder still forwards to the real pipeline, so transports/middleware run as usual.
 */
export type MockLogger<LogObj = ILogObj> = Logger<LogObj> &
  MockLevelMethods & {
    /** Every recorded call across all level methods, in invocation order. */
    calls: IMockCall[];
    /** Empty the aggregate {@link calls} and every per-method `calls` buffer in place. */
    mockClear(): void;
  };

/**
 * Create a {@link Logger} whose level methods (`silly` … `fatal`) are spies that record every call while
 * still forwarding to the real pipeline (consola's `mockTypes` equivalent). Each method exposes its own
 * `calls`/`mock.calls`; the logger exposes the aggregate `calls` and a `mockClear()` resetting everything.
 *
 * Defaults to `type: "hidden"` so the recorder is quiet; pass settings to override. Pure: no globals are
 * patched — only this returned instance's own methods are wrapped.
 *
 * @param settings - optional logger settings, merged over the quiet (`type: "hidden"`) defaults.
 * @example
 * const log = mockLogger({ minLevel: "DEBUG" });
 * log.warn("careful");
 * expect(log.warn.calls).toEqual([["careful"]]);
 * expect(log.calls).toEqual([{ level: "warn", args: ["careful"] }]);
 */
export function mockLogger<LogObj = ILogObj>(settings?: ISettingsParam<LogObj>): MockLogger<LogObj> {
  const logger = new Logger<LogObj>({ type: "hidden", ...settings }) as MockLogger<LogObj>;
  const calls: IMockCall[] = [];

  for (const level of LEVEL_NAMES) {
    // Keep a reference to the real method so the recorder still drives the full pipeline (and any attached
    // transports/middleware) rather than swallowing the call.
    const original = (logger[level] as (...args: unknown[]) => unknown).bind(logger);
    const perMethodCalls: unknown[][] = [];

    const recorder = ((...args: unknown[]): void => {
      perMethodCalls.push(args);
      calls.push({ level, args });
      original(...args);
    }) as MockLevelFn;

    recorder.calls = perMethodCalls;
    recorder.mock = { calls: perMethodCalls };
    recorder.mockClear = (): void => {
      perMethodCalls.length = 0;
    };

    // Replace the instance's own method (not the prototype) so only this mock is affected — no global mutation.
    (logger as unknown as Record<string, unknown>)[level] = recorder;
  }

  logger.calls = calls;
  logger.mockClear = (): void => {
    calls.length = 0;
    for (const level of LEVEL_NAMES) {
      (logger[level] as MockLevelFn).mockClear();
    }
  };

  return logger;
}

export { LogLevel };
export type { ILogObj, ILogObjMeta, IMeta, ISettingsParam, TLogLevelName };
