import { getSpreadShapeHint } from "../../core/logObj.js";
import type { IErrorObject, ILogObjMeta, IMeta, ISettings, LogFormatter, LogMiddleware } from "../../interfaces.js";

/**
 * `presets/otel.ts` → `tslog/otel`
 *
 * Shape tslog records for OpenTelemetry — without taking a hard dependency on any OpenTelemetry SDK.
 * The module is pure (no import-time side effects) and runtime-agnostic. It has TWO output shapes:
 *
 *  - **OTLP/JSON** ({@link otlpFormat} / {@link toOtlpJson} / {@link toOtlpLogRecord}): the actual
 *    collector wire format — camelCase proto3-JSON log records (`timeUnixNano`, `severityNumber`,
 *    `body: { stringValue }`, typed `attributes`) inside the `resourceLogs[].scopeLogs[].logRecords[]`
 *    envelope. THIS is what a collector's `otlphttp` receiver (`http://collector:4318/v1/logs`)
 *    accepts; pair it with `tslog/transports/http` via {@link otlpBatchBody}.
 *  - **Data-model prose shape** ({@link otelFormat} / {@link toOtelRecord}): the abstract field names
 *    from the logs data-model spec (`Timestamp`, `SeverityNumber`, `Body`, ...). This is NOT a wire
 *    format — no collector ingests it directly; it suits custom pipelines that want a readable,
 *    spec-vocabulary record.
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
 * ## Usage — ship straight to an OTel collector (OTLP/JSON)
 * ```ts
 * import { Logger } from "tslog";
 * import { otlpFormat, otlpBatchBody } from "tslog/otel";
 * import { httpTransport } from "tslog/transports/http";
 *
 * const logger = new Logger({ type: "hidden" });
 * logger.attachTransport(
 *   httpTransport({
 *     url: "http://collector:4318/v1/logs",
 *     format: otlpFormat({ resource: { "service.name": "checkout" } }),
 *     encodeBody: otlpBatchBody, // merge the batch into ONE OTLP envelope per POST
 *   }),
 * );
 * ```
 *
 * ## Usage — data-model shape for a custom pipeline
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
   * Fixed resource attributes (e.g. `service.name`, `deployment.environment`). In the OTLP shape they
   * land in the envelope's `resource.attributes` — SEPARATE from per-record attributes, as the spec
   * requires. In the legacy data-model shape (which has no envelope) they are merged into `Attributes`
   * and, being resource identity, WIN over a colliding per-record field.
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

/** Serialized-error check usable before `looksLikeErrorObject` is defined (hoisted fn, same shape rule). */
function isPlainErrorLike(value: object): boolean {
  const candidate = value as Record<string, unknown>;
  return candidate.nativeError instanceof Error && typeof candidate.name === "string" && Array.isArray(candidate.stack);
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

  // The two field-spreading call shapes — pino object-first (`log.info({fields}, "msg")`) and
  // message-first (`log.info("msg", {fields})`) — are recognized via the SPREAD_SHAPE_HINT that
  // toLogObj stamps on the record, EXACTLY like the JSON renderer: shape-sniffing the numeric keys
  // would spread a single logged object that merely looks pino-ish, and would miss the message-first
  // form (leaving a numeric "1" attribute key in OTel output).
  if (!Object.hasOwn(attributes, messageKey)) {
    const spreadShape = getSpreadShapeHint(record as Record<string, unknown>);
    if (spreadShape !== undefined) {
      const fieldsKey = spreadShape === "object-first" ? "0" : "1";
      const bodyKey = spreadShape === "object-first" ? "1" : "0";
      const fields = attributes[fieldsKey];
      if (typeof fields === "object" && fields !== null && !Array.isArray(fields) && !isPlainErrorLike(fields)) {
        const body = attributes[bodyKey];
        delete attributes["0"];
        delete attributes["1"];
        for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
          if (k !== "__proto__" && !Object.hasOwn(attributes, k)) {
            attributes[k] = v;
          }
        }
        return { body, attributes };
      }
    }
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
 * Build an {@link OtelLogRecord} — the data-model PROSE shape (`Timestamp`/`Body`/...), for custom
 * pipelines — from a finished tslog `record` (the output of the core pipeline: user fields + the
 * `_logMeta` block) and the resolved `settings`. Pure; never mutates `record`. NOT collector-ingestible:
 * for OTLP/JSON use {@link toOtlpLogRecord} / {@link toOtlpJson}.
 *
 * @example
 * const otel = toOtelRecord(record, logger.settings, { getSpanContext });
 */
export function toOtelRecord<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>, options: OtelFormatOptions = {}): OtelLogRecord {
  const meta = record[settings.meta.property] as unknown as IMeta | undefined;
  const { body, attributes } = splitBodyAndAttributes(record, settings);

  // Resource identity outranks a colliding per-record field (it describes the EMITTER, not the event).
  const mergedAttributes: Record<string, unknown> = options.resource != null ? { ...attributes, ...options.resource } : attributes;

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
 * strings and dropping `undefined` Body/values. NOTE: the RECORD is the data-model prose shape, not
 * OTLP/JSON — only the bigint-as-string encoding matches OTLP's int64 rule. For collector-ingestible
 * output use {@link stringifyOtlpRequest} / {@link otlpFormat} instead.
 */
export function stringifyOtelRecord(record: OtelLogRecord): string {
  return JSON.stringify(record, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

/**
 * A {@link LogFormatter} factory producing one DATA-MODEL-shaped JSON line per log (the prose field
 * names, for custom pipelines — collectors reject this; use {@link otlpFormat} for them). Reuses
 * `json.messageKey`/`meta.property` from the logger settings to split Body vs. Attributes.
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

/* ------------------------------------------------------------------------------------------------ */
/* OTLP/JSON — the collector wire format                                                             */
/* ------------------------------------------------------------------------------------------------ */

/**
 * A proto3-JSON `AnyValue` (opentelemetry/proto/common/v1/common.proto): exactly one member is set.
 * `intValue` is a STRING because proto3 JSON encodes int64 as a decimal string.
 */
export interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string;
  doubleValue?: number;
  arrayValue?: { values: OtlpAnyValue[] };
  kvlistValue?: { values: OtlpKeyValue[] };
}

/** A proto3-JSON `KeyValue` pair — the element type of OTLP attribute lists. */
export interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

/**
 * A proto3-JSON OTLP `LogRecord` (opentelemetry/proto/logs/v1/logs.proto) — what a collector's
 * `otlphttp` receiver actually parses. Field names are camelCase; the two timestamps are int64
 * nanosecond strings; `traceId`/`spanId` are lowercase hex.
 */
export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano?: string;
  severityNumber: number;
  severityText: string;
  body?: OtlpAnyValue;
  attributes?: OtlpKeyValue[];
  droppedAttributesCount?: number;
  traceId?: string;
  spanId?: string;
  /** W3C trace flags (proto field `flags`). */
  flags?: number;
}

/** The `ExportLogsServiceRequest` envelope POSTed to a collector's `/v1/logs`. */
export interface OtlpExportLogsRequest {
  resourceLogs: {
    resource: { attributes: OtlpKeyValue[] };
    scopeLogs: {
      scope: { name: string; version?: string };
      logRecords: OtlpLogRecord[];
    }[];
  }[];
}

/** Options for the OTLP shape ({@link toOtlpLogRecord} / {@link toOtlpJson} / {@link otlpFormat}). */
export interface OtlpFormatOptions extends OtelFormatOptions {
  /**
   * The instrumentation scope name stamped on the envelope. Per the logs spec the scope is meant to
   * identify the emitting logger; default `"tslog"`. A named tslog logger additionally carries its
   * name as the `logger.name` record attribute (scope is per-envelope, records may mix loggers).
   */
  scopeName?: string;
  /** Optional instrumentation scope version stamped on the envelope. */
  scopeVersion?: string;
}

/**
 * Lowercase-hex-normalize a trace/span id and validate its length: OTLP requires lowercase hex of
 * exactly 32 (traceId) / 16 (spanId) chars, and a single malformed id would get the WHOLE envelope
 * rejected by the collector — dropping the id keeps the log deliverable.
 */
function normalizeHexId(value: unknown, length: number): string | undefined {
  if (typeof value !== "string" || value.length !== length) {
    return undefined;
  }
  const lowered = value.toLowerCase();
  for (let i = 0; i < lowered.length; i++) {
    const code = lowered.charCodeAt(i);
    const isHex = (code >= 48 && code <= 57) || (code >= 97 && code <= 102);
    if (!isHex) {
      return undefined;
    }
  }
  return lowered;
}

/** Guarded read of an own string property from a possibly hostile object. */
function safeStringProp(obj: object, key: string): string | undefined {
  try {
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert an arbitrary logged value into a proto3-JSON {@link OtlpAnyValue}. Total: hostile getters,
 * circular structures, bigints, and non-JSON types all degrade to honest string forms rather than
 * throwing out of the log call.
 */
export function toOtlpAnyValue(value: unknown, ancestors: WeakSet<object> = new WeakSet()): OtlpAnyValue {
  switch (typeof value) {
    case "string":
      return { stringValue: value };
    case "boolean":
      return { boolValue: value };
    case "number":
      if (!Number.isFinite(value)) {
        // Deliberate divergence: proto3 JSON encodes non-finite doubles as the strings "NaN"/
        // "Infinity" INSIDE doubleValue; we emit a stringValue instead so lenient backends that
        // parse doubleValue as a number never receive an unrepresentable value.
        return { stringValue: String(value) };
      }
      return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value };
    case "bigint":
      return { intValue: value.toString() };
    case "undefined":
      return {};
    case "function":
    case "symbol":
      return { stringValue: String(value) };
    default:
      break;
  }
  if (value === null) {
    return {};
  }
  const obj = value as object;
  if (ancestors.has(obj)) {
    return { stringValue: "[Circular]" };
  }
  if (obj instanceof Date) {
    return { stringValue: Number.isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString() };
  }
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) {
      return { arrayValue: { values: obj.map((item) => toOtlpAnyValue(item, ancestors)) } };
    }
    if (obj instanceof Error) {
      const values: OtlpKeyValue[] = [
        { key: "name", value: { stringValue: safeStringProp(obj, "name") ?? "Error" } },
        { key: "message", value: { stringValue: safeStringProp(obj, "message") ?? "" } },
      ];
      const stack = safeStringProp(obj, "stack");
      if (stack !== undefined) {
        values.push({ key: "stack", value: { stringValue: stack } });
      }
      return { kvlistValue: { values } };
    }
    let keys: string[];
    try {
      keys = Object.keys(obj);
    } catch {
      return { stringValue: "[unserializable]" };
    }
    const values: OtlpKeyValue[] = [];
    for (const key of keys) {
      let item: unknown;
      try {
        item = (obj as Record<string, unknown>)[key];
      } catch {
        continue; // a throwing getter skips that entry, keeps the rest
      }
      values.push({ key, value: toOtlpAnyValue(item, ancestors) });
    }
    return { kvlistValue: { values } };
  } finally {
    ancestors.delete(obj);
  }
}

