import type { ILogObjMeta, IMeta, ISettings, LogFormatter, LogMiddleware } from "../../interfaces.js";

/**
 * `presets/otel.ts` → `tslog/otel`
 *
 * Shape tslog records as **OpenTelemetry log records** for ingestion by OTel collectors, the OTLP
 * exporter, or any backend that speaks the OTel logs data model — without taking a hard dependency on
 * any OpenTelemetry SDK. The module is pure (no import-time side effects) and runtime-agnostic.
 *
 * The OTel logs data model (https://opentelemetry.io/docs/specs/otel/logs/data-model/) defines:
 *  - `Timestamp`            — event time, **nanoseconds since the Unix epoch** (a `bigint` here).
 *  - `ObservedTimestamp`    — when the log was observed; we mirror `Timestamp` (same wall clock).
 *  - `SeverityNumber`       — an integer 1-24 (see {@link OtelSeverityNumber}).
 *  - `SeverityText`         — the original level name (e.g. `"INFO"`, `"WARN"`).
 *  - `Body`                 — the log message (a string, or the structured value logged).
 *  - `Attributes`           — the user's structured fields (everything that is not message/level/time).
 *  - `TraceId` / `SpanId`   — correlation with the active span, injected from an optional context getter.
 *
 * ## Level → SeverityNumber mapping
 * tslog's 7 default levels map onto the OTel severity ranges as follows:
 *
 * | tslog level | id | OTel SeverityNumber  | value |
 * |-------------|----|----------------------|-------|
 * | SILLY       | 0  | TRACE                | 1     |
 * | TRACE       | 1  | TRACE2               | 2     |
 * | DEBUG       | 2  | DEBUG                | 5     |
 * | INFO        | 3  | INFO                 | 9     |
 * | WARN        | 4  | WARN                 | 13    |
 * | ERROR       | 5  | ERROR                | 17    |
 * | FATAL       | 6  | FATAL                | 21    |
 *
 * `SILLY` (the most verbose, below TRACE) maps to OTel `TRACE` (1); `TRACE` maps to `TRACE2` (2), so the
 * two finest tslog levels remain distinguishable inside the OTel `TRACE` band (1-4). Unknown/custom level
 * ids fall back to the nearest band by magnitude (see {@link levelToSeverityNumber}).
 *
 * ## Usage — as a transport formatter
 * ```ts
 * import { Logger } from "tslog";
 * import { otelFormat } from "tslog/otel";
 *
 * const logger = new Logger();
 * logger.attachTransport({
 *   format: otelFormat({ getSpanContext: () => myTracer.activeContext() }),
 *   write: (_record, line) => otlpQueue.push(line),
 * });
 * ```
 *
 * ## Usage — as a record builder (middleware-free)
 * ```ts
 * import { toOtelRecord } from "tslog/otel";
 * const record = toOtelRecord(finishedLogRecord, logger.settings, { getSpanContext });
 * // -> { Timestamp, SeverityNumber, SeverityText, Body, Attributes, TraceId?, SpanId? }
 * ```
 */

/** Nanoseconds per millisecond — `Date.getTime()` is ms, OTel `Timestamp` is ns. */
const NANOS_PER_MILLI = 1_000_000n;

/**
 * The subset of OTel `SeverityNumber` values the default tslog levels map onto. The full enum runs 1-24
 * across the TRACE/DEBUG/INFO/WARN/ERROR/FATAL bands (4 steps each); these are the canonical mid-band
 * values plus `TRACE2` so SILLY and TRACE stay distinct.
 *
 * @see https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 */
export enum OtelSeverityNumber {
  UNSPECIFIED = 0,
  TRACE = 1,
  TRACE2 = 2,
  DEBUG = 5,
  INFO = 9,
  WARN = 13,
  ERROR = 17,
  FATAL = 21,
}

/** Fixed map from the 7 default tslog level ids to their OTel `SeverityNumber`. */
const LEVEL_ID_TO_SEVERITY: Readonly<Record<number, OtelSeverityNumber>> = Object.freeze({
  0: OtelSeverityNumber.TRACE, // SILLY
  1: OtelSeverityNumber.TRACE2, // TRACE
  2: OtelSeverityNumber.DEBUG, // DEBUG
  3: OtelSeverityNumber.INFO, // INFO
  4: OtelSeverityNumber.WARN, // WARN
  5: OtelSeverityNumber.ERROR, // ERROR
  6: OtelSeverityNumber.FATAL, // FATAL
});

/**
 * The active span correlation ids, as returned by a caller-supplied {@link OtelFormatOptions.getSpanContext}.
 * Mirrors `@opentelemetry/api`'s `SpanContext` shape loosely so a real OTel `trace.getActiveSpan()?.spanContext()`
 * can be passed straight through, but the field names match the OTel **log record** keys we emit.
 */
