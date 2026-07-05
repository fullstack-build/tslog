import type { ILogObjMeta, TLogFormat, Transport } from "../../interfaces.js";
import { registerExitHook } from "../../internal/exitHooks.js";

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
  /** Per-attempt abort signal (set when the runtime supports `AbortSignal.timeout`). */
  signal?: unknown;
  /** Ask the runtime to let the request outlive the page (browser `fetch` keepalive). */
  keepalive?: boolean;
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
   * Custom body encoder for endpoints whose payload is neither NDJSON nor a plain JSON array — it
   * receives the batch's formatted lines and returns the request body plus its content-type (still
   * overridable via {@link headers}). Takes precedence over {@link bodyFormat}. Must not throw; a
   * throwing encoder fails the batch like a delivery error (reported via {@link onError}).
   * The OTLP pairing lives in `tslog/otel`: `encodeBody: otlpBatchBody` merges the batch into ONE
   * OTLP/JSON envelope so the transport can POST straight to a collector's `/v1/logs`.
   */
  encodeBody?: (lines: readonly string[]) => { body: string; contentType: string };
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
   * response — after all {@link retries} were exhausted, and when buffered lines are dropped because
   * {@link maxBufferedLines} was hit. Receives the error (a synthesized `Error` for a bad status or for
   * a drop report) and the lines involved (for throttled drop reports: the most recently dropped
   * line as a sample), so a caller can re-queue failed batches or count drops.
   */
  onError?: (error: unknown, lines: readonly string[]) => void;
  /**
   * Abort each request attempt after this many milliseconds (default `10000`), so one hung collector
   * connection can never stall the send chain — and with it every later batch and `flush()` — forever.
   * Requires `AbortSignal.timeout` (Node 18+, modern browsers/Deno/Bun); silently unbounded without it.
   * `<= 0` disables the timeout.
   */
  timeoutMs?: number;
  /** Re-attempt a failed batch this many times (default `2`) with exponential backoff before dropping it. */
  retries?: number;
  /** Base backoff delay in ms between attempts (default `250`; attempt n waits `retryBaseMs * 2^n` + jitter). */
  retryBaseMs?: number;
  /**
   * Upper bound for the in-memory buffer (default `10000` lines). When the collector is down long
   * enough to hit it, the OLDEST lines are dropped first and the drop is reported via {@link onError}.
   */
  maxBufferedLines?: number;
  /** Set `keepalive: true` on requests so a browser flush can outlive the page (64KB body cap applies). */
  keepalive?: boolean;
  /**
   * Register a guarded exit hook (default `true`) that flushes the buffer on Node `beforeExit` and on
   * browser `pagehide` (pair with {@link keepalive} there). Set `false` to manage draining yourself.
   */
  exitHooks?: boolean;
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
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries != null && options.retries >= 0 ? options.retries : 2;
  const retryBaseMs = options.retryBaseMs ?? 250;
  const maxBufferedLines = options.maxBufferedLines != null && options.maxBufferedLines > 0 ? options.maxBufferedLines : 10_000;
  const keepalive = options.keepalive;

  const buffer: string[] = [];
  let droppedTotal = 0;
  // A single pump loop drains the buffer batch-by-batch. Ordering is preserved (one send at a time),
  // and — unlike an unbounded promise chain of detached batches — at most ONE batch ever lives outside
  // `buffer`, so maxBufferedLines genuinely bounds memory while the collector is down.
  let pumping: Promise<void> = Promise.resolve();
  let pumpActive = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unregisterExitHook: (() => void) | null = null;
  // The drain trigger: a cap below the batch size must still drain (the old check could never fire).
  const drainThreshold = Math.min(batchSize, maxBufferedLines);

  /** A per-attempt abort signal, when the runtime can build one. */
  const attemptSignal = (): unknown => {
    if (timeoutMs <= 0) {
      return undefined;
    }
    const signalCtor = (globalThis as { AbortSignal?: { timeout?: (ms: number) => unknown } }).AbortSignal;
    return typeof signalCtor?.timeout === "function" ? signalCtor.timeout(timeoutMs) : undefined;
  };

  /**
   * Sleep between retry attempts (exponential backoff with jitter). The timer is deliberately REF'd:
   * an in-progress send is real, strictly bounded work (retries × (timeout + backoff)) that someone is
   * awaiting — an unref'd timer here let the process exit mid-backoff, silently dropping the batch and
   * leaving flush() forever unsettled. Only the background interval timer stays unref'd.
   */
  const backoff = (attempt: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, retryBaseMs * 2 ** attempt + Math.random() * retryBaseMs);
    });

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

  /**
   * POST one already-detached batch, retrying with backoff; resolves regardless of outcome (an
   * exhausted batch goes to {@link reportError} and is dropped). Each attempt is individually
   * time-bounded so a hung connection can never stall the chain.
   */
  const send = async (lines: readonly string[]): Promise<void> => {
    // Defensive: `send` is only called by `drainOnce` with `buffer.splice(0, batchSize)` inside a
    // `while (buffer.length > 0)` loop, so the batch is never empty in practice.
    /* v8 ignore next 3 -- unreachable, see comment above */
    if (lines.length === 0) {
      return;
    }
    let body: string;
    let contentType: string;
    try {
      ({ body, contentType } = options.encodeBody != null ? options.encodeBody(lines) : encodeBody(lines, bodyFormat));
    } catch (error) {
      // A throwing custom encoder is a delivery failure for THIS batch — report and drop, never
      // break the send chain.
      reportError(error, lines);
      return;
    }
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        await backoff(attempt - 1);
      }
      try {
        const init: HttpRequestInit = {
          method: "POST",
          headers: { "content-type": contentType, ...headers },
          body,
        };
        const signal = attemptSignal();
        if (signal != null) {
          init.signal = signal;
        }
        if (keepalive != null) {
          init.keepalive = keepalive;
        }
        const response = await fetchImpl(url, init);
        if (response.ok) {
          return;
        }
        lastError = new Error(`tslog httpTransport: POST ${url} responded ${response.status}`);
        // 4xx (except 408/429) will not get better on retry — fail fast and keep the chain moving.
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }
    reportError(lastError, lines);
  };

  /** Start (or join) the pump: sends batches until the buffer is empty, one batch at a time. */
  const drainOnce = (): Promise<void> => {
    if (!pumpActive && buffer.length > 0) {
      pumpActive = true;
      pumping = (async () => {
        try {
          while (buffer.length > 0) {
            const batch = buffer.splice(0, batchSize);
            await send(batch);
          }
        } finally {
          pumpActive = false;
        }
      })();
    }
    return pumping;
  };

  if (flushIntervalMs > 0) {
    timer = setInterval(() => {
      // Fire-and-forget: the timer never awaits, and send() never rejects.
      void drainOnce();
    }, flushIntervalMs);
    // Don't let the flush timer keep a Node/Deno/Bun process alive on its own.
    (timer as { unref?: () => void }).unref?.();
  }

  const transport: HttpTransport<LogObj> = {
    name: options.name ?? "http",
    format: options.format,
    write(_record: LogObj & ILogObjMeta, line: string): void {
      if (unregisterExitHook == null && options.exitHooks !== false) {
        unregisterExitHook = registerExitHook({ flushAsync: () => transport.flush?.() });
      }
      buffer.push(line);
      // Bounded memory while the collector is down: drop the OLDEST lines first and account for them.
      if (buffer.length > maxBufferedLines) {
        const dropped = buffer.shift();
        droppedTotal++;
        if (droppedTotal === 1 || droppedTotal % 1000 === 0) {
          reportError(
            new Error(`tslog httpTransport: buffer full (${maxBufferedLines}), dropped ${droppedTotal} lines so far`),
            // `dropped` is `buffer.shift()` guarded by `buffer.length > maxBufferedLines` (>= 1), so it is
            // always a string here; the `[]` fallback is defensive only.
            /* v8 ignore next -- `dropped` is never null under the length guard above */
            dropped != null ? [dropped] : [],
          );
        }
      }
      if (buffer.length >= drainThreshold) {
        void drainOnce();
      }
    },
    async flush(): Promise<void> {
      // The pump loops until the buffer is empty, so one await covers everything queued so far.
      await drainOnce();
    },
    async [Symbol.asyncDispose](): Promise<void> {
      if (timer != null) {
        clearInterval(timer);
        timer = undefined;
      }
      await drainOnce();
      // Only drop the exit-hook safety net once the drain has completed.
      unregisterExitHook?.();
      unregisterExitHook = null;
    },
  };
  return transport;
}