/** Convert a flat attribute bag into an OTLP attribute list, skipping nothing (undefined → empty AnyValue). */
function toOtlpAttributes(bag: Record<string, unknown>): OtlpKeyValue[] {
  const out: OtlpKeyValue[] = [];
  for (const key of Object.keys(bag)) {
    out.push({ key, value: toOtlpAnyValue(bag[key]) });
  }
  return out;
}

/** The serialized-IErrorObject shape check, duplicated from render/json (no cross-import: subpaths stay leaf-only). */
function looksLikeErrorObject(value: unknown): value is IErrorObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.nativeError instanceof Error && typeof candidate.name === "string" && Array.isArray(candidate.stack);
}

/** Best-effort raw stack STRING for one error, preferring the native `Error#stack`. */
function ownStackString(error: IErrorObject): string | undefined {
  const native = error.nativeError;
  if (native != null) {
    const stack = safeStringProp(native, "stack");
    if (stack !== undefined) {
      return stack;
    }
  }
  if (!Array.isArray(error.stack) || error.stack.length === 0) {
    return undefined;
  }
  return error.stack
    .map(
      (frame) =>
        `    at ${frame.method ?? "<anonymous>"} (${frame.fullFilePath ?? frame.filePath ?? "unknown"}:${frame.fileLine ?? "0"}:${frame.fileColumn ?? "0"})`,
    )
    .join("\n");
}