export interface OtelSpanContext {
  /** Lowercase hex trace id (16 bytes / 32 chars). Emitted as `TraceId`. */
  traceId?: string;
  /** Lowercase hex span id (8 bytes / 16 chars). Emitted as `SpanId`. */
  spanId?: string;
  /** Optional W3C trace-flags byte (e.g. `1` for sampled). Emitted as `TraceFlags` when present. */
  traceFlags?: number;
}

/** Options for {@link otelFormat} / {@link toOtelRecord}. */
export interface OtelFormatOptions {
  /**
   * Optional getter returning the active span's correlation ids. Called once per log; if it returns a
   * context with a `traceId`/`spanId`, those are injected as `TraceId`/`SpanId` (and `TraceFlags` when
   * present). Wrap your OTel SDK here to avoid a hard dependency, e.g.
   * `() => trace.getActiveSpan()?.spanContext()`. A throwing or `undefined` getter is ignored.
   */
  getSpanContext?: () => OtelSpanContext | undefined;
  /**
   * Extra fixed attributes merged into every record's `Attributes` (e.g. `service.name`,
   * `deployment.environment`). User fields on the log win over these on key collision.
   */
  resource?: Record<string, unknown>;
  /**
   * Emit `ObservedTimestamp` (mirroring `Timestamp`) alongside `Timestamp`. Default `true`. Set `false`
   * if your downstream sets it itself.
   */
  observedTimestamp?: boolean;
}

/**
 * An OpenTelemetry-shaped log record. `Timestamp`/`ObservedTimestamp` are `bigint` nanoseconds; the rest
 * follow the OTel logs data-model field names. JSON-serializing this record turns the `bigint`s into
 * strings (JSON has no bigint) — exactly what OTLP/JSON expects for the 64-bit ns timestamps.
 */
export interface OtelLogRecord {
  /** Event time in nanoseconds since the Unix epoch. */
  Timestamp: bigint;
  /** Observation time in nanoseconds since the Unix epoch (mirrors `Timestamp`). */
  ObservedTimestamp?: bigint;
  /** Integer severity (1-24). */
  SeverityNumber: number;
  /** Original level name, e.g. `"INFO"`. */
  SeverityText: string;
  /** The message or structured value logged. */
  Body: unknown;
  /** The user's structured fields plus any `resource` attributes. */
  Attributes: Record<string, unknown>;
  /** Active trace id, when discoverable via `getSpanContext`. */
  TraceId?: string;
  /** Active span id, when discoverable via `getSpanContext`. */
  SpanId?: string;
  /** Active W3C trace flags, when provided. */
  TraceFlags?: number;
}

/**
 * Map a tslog numeric level id to an OTel `SeverityNumber`.
 *
 * The 7 default ids use the fixed {@link LEVEL_ID_TO_SEVERITY} table. Custom/unknown ids (M2.14) are
 * bucketed by magnitude into the nearest OTel band so they still land in a sensible severity range:
 * `< 1` → TRACE, `< 2` → DEBUG, `< 4` → INFO, `< 5` → WARN, `< 6` → ERROR, otherwise FATAL.
 *
 * @example levelToSeverityNumber(3); // OtelSeverityNumber.INFO (9)
 */
export function levelToSeverityNumber(logLevelId: number): OtelSeverityNumber {
  const fixed = LEVEL_ID_TO_SEVERITY[logLevelId];
  if (fixed !== undefined) {
    return fixed;
  }
  if (logLevelId < 1) {
    return OtelSeverityNumber.TRACE;
  }
  if (logLevelId < 2) {
    return OtelSeverityNumber.DEBUG;
  }
  if (logLevelId < 4) {
    return OtelSeverityNumber.INFO;
  }
  if (logLevelId < 5) {
    return OtelSeverityNumber.WARN;
  }
  if (logLevelId < 6) {
    return OtelSeverityNumber.ERROR;
  }
  return OtelSeverityNumber.FATAL;
}

/** Convert a `Date` (or its ms value) to nanoseconds since the Unix epoch as a `bigint`. */
function toEpochNanos(date: Date | number | undefined): bigint {
  const ms = date instanceof Date ? date.getTime() : typeof date === "number" ? date : Date.now();
  return BigInt(ms) * NANOS_PER_MILLI;
}

/** True for a plain object literal (not an array, Date, or other class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Split a finished tslog record into the OTel `Body` (the message) and `Attributes` (the user fields),
 * mirroring the conventions of `render/json.ts` so the OTel preset and the JSON renderer agree on what
 * the message is:
 *  - pino-style `log.info({ fields }, "msg")` lands as `{ "0": {fields}, "1": "msg" }` in the raw
 *    record: the trailing string becomes the Body and the object's fields spread into Attributes;
 *  - a value already stored under the configured `messageKey` is the Body;
 *  - otherwise the legacy index key `"0"` (a bare-string-first call) is the Body;
 *  - everything else (excluding the meta block) becomes an attribute.
 * When the record carries only positional/object fields and no clear message, `Body` is `undefined` and
 * all fields land in `Attributes`.
 */
