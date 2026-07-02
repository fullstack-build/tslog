import type { ILogObjMeta, TLogFormat, Transport } from "../../interfaces.js";

/**
 * `tslog/transports/http` — a buffering HTTP transport (M2b).
 *
 * Collects the formatted log lines for a logger and POSTs them, in batches, to an HTTP endpoint via
 * the global `fetch`. It exists so an application can ship logs to a collector (Loki, an ingestion
 * gateway, a serverless log sink, …) without pulling in a runtime dependency: the only thing it needs
 * is a `fetch` implementation, which is built into modern Node/Deno/Bun/browsers and is injectable
 * (`fetchImpl`) for testing or for runtimes that expose `fetch` under a different name.
 *
 * Design:
 *  - **Buffering.** Each `write(record, line)` pushes the already-formatted `line` into an in-memory
 *    buffer (the core has already rendered the line using this transport's {@link Transport.format}).
 *    When the buffer reaches {@link IHttpTransportOptions.batchSize} a flush is scheduled; an optional
 *    {@link IHttpTransportOptions.flushIntervalMs} timer flushes time-bounded batches even when the
 *    batch size is never reached. The interval timer is `unref`'d where available so it never keeps a
 *    process alive on its own.
 *  - **Body shape.** The buffered lines are POSTed as NDJSON by default (one JSON object per line) or as
 *    a single JSON array when {@link IHttpTransportOptions.bodyFormat} is `"array"`.
 *  - **Isolation.** A failed request (network error, non-2xx response) is swallowed and reported via the
 *    optional {@link IHttpTransportOptions.onError} callback — it never throws back into `write`/`flush`
 *    and so never breaks logging or sibling transports. (The core also isolates transports, but this
 *    transport additionally keeps `flush()` resolving even when the request fails.)
 *
 * No import-time side effects: this module only declares functions/consts; the timer and the buffer are
 * created when {@link httpTransport} is called.
 *
 * @module subpaths/transports/http
 */