/**
 * The `exception.stacktrace` string: the error's own stack followed by Java-style `Caused by:`
 * sections for the serialized `cause` chain, so the chain survives into OTel (backends show it the
 * way they show JVM traces). Depth-capped as defense-in-depth against hand-built structures.
 */
function errorStackString(error: IErrorObject): string | undefined {
  const sections: string[] = [];
  const own = ownStackString(error);
  if (own !== undefined) {
    sections.push(own);
  }
  let cause = error.cause;
  for (let depth = 0; cause != null && depth < 8; depth++) {
    if (!looksLikeErrorObject(cause)) {
      sections.push(`Caused by: ${stringifyFallbackSafe(cause)}`);
      break;
    }
    const header = `Caused by: ${cause.name}${cause.message ? `: ${cause.message}` : ""}`;
    const causeStack = ownStackString(cause);
    sections.push(causeStack !== undefined ? `${header}\n${causeStack}` : header);
    cause = cause.cause;
  }
  return sections.length > 0 ? sections.join("\n") : undefined;
}

/** Total stringify for an unknown cause value (hostile toString tolerated). */
function stringifyFallbackSafe(value: unknown): string {
  try {
    return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/** Compact JSON-safe form for errors beyond the first (no native handle, string stack, cause kept). */
function compactError(error: IErrorObject, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: error.message };
  const stack = ownStackString(error);
  if (stack !== undefined) {
    out.stack = stack;
  }
  if (error.cause != null && depth < 8) {
    out.cause = looksLikeErrorObject(error.cause) ? compactError(error.cause, depth + 1) : stringifyFallbackSafe(error.cause);
  }
  return out;
}

/**
 * Build a proto3-JSON {@link OtlpLogRecord} from a finished tslog `record`. Splits Body vs. attributes
 * with the same rules as {@link toOtelRecord}, then:
 *
 *  - a logged Error under `json.errorKey` becomes the semconv `exception.type` /
 *    `exception.message` / `exception.stacktrace` attributes (what error-tracking backends key on);
 *    additional errors in the same record stay under the error key as a generic value;
 *  - a named logger is carried as the `logger.name` attribute;
 *  - trace correlation comes from {@link OtelFormatOptions.getSpanContext}, falling back to
 *    `trace_id`/`span_id` fields stashed on `_logMeta` (e.g. by {@link otelTraceContext});
 *  - `options.resource` is NOT merged here — it belongs to the envelope ({@link toOtlpJson}).
 */
export function toOtlpLogRecord<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>, options: OtlpFormatOptions = {}): OtlpLogRecord {
  const meta = record[settings.meta.property] as unknown as IMeta | undefined;
  const { body, attributes } = splitBodyAndAttributes(record, settings);

  const out: OtlpLogRecord = {
    timeUnixNano: toEpochNanos(meta?.date).toString(),
    severityNumber: meta != null ? levelToSeverityNumber(meta.logLevelId) : OtelSeverityNumber.UNSPECIFIED,
    severityText: meta?.logLevelName ?? "",
  };
  if (options.observedTimestamp !== false) {
    out.observedTimeUnixNano = out.timeUnixNano;
  }
  if (body !== undefined) {
    out.body = toOtlpAnyValue(body);
  }

  // OTLP requires UNIQUE attribute keys; reserved keys (logger.name, exception.*) are pushed first
  // and win over a colliding user field, mirroring the JSON renderer's canonical-wins policy.
  const attributeList: OtlpKeyValue[] = [];
  const usedKeys = new Set<string>();
  const pushAttribute = (key: string, value: OtlpAnyValue): void => {
    if (usedKeys.has(key)) {
      return;
    }
    usedKeys.add(key);
    attributeList.push({ key, value });
  };
  if (typeof meta?.name === "string") {
    pushAttribute("logger.name", { stringValue: meta.name });
  }
  // Map the FIRST logged error onto the exception.* semantic conventions (what error-tracking
  // backends key on); any further errors are kept — compacted — under json.errorKey so nothing is
  // dropped. On the RAW record errors sit under their positional keys (errorKey nesting is a
  // render-time concern), so error-shaped VALUES are detected wherever they are; a lone logged error
  // (`logger.error(err)`) is spread across the record itself and handled first.
  let exceptionMapped = false;
  const extraErrors: IErrorObject[] = [];
  const mapError = (error: IErrorObject): void => {
    if (exceptionMapped) {
      extraErrors.push(error);
      return;
    }
    exceptionMapped = true;
    pushAttribute("exception.type", { stringValue: error.name });
    pushAttribute("exception.message", { stringValue: error.message });
    const stack = errorStackString(error);
    if (stack !== undefined) {
      pushAttribute("exception.stacktrace", { stringValue: stack });
    }
  };

  const recordIsSpreadError = looksLikeErrorObject(attributes);
  if (recordIsSpreadError) {
    // A lone logged error is spread across the record; its `message` key doubles as the messageKey,
    // so splitBodyAndAttributes promoted it to Body — put it back for the exception.* mapping.
    const spreadError = attributes as unknown as IErrorObject;
    /* v8 ignore next -- toErrorObject always emits a string message (possibly promoted to Body, in which case body IS that string); the "" arm guards hand-built direct inputs */
    const promotedBody = typeof body === "string" ? body : "";
    const messageText = typeof spreadError.message === "string" ? spreadError.message : promotedBody;
    mapError({ ...spreadError, message: messageText });
  }
  for (const key of Object.keys(attributes)) {
    // The spread error's own members are fully represented by the exception.* attributes.
    if (recordIsSpreadError && (key === "nativeError" || key === "name" || key === "message" || key === "stack" || key === "cause")) {
      continue;
    }
    const value = attributes[key];
    if (looksLikeErrorObject(value)) {
      mapError(value);
      continue;
    }
    if (Array.isArray(value) && value.length > 0 && value.every((item) => looksLikeErrorObject(item))) {
      for (const item of value) {
        mapError(item as IErrorObject);
      }
      continue;
    }
    pushAttribute(key, toOtlpAnyValue(value));
  }
  if (extraErrors.length > 0) {
    // Compact form (no native handle, string stack, cause chain kept) — the first error owns the
    // semconv slots.
    pushAttribute(settings.json.errorKey, toOtlpAnyValue(extraErrors.map((error) => compactError(error))));
  }
  if (attributeList.length > 0) {
    out.attributes = attributeList;
  }

  // Trace correlation: the injected getter wins; _logMeta trace_id/span_id (middleware-stashed, e.g. by
  // otelTraceContext) are the fallback.
  let span: OtelSpanContext | undefined;
  if (typeof options.getSpanContext === "function") {
    try {
      span = options.getSpanContext();
    } catch {
      span = undefined;
    }
  }
  const metaBag = meta as unknown as Record<string, unknown> | undefined;
  const traceId = normalizeHexId(span?.traceId ?? metaBag?.trace_id, 32);
  const spanId = normalizeHexId(span?.spanId ?? metaBag?.span_id, 16);
  if (traceId !== undefined) {
    out.traceId = traceId;
  }
  if (spanId !== undefined) {
    out.spanId = spanId;
  }
  if (typeof span?.traceFlags === "number") {
    out.flags = span.traceFlags;
  }

  return out;
}

