import type { IErrorObject, ILogObjMeta, IMeta, ISettings, LogFormatter, Transport } from "../../interfaces.js";
import { toFlatJsonObject } from "../../render/json.js";

/**
 * `presets/pino.ts` — a {@link LogFormatter} that renders tslog records as **pino-shaped NDJSON**.
 *
 * [pino](https://getpino.io) is the de-facto structured-logging format for the Node ecosystem; most
 * log shippers, dashboards, and the `pino-pretty` CLI understand it natively. This preset lets a tslog
 * logger emit lines a pino consumer can read without translation, while keeping tslog as the producer.
 *
 * ## Emitted shape
 *
 * ```jsonc
 * {
 *   "level": 30,                       // pino NUMERIC level (see mapping below)
 *   "time": 1751191872000,             // epoch milliseconds by default (ISO string with `time: "iso"`)
 *   "pid": 4242,                       // optional, when discoverable + enabled
 *   "hostname": "host",                // optional, from _meta.hostname when enabled
 *   "msg": "user logged in",           // the message, from `messageKey`
 *   "userId": 42,                      // the user's own logged fields, spread at the top level
 *   "err": { ... }                     // any logged Error(s), under `errorKey`
 * }
 * ```
 *
 * The runtime `_meta` block tslog normally nests is intentionally dropped: pino keeps `level`/`time`/
 * `pid`/`hostname` at the top level and nothing else, so the output stays a clean drop-in.
 *
 * ## Level mapping (tslog 0-6 → pino 10-60)
 *
 * | tslog                | id | pino level | pino name |
 * | -------------------- | -- | ---------- | --------- |
 * | `SILLY`              | 0  | `10`       | trace     |
 * | `TRACE`              | 1  | `10`       | trace     |
 * | `DEBUG`              | 2  | `20`       | debug     |
 * | `INFO`               | 3  | `30`       | info      |
 * | `WARN`               | 4  | `40`       | warn      |
 * | `ERROR`              | 5  | `50`       | error     |
 * | `FATAL`              | 6  | `60`       | fatal     |
 *
 * pino has no dedicated `silly`, so tslog's `SILLY`(0) and `TRACE`(1) both map onto pino `trace`(10).
 * Custom/unknown level ids are snapped to the nearest standard pino bucket (clamped to 10…60).
 *
 * @example Attach as a transport (recommended)
 * ```ts
 * import { Logger } from "tslog";
 * import { pinoTransport } from "tslog/presets/pino";
 *
 * const log = new Logger({ type: "hidden" });
 * log.attachTransport(pinoTransport((line) => process.stdout.write(line + "\n")));
 * log.info({ userId: 42 }, "user logged in");
 * // {"level":30,"time":1751191872000,"pid":4242,"hostname":"host","msg":"user logged in","userId":42}
 * ```
 *
 * @example Use the formatter directly on a transport
 * ```ts
 * log.attachTransport({ format: pinoFormat(), write: (_record, line) => sink(line) });
 * ```
 */

/** Options for {@link pinoFormat}. */
export interface PinoFormatOptions {
  /**
   * How the `time` field is rendered.
   * - `"epoch"` (default): epoch **milliseconds** as a number, matching pino's default `Date.now()` time.
   * - `"iso"`: an ISO-8601 string (matches pino configured with `timestamp: pino.stdTimeFunctions.isoTime`).
   */
  time?: "epoch" | "iso";
  /**
   * Whether to include `pid` (the OS process id) when it is discoverable via `globalThis.process.pid`.
   * Default `true`. Has no effect in runtimes without a `process` (browser/edge), where it is simply omitted.
   */
  pid?: boolean;
  /**
   * Whether to include `hostname`. When `true` (default) the value is taken from `_meta.hostname`
   * (populated by tslog's environment detection on server runtimes); omitted when unavailable.
   */
  hostname?: boolean;
  /** Top-level key for the message. Default `"msg"` (pino's convention). */
  messageKey?: string;
  /** Top-level key under which logged errors are serialized. Default `"err"` (pino's convention). */
  errorKey?: string;
}

