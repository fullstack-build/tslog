import type { ILogObjMeta, LogFormatter, TLogFormat, Transport, TransportFn } from "../interfaces.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";
import { resolveLogLevelId } from "./levels.js";

/**
 * Runtime that owns the attached-transport list: it normalizes the two accepted input shapes
 * (a full {@link Transport} or a bare {@link TransportFn}) into a uniform internal `Transport` list,
 * gates each transport by its own {@link Transport.minLevel}, selects each transport's
 * {@link Transport.format} (computing the formatted line lazily and sharing it across transports that
 * ask for the same format), runs every transport in `try/catch` isolation so one sink can never break
 * logging or its siblings, and flushes/disposes transports asynchronously.
 *
 * The {@link BaseLogger}/`Logger` use {@link attachTransport} (which returns a detach function),
 * {@link dispatchToTransports} (per `log()` call), and {@link flushAll} (for `logger.flush()` and the
 * logger's `[Symbol.asyncDispose]`).
 *
 * @module core/transports
 */

/**
 * Narrow an `attachTransport` input to a full {@link Transport}: a function input is a
 * {@link TransportFn}, anything else is assumed to be a `Transport` object.
 */
function isTransportFn<LogObj>(input: Transport<LogObj> | TransportFn<LogObj>): input is TransportFn<LogObj> {
  return typeof input === "function";
}

/**
 * Normalize an `attachTransport` input into a uniform internal {@link Transport}.
 *
 * A bare {@link TransportFn} is wrapped into a `Transport` whose {@link Transport.write} forwards the
 * `record` to the function (the formatted `line` is ignored) and which has no `flush`/disposer. A
 * `Transport` object is returned unchanged so its `name`, `minLevel`, `format`, `flush`, and
 * `[Symbol.asyncDispose]` are preserved.
 *
 * @example
 * normalizeTransport((record) => queue.push(record)); // -> { write(record) { queue.push(record); } }
 */
export function normalizeTransport<LogObj>(input: Transport<LogObj> | TransportFn<LogObj>): Transport<LogObj> {
  if (isTransportFn(input)) {
    const fn = input;
    return {
      write(record: LogObj & ILogObjMeta): void {
        fn(record);
      },
    };
  }
  return input;
}

/**
 * Resolve a transport's {@link Transport.minLevel} (a number or a level name) to a numeric id.
 * Returns `Number.NEGATIVE_INFINITY` when no `minLevel` is set so the transport receives everything.
 */
function resolveTransportMinLevel<LogObj>(transport: Transport<LogObj>): number {
  if (transport.minLevel == null) {
    return Number.NEGATIVE_INFINITY;
  }
  return resolveLogLevelId(transport.minLevel) ?? Number.NEGATIVE_INFINITY;
}

/**
 * Run a single transport in isolation: report-but-swallow any thrown error or rejected promise so a
 * failing sink never breaks logging or its siblings. Synchronous throws and async rejections are both
 * handled; the returned value is ignored by the caller.
 */
function runTransportIsolated<LogObj>(transport: Transport<LogObj>, record: LogObj & ILogObjMeta, line: string): void {
  try {
    const result = transport.write(record, line);
    if (result != null && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).then(undefined, (error) => reportTransportError(transport, error));
    }
  } catch (error) {
    reportTransportError(transport, error);
  }
}

/** Report a transport failure without ever throwing (a console that itself throws is tolerated). */
function reportTransportError<LogObj>(transport: Transport<LogObj>, error: unknown): void {
  try {
    const label = transport.name != null ? ` "${transport.name}"` : "";
    nativeConsoleMethod("error")(`tslog: attached transport${label} threw an error`, error);
    /* v8 ignore next 3 -- defensive: guards against a console.error implementation that itself throws */
  } catch {
    // ignore secondary failures while reporting the transport error
  }
}

/**
 * A function that turns a finished record into a formatted line for a given {@link TLogFormat}. The
 * caller (the logger/pipeline) supplies this so `core/transports.ts` stays decoupled from `render/*`;
 * it must accept the two built-in format strings (`"pretty"`, `"json"`) and a custom
 * {@link LogFormatter}, and return the line that the transport's {@link Transport.write} receives.
 *
 * @example
 * const resolve: FormatResolver<MyLog> = (record, format) =>
 *   format === "json" ? jsonRenderer(record) : prettyRenderer(record);
 */
export type FormatResolver<LogObj> = (record: LogObj & ILogObjMeta, format: TLogFormat<LogObj>) => string;