function splitBodyAndAttributes<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): { body: unknown; attributes: Record<string, unknown> } {
  const metaProperty = settings.meta.property;
  const messageKey = settings.json.messageKey;
  const attributes: Record<string, unknown> = {};

  for (const key of Object.keys(record)) {
    if (key === metaProperty) {
      continue;
    }
    attributes[key] = (record as Record<string, unknown>)[key];
  }

  // pino-style `log.info({ fields }, "message")`: toLogObj buckets these as `{ "0": {fields}, "1": "msg" }`.
  // Promote the trailing string to Body and spread the leading object's fields into Attributes.
  if (!Object.hasOwn(attributes, messageKey) && isPlainObject(attributes["0"]) && typeof attributes["1"] === "string") {
    const leading = attributes["0"] as Record<string, unknown>;
    const body = attributes["1"];
    delete attributes["0"];
    delete attributes["1"];
    for (const [k, v] of Object.entries(leading)) {
      if (!Object.hasOwn(attributes, k)) {
        attributes[k] = v;
      }
    }
    return { body, attributes };
  }

  // A value under the configured messageKey is the Body.
  if (Object.hasOwn(attributes, messageKey)) {
    const body = attributes[messageKey];
    delete attributes[messageKey];
    return { body, attributes };
  }

  // Promote the legacy bare-string index key "0" to Body.
  if (Object.hasOwn(attributes, "0")) {
    const body = attributes["0"];
    delete attributes["0"];
    return { body, attributes };
  }

  return { body: undefined, attributes };
}

/**
 * Build an {@link OtelLogRecord} from a finished tslog `record` (the output of the core pipeline:
 * user fields + the `_meta` block) and the resolved `settings`. Pure; never mutates `record`.
 *
 * @example
 * const otel = toOtelRecord(record, logger.settings, { getSpanContext });
 */
export function toOtelRecord<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>, options: OtelFormatOptions = {}): OtelLogRecord {
  const meta = record[settings.meta.property] as unknown as IMeta | undefined;
  const { body, attributes } = splitBodyAndAttributes(record, settings);

  const mergedAttributes: Record<string, unknown> = options.resource != null ? { ...options.resource, ...attributes } : attributes;

  const timestamp = toEpochNanos(meta?.date);
  const out: OtelLogRecord = {
    Timestamp: timestamp,
    SeverityNumber: meta != null ? levelToSeverityNumber(meta.logLevelId) : OtelSeverityNumber.UNSPECIFIED,
    SeverityText: meta?.logLevelName ?? "",
    Body: body,
    Attributes: mergedAttributes,
  };

  if (options.observedTimestamp !== false) {
    out.ObservedTimestamp = timestamp;
  }

  // Inject trace correlation from the optional context getter. A throwing getter must never break logging.
  if (typeof options.getSpanContext === "function") {
    let span: OtelSpanContext | undefined;
    try {
      span = options.getSpanContext();
    } catch {
      span = undefined;
    }
    if (span != null) {
      if (typeof span.traceId === "string" && span.traceId.length > 0) {
        out.TraceId = span.traceId;
      }
      if (typeof span.spanId === "string" && span.spanId.length > 0) {
        out.SpanId = span.spanId;
      }
      if (typeof span.traceFlags === "number") {
        out.TraceFlags = span.traceFlags;
      }
    }
  }

  return out;
}

/**
 * JSON-stringify an {@link OtelLogRecord}, rendering the 64-bit `bigint` nanosecond timestamps as
 * strings (OTLP/JSON encodes 64-bit ints as strings) and dropping `undefined` Body/values.
 */
export function stringifyOtelRecord(record: OtelLogRecord): string {
  return JSON.stringify(record, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

/**
 * A {@link LogFormatter} factory producing one OTel-shaped JSON line per log, suitable as a transport
 * `format`. Reuses `json.messageKey`/`meta.property` from the logger settings to split Body vs. Attributes.
 *
 * @example
 * logger.attachTransport({ format: otelFormat({ getSpanContext }), write: (_r, line) => sink(line) });
 */
export function otelFormat<LogObj>(options: OtelFormatOptions = {}): LogFormatter<LogObj> {
  return (record, settings) => stringifyOtelRecord(toOtelRecord(record, settings, options));
}

/**
 * A {@link LogMiddleware} that stashes the active trace/span ids on `ctx.meta` (under `trace_id`/`span_id`)
 * so any downstream formatter can pick them up — handy when you do not control the transport's `format`
 * but still want correlation fields available on the context. Never throws on a failing getter.
 *
 * @example logger.use(otelTraceContext({ getSpanContext }));
 */
export function otelTraceContext<LogObj>(options: Pick<OtelFormatOptions, "getSpanContext">): LogMiddleware<LogObj> {
  return (ctx) => {
    if (typeof options.getSpanContext !== "function") {
      return ctx;
    }
    let span: OtelSpanContext | undefined;
    try {
      span = options.getSpanContext();
    } catch {
      span = undefined;
    }
    if (span?.traceId) {
      ctx.meta.trace_id = span.traceId;
    }
    if (span?.spanId) {
      ctx.meta.span_id = span.spanId;
    }
    return ctx;
  };
}