/**
 * Wrap one or more finished tslog records in the OTLP `ExportLogsServiceRequest` envelope —
 * `resourceLogs[].scopeLogs[].logRecords[]` with `options.resource` as the (separate) resource
 * attributes and `options.scopeName` (default `"tslog"`) as the instrumentation scope. The returned
 * object `JSON.stringify`s to a body a collector's `/v1/logs` accepts.
 */
export function toOtlpJson<LogObj>(
  records: (LogObj & ILogObjMeta) | (LogObj & ILogObjMeta)[],
  settings: ISettings<LogObj>,
  options: OtlpFormatOptions = {},
): OtlpExportLogsRequest {
  const list = Array.isArray(records) ? records : [records];
  const scope: { name: string; version?: string } = { name: options.scopeName ?? "tslog" };
  if (options.scopeVersion != null) {
    scope.version = options.scopeVersion;
  }
  return {
    resourceLogs: [
      {
        resource: { attributes: options.resource != null ? toOtlpAttributes(options.resource) : [] },
        scopeLogs: [
          {
            scope,
            logRecords: list.map((record) => toOtlpLogRecord(record, settings, options)),
          },
        ],
      },
    ],
  };
}

/** JSON-stringify an {@link OtlpExportLogsRequest} (plain JSON — the int64s are already strings). */
export function stringifyOtlpRequest(request: OtlpExportLogsRequest): string {
  return JSON.stringify(request);
}