/** Resolved {@link PinoFormatOptions} with every field defaulted. */
type ResolvedPinoOptions = Required<PinoFormatOptions>;

/** pino's numeric level values, keyed by the canonical pino name. */
const PINO_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

/** The standard pino numeric buckets, ascending — used to snap unknown level ids to the nearest bucket. */
const PINO_BUCKETS: readonly number[] = [10, 20, 30, 40, 50, 60];

/**
 * Map a tslog level id (0-6, or a custom id) to a pino numeric level (10-60).
 *
 * The canonical seven map directly (`SILLY`/`TRACE` → `10`, then `+10` per step up to `FATAL` → `60`).
 * Any other id is snapped to the nearest standard pino bucket and clamped to the `10…60` range so a
 * custom level still produces a valid pino line.
 *
 * @param tslogLevelId - the tslog numeric level id (e.g. `3` for INFO).
 * @returns the pino numeric level (one of `10,20,30,40,50,60`).
 *
 * @example
 * toPinoLevel(0); // 10 (SILLY → trace)
 * toPinoLevel(3); // 30 (INFO)
 * toPinoLevel(6); // 60 (FATAL)
 */
export function toPinoLevel(tslogLevelId: number): number {
  switch (tslogLevelId) {
    case 0:
    case 1:
      return PINO_LEVELS.trace;
    case 2:
      return PINO_LEVELS.debug;
    case 3:
      return PINO_LEVELS.info;
    case 4:
      return PINO_LEVELS.warn;
    case 5:
      return PINO_LEVELS.error;
    case 6:
      return PINO_LEVELS.fatal;
    default: {
      // Custom/unknown id: project tslog's 0-6 scale onto pino's 10-60 (level*10, offset for the
      // shared trace floor) and snap to the nearest standard bucket, clamped to [10, 60].
      const projected = tslogLevelId * 10;
      let nearest = PINO_BUCKETS[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const bucket of PINO_BUCKETS) {
        const distance = Math.abs(bucket - projected);
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = bucket;
        }
      }
      return nearest;
    }
  }
}

/** Fill in defaults for the user-supplied {@link PinoFormatOptions}. */
function resolveOptions(opts?: PinoFormatOptions): ResolvedPinoOptions {
  return {
    time: opts?.time ?? "epoch",
    pid: opts?.pid ?? true,
    hostname: opts?.hostname ?? true,
    messageKey: opts?.messageKey ?? "msg",
    errorKey: opts?.errorKey ?? "err",
  };
}

/** Best-effort, runtime-agnostic read of the current process id; `undefined` when unavailable. */
function readPid(): number | undefined {
  const proc = (globalThis as { process?: { pid?: unknown } }).process;
  const pid = proc?.pid;
  return typeof pid === "number" ? pid : undefined;
}

/**
 * Create a pino-shaped NDJSON {@link LogFormatter}.
 *
 * The returned formatter is pure: given a finished tslog record (user fields + `_meta`) and the live
 * settings, it returns a single JSON line (no trailing newline) in pino's shape. Attach it as a
 * transport's `format`, or use the convenience {@link pinoTransport}.
 *
 * It reuses tslog's own {@link toFlatJsonObject} to lift the message and spread the user's fields /
 * errors to the top level, then rewrites the head keys (`level`, `time`, `pid`, `hostname`, `msg`,
 * `err`) into pino's representation and drops the tslog `_meta` block.
 *
 * @param opts - see {@link PinoFormatOptions}.
 * @returns a {@link LogFormatter} producing pino-shaped NDJSON.
 *
 * @example
 * const log = new Logger({ type: "hidden" });
 * log.attachTransport({ format: pinoFormat({ time: "iso" }), write: (_r, line) => sink(line) });
 */