/** A minimal structural `fetch` signature — enough to POST a body and inspect the response status. */
export type FetchLike = (input: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

/** The subset of `RequestInit` this transport sets. */
export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** The subset of the `fetch` `Response` this transport reads. */
export interface HttpResponseLike {
  ok: boolean;
  status: number;
}

/** How the buffered lines are encoded into the request body. */
export type HttpBodyFormat = "ndjson" | "array";

export interface IHttpTransportOptions<LogObj> {
  /** Absolute endpoint the batched logs are POSTed to. */
  url: string;
  /**
   * Extra request headers merged over the defaults. The transport sets `content-type` itself
   * (`application/x-ndjson` for NDJSON, `application/json` for the array body) unless you override it here.
   */
  headers?: Record<string, string>;
  /**
   * Flush automatically once this many records are buffered. Default `100`. A value `<= 1` flushes on
   * every record (no batching).
   */
  batchSize?: number;
  /**
   * Flush at most this often (ms) even if {@link batchSize} is never reached, so low-volume loggers still
   * deliver promptly. Omitted/`<= 0` → no timer (flush only on batch-size or an explicit {@link Transport.flush}).
   */
  flushIntervalMs?: number;
  /**
   * Per-transport output format, forwarded to the core so each buffered `line` is rendered with it.
   * Omitted → the line follows the logger's `type` (use `"json"` for a structured endpoint).
   */
  format?: TLogFormat<LogObj>;
  /**
   * Encode the buffered lines as newline-delimited JSON (`"ndjson"`, default) or as a single JSON array
   * (`"array"`). NDJSON suits log-ingestion endpoints; the array suits a plain JSON API.
   */
  bodyFormat?: HttpBodyFormat;
  /**
   * `fetch` implementation to use. Defaults to the global `fetch`. Inject this for tests, or for runtimes
   * that expose `fetch` under another binding. Throws at construction if neither is available.
   */
  fetchImpl?: FetchLike;
  /**
   * Optional human-readable transport name, surfaced in the core's diagnostics. Default `"http"`.
   */
  name?: string;
  /**
   * Invoked (never throwing) when a batch fails to deliver — a thrown/rejected request or a non-2xx
   * response. Receives the error (a synthesized `Error` for a bad status) and the lines that were in the
   * failed batch, so a caller can re-queue or count drops.
   */
  onError?: (error: unknown, lines: readonly string[]) => void;
}

/** A {@link Transport} extended with the HTTP-transport-specific surface (here just the standard shape). */
export type HttpTransport<LogObj> = Transport<LogObj>;

/**
 * Resolve the global `fetch` if present, else `undefined`. Read lazily (inside {@link httpTransport}) so
 * importing this module never touches the global and stays free of import-time side effects.
 */
function resolveGlobalFetch(): FetchLike | undefined {
  const candidate = (globalThis as { fetch?: unknown }).fetch;
  return typeof candidate === "function" ? (candidate as FetchLike) : undefined;
}

/** Encode buffered lines into the request body + the matching default content-type. */
function encodeBody(lines: readonly string[], bodyFormat: HttpBodyFormat): { body: string; contentType: string } {
  if (bodyFormat === "array") {
    // Each line is already a JSON document; join into a JSON array without re-stringifying.
    return { body: `[${lines.join(",")}]`, contentType: "application/json" };
  }
  return { body: lines.join("\n"), contentType: "application/x-ndjson" };
}

/**
 * Create a buffering HTTP {@link Transport} that POSTs batched log lines via `fetch`.
 *
 * Attach it with `logger.attachTransport(httpTransport({ url, format: "json" }))`. The transport buffers
 * each formatted line and flushes when {@link IHttpTransportOptions.batchSize} is reached, when the
 * optional {@link IHttpTransportOptions.flushIntervalMs} timer fires, when `logger.flush()` is called,
 * or on disposal. Delivery failures are isolated and reported via {@link IHttpTransportOptions.onError}.
 *
 * @param options - endpoint, batching, body shape, and the injectable `fetch`. See {@link IHttpTransportOptions}.
 * @returns a {@link Transport} with `write`, `flush`, and an async disposer.
 * @throws if no `fetchImpl` is given and the runtime has no global `fetch`.
 *
 * @example
 * const detach = logger.attachTransport(
 *   httpTransport({ url: "https://logs.example.com/ingest", format: "json", batchSize: 50, flushIntervalMs: 2000 }),
 * );
 */
export function httpTransport<LogObj>(options: IHttpTransportOptions<LogObj>): HttpTransport<LogObj> {
  const fetchImpl = options.fetchImpl ?? resolveGlobalFetch();
  if (fetchImpl == null) {
    throw new Error("tslog httpTransport: no fetch implementation available — pass `fetchImpl` or run on a runtime with a global `fetch`.");
  }

  const url = options.url;
  const headers = options.headers ?? {};
  const batchSize = options.batchSize != null && options.batchSize > 0 ? options.batchSize : 100;
  const flushIntervalMs = options.flushIntervalMs ?? 0;
  const bodyFormat: HttpBodyFormat = options.bodyFormat ?? "ndjson";
  const onError = options.onError;

  let buffer: string[] = [];
  // Serialize sends so two flushes never race on the same buffer slice and ordering is preserved.
  let inFlight: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;

  const reportError = (error: unknown, lines: readonly string[]): void => {
    if (onError == null) {
      return;
    }
    try {
      onError(error, lines);
    } catch {
      // A failing error callback must never escape the transport.
    }
  };

  /** POST one already-detached batch; resolves regardless of outcome (errors go to {@link reportError}). */
  const send = async (lines: readonly string[]): Promise<void> => {
    if (lines.length === 0) {
      return;
    }
    const { body, contentType } = encodeBody(lines, bodyFormat);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": contentType, ...headers },
        body,
      });
      if (!response.ok) {
        reportError(new Error(`tslog httpTransport: POST ${url} responded ${response.status}`), lines);
      }
    } catch (error) {
      reportError(error, lines);
    }
  };

  /** Detach the current buffer and chain a send onto the in-flight tail so sends stay ordered. */
  const drainOnce = (): Promise<void> => {
    if (buffer.length === 0) {
      return inFlight;
    }
    const batch = buffer;
    buffer = [];
    inFlight = inFlight.then(() => send(batch));
    return inFlight;
  };

  if (flushIntervalMs > 0) {
    timer = setInterval(() => {
      // Fire-and-forget: the timer never awaits, and send() never rejects.
      void drainOnce();
    }, flushIntervalMs);
    // Don't let the flush timer keep a Node/Deno/Bun process alive on its own.
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    name: options.name ?? "http",
    format: options.format,
    write(_record: LogObj & ILogObjMeta, line: string): void {
      buffer.push(line);
      if (buffer.length >= batchSize) {
        void drainOnce();
      }
    },
    async flush(): Promise<void> {
      // Drain whatever is buffered, then await the full in-flight chain (including any concurrent send).
      await drainOnce();
      await inFlight;
    },
    async [Symbol.asyncDispose](): Promise<void> {
      if (timer != null) {
        clearInterval(timer);
        timer = undefined;
      }
      await drainOnce();
      await inFlight;
    },
  };
}