/**
 * A {@link LogFormatter} producing ONE complete OTLP/JSON envelope per log line. Each line alone is a
 * valid `/v1/logs` body; for batched delivery pair it with `tslog/transports/http` and
 * {@link otlpBatchBody}, which merges a batch of these lines into a single envelope per POST.
 *
 * @example
 * logger.attachTransport(httpTransport({
 *   url: "http://collector:4318/v1/logs",
 *   format: otlpFormat({ resource: { "service.name": "checkout" } }),
 *   encodeBody: otlpBatchBody,
 * }));
 */
export function otlpFormat<LogObj>(options: OtlpFormatOptions = {}): LogFormatter<LogObj> {
  return (record, settings) => stringifyOtlpRequest(toOtlpJson(record, settings, options));
}

/**
 * Merge a batch of {@link otlpFormat}-produced lines (each a single-record OTLP envelope) into ONE
 * `ExportLogsServiceRequest` body with `content-type: application/json` — the `encodeBody` companion
 * for `tslog/transports/http`. All lines of a batch come from the same formatter, so the first line's
 * resource/scope represent the whole batch; a non-OTLP line (foreign formatter) fails the batch
 * loudly (the transport reports it via `onError`) instead of shipping a corrupt envelope.
 */
export function otlpBatchBody(lines: readonly string[]): { body: string; contentType: string } {
  const merged: OtlpLogRecord[] = [];
  let first: OtlpExportLogsRequest | undefined;
  for (const line of lines) {
    const parsed = JSON.parse(line) as OtlpExportLogsRequest;
    const scopeLogs = parsed?.resourceLogs?.[0]?.scopeLogs?.[0];
    if (scopeLogs == null || !Array.isArray(scopeLogs.logRecords)) {
      throw new Error("tslog otlpBatchBody: line is not a single-record OTLP envelope (use format: otlpFormat(...) on this transport)");
    }
    first ??= parsed;
    merged.push(...scopeLogs.logRecords);
  }
  if (first == null) {
    return { body: JSON.stringify({ resourceLogs: [] }), contentType: "application/json" };
  }
  first.resourceLogs[0].scopeLogs[0].logRecords = merged;
  return { body: JSON.stringify(first), contentType: "application/json" };
}