export function pinoFormat<LogObj>(opts?: PinoFormatOptions): LogFormatter<LogObj> {
  const resolved = resolveOptions(opts);

  return (record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): string => {
    const meta = record[settings.meta.property] as unknown as IMeta | undefined;
    const flat = toFlatJsonObject(record, settings);
    const metaProperty = settings.meta.property;

    // Pull tslog's well-known head keys out of the flat object so we can re-emit them pino-style and
    // drop the rest of tslog's meta scaffolding (the nested _meta block, the level NAME, the levelId).
    const tslogMessageKey = settings.json.messageKey;
    const tslogTimeKey = settings.json.timeKey;
    const tslogLevelKey = settings.json.levelKey;
    const tslogLevelIdKey = settings.json.levelIdKey;
    const tslogErrorKey = settings.json.errorKey;

    const message = flat[tslogMessageKey];
    const errorValue = flat[tslogErrorKey] as IErrorObject | IErrorObject[] | undefined;
    const hasMessage = Object.hasOwn(flat, tslogMessageKey);
    const hasError = Object.hasOwn(flat, tslogErrorKey);

    // Build the pino line head-first: level, time, pid, hostname, msg — then the user's fields, then err.
    const out: Record<string, unknown> = {};
    out.level = toPinoLevel(meta?.logLevelId ?? -1);
    if (meta?.date instanceof Date) {
      out.time = resolved.time === "iso" ? meta.date.toISOString() : meta.date.getTime();
    } else if (meta?.date != null) {
      out.time = meta.date;
    }
    if (resolved.pid) {
      const pid = readPid();
      if (pid !== undefined) {
        out.pid = pid;
      }
    }
    if (resolved.hostname && typeof meta?.hostname === "string") {
      out.hostname = meta.hostname;
    }
    if (hasMessage) {
      out[resolved.messageKey] = message;
    }

    // The user's own fields: everything in `flat` except tslog's head keys and its meta block.
    for (const key of Object.keys(flat)) {
      if (
        key === tslogMessageKey ||
        key === tslogTimeKey ||
        key === tslogLevelKey ||
        key === tslogLevelIdKey ||
        key === tslogErrorKey ||
        key === metaProperty
      ) {
        continue;
      }
      out[key] = flat[key];
    }

    if (hasError) {
      out[resolved.errorKey] = errorValue;
    }

    return safeStringify(out);
  };
}

/**
 * A ready-made {@link Transport} that formats every log as pino NDJSON and hands the line to `sink`.
 *
 * The `sink` receives one pino-shaped line per log (without a trailing newline — add one for true
 * NDJSON, e.g. `process.stdout.write(line + "\n")`). Errors are isolated by the logger's transport
 * runner; this helper performs no I/O of its own.
 *
 * @param sink - receives each formatted pino line.
 * @param opts - see {@link PinoFormatOptions}.
 * @returns a {@link Transport} whose `format` is {@link pinoFormat} and whose `write` calls `sink`.
 *
 * @example
 * log.attachTransport(pinoTransport((line) => process.stdout.write(line + "\n")));
 */
export function pinoTransport<LogObj>(sink: (line: string) => void, opts?: PinoFormatOptions): Transport<LogObj> {
  return {
    name: "pino",
    format: pinoFormat<LogObj>(opts),
    write(_record: LogObj & ILogObjMeta, line: string): void {
      sink(line);
    },
  };
}

/**
 * Circular-/bigint-/undefined-safe JSON stringify mirroring tslog's core JSON renderer, so a pino line
 * never throws on a circular field and native `Error` handles do not serialize as `{}`.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, function (this: unknown, _key: string, val: unknown): unknown {
    if (typeof val === "bigint") {
      return `${val}`;
    }
    if (typeof val === "undefined") {
      return "[undefined]";
    }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) {
        return "[Circular]";
      }
      seen.add(val);
      if (val instanceof Error) {
        return undefined;
      }
    }
    return val;
  });
}