/**
 * Dispatch one finished log record to every attached transport.
 *
 * For each transport: skip it when `logLevelId` is below its resolved {@link Transport.minLevel};
 * otherwise resolve the line for its {@link Transport.format} (defaulting to the logger's `type`),
 * computing each distinct format **at most once per call** and sharing it across transports that ask
 * for the same format, then hand `(record, line)` to {@link runTransportIsolated}.
 *
 * The `defaultFormat` is the logger-wide format used when a transport sets no `format` of its own; for
 * `type: "hidden"` pass `"json"` (the structured record is still delivered to transports). Formatting
 * is fully lazy: when no transport passes its `minLevel`, `formatResolver` is never invoked.
 *
 * @param transports     The resolved internal transport list (already normalized via {@link normalizeTransport}).
 * @param record         The finished, meta-decorated log object.
 * @param logLevelId     The numeric level of this log, used for per-transport `minLevel` gating.
 * @param defaultFormat  The format used for transports that declare no `format`.
 * @param formatResolver Produces the formatted line for a given format (decouples this module from `render/*`).
 */
export function dispatchToTransports<LogObj>(
  transports: readonly Transport<LogObj>[],
  record: LogObj & ILogObjMeta,
  logLevelId: number,
  defaultFormat: TLogFormat<LogObj>,
  formatResolver: FormatResolver<LogObj>,
): void {
  if (transports.length === 0) {
    return;
  }

  // Cache lines by their resolved format so each distinct format is computed at most once per call and
  // shared across transports that request it. Custom LogFormatter functions key by identity.
  const lineByStringFormat = new Map<"pretty" | "json", string>();
  const lineByFormatterFn = new Map<LogFormatter<LogObj>, string>();

  const lineFor = (format: TLogFormat<LogObj>): string => {
    if (typeof format === "function") {
      const cached = lineByFormatterFn.get(format);
      if (cached !== undefined) {
        return cached;
      }
      const line = formatResolver(record, format);
      lineByFormatterFn.set(format, line);
      return line;
    }
    const cached = lineByStringFormat.get(format);
    if (cached !== undefined) {
      return cached;
    }
    const line = formatResolver(record, format);
    lineByStringFormat.set(format, line);
    return line;
  };

  for (const transport of transports) {
    if (logLevelId < resolveTransportMinLevel(transport)) {
      continue;
    }
    const format = transport.format ?? defaultFormat;
    runTransportIsolated(transport, record, lineFor(format));
  }
}

/**
 * Attach a transport to a logger's resolved transport list and return a detach function.
 *
 * The input is normalized via {@link normalizeTransport} (a bare {@link TransportFn} is wrapped) and
 * pushed onto `transports`. The returned `() => void` removes **that** transport instance (by
 * identity) on first call and is idempotent thereafter, so detaching twice is safe even if the list
 * was mutated in between.
 *
 * @example
 * const detach = attachTransport(logger.settings.attachedTransports, { name: "file", write });
 * // later:
 * detach(); // removes the transport; calling again is a no-op
 */
export function attachTransport<LogObj>(transports: Transport<LogObj>[], input: Transport<LogObj> | TransportFn<LogObj>): () => void {
  const normalized = normalizeTransport(input);
  transports.push(normalized);
  let detached = false;
  return () => {
    if (detached) {
      return;
    }
    detached = true;
    const index = transports.indexOf(normalized);
    if (index !== -1) {
      transports.splice(index, 1);
    }
  };
}

/**
 * Flush every transport that supports it, then run any async disposers, awaiting all of them.
 *
 * For each transport with a {@link Transport.flush}, its `flush()` is invoked; for each with a
 * {@link Transport.[Symbol.asyncDispose]}, its disposer is invoked. All resulting promises are awaited
 * together via `Promise.allSettled`, so one transport failing to flush/dispose never prevents the
 * others from completing and the overall promise never rejects. Transports without `flush`/disposer
 * (e.g. wrapped plain functions) are skipped.
 *
 * Used by `logger.flush()` (flush only) and the logger's own disposal (flush + dispose); pass
 * `dispose: true` to additionally invoke `[Symbol.asyncDispose]`.
 *
 * @example
 * await flushAll(logger.settings.attachedTransports);             // flush before exit
 * await flushAll(logger.settings.attachedTransports, true);       // flush + dispose
 */
export async function flushAll<LogObj>(transports: readonly Transport<LogObj>[], dispose = false): Promise<void> {
  if (transports.length === 0) {
    return;
  }
  const pending: Promise<unknown>[] = [];
  for (const transport of transports) {
    if (typeof transport.flush === "function") {
      pending.push(invokeIsolated(() => transport.flush?.(), transport));
    }
    if (dispose) {
      const disposer = transport[Symbol.asyncDispose];
      if (typeof disposer === "function") {
        pending.push(invokeIsolated(() => disposer.call(transport), transport));
      }
    }
  }
  if (pending.length > 0) {
    await Promise.allSettled(pending);
  }
}

/**
 * Invoke a flush/dispose callback, isolating synchronous throws into a rejected promise and reporting
 * any failure so {@link flushAll} can `allSettled` over the results without a single sink aborting it.
 */
function invokeIsolated<LogObj>(fn: () => Promise<void> | undefined, transport: Transport<LogObj>): Promise<unknown> {
  try {
    return Promise.resolve(fn()).catch((error) => reportTransportError(transport, error));
  } catch (error) {
    reportTransportError(transport, error);
    return Promise.resolve();
  }
}
