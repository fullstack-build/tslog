import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ILogObjMeta, LogFormatter, Transport } from "../../interfaces.js";

/**
 * `tslog/transports/file` — a **Node-only** {@link Transport} that appends each log line to a file
 * via a `node:fs` write stream (M2 subpath).
 *
 * Writes never block the event loop: {@link fileTransport.write} hands the line to the stream's
 * internal buffer (`stream.write(...)`) and returns synchronously. When the OS buffer fills, the
 * transport tracks the back-pressure `drain` event so {@link FileTransport.flush} resolves only once
 * everything queued has actually been handed to the kernel. {@link FileTransport.[Symbol.asyncDispose]}
 * flushes and then closes the stream, so `await using` (or the logger's own disposal) releases the
 * file descriptor cleanly.
 *
 * Rotation is intentionally **not** built in. Compose a rotating stream instead — point the transport
 * at one and tslog will keep enqueuing lines while the external library handles size/time rollover:
 *
 * ```ts
 * import { createStream } from "rotating-file-stream";
 * import { fileTransport } from "tslog/transports/file";
 *
 * const rotating = createStream("app.log", { size: "10M", interval: "1d", compress: "gzip" });
 * const transport = fileTransport({ stream: rotating, format: "json" });
 * logger.attachTransport(transport);
 * ```
 *
 * This module imports `node:fs`/`node:path` (allowed for a Node-only transport) and has **no
 * import-time side effects** — the stream is opened lazily on the first write (or first flush/dispose),
 * so merely importing the module touches no filesystem.
 *
 * @module subpaths/transports/file
 */

/** A minimal structural view of the `node:fs` `WriteStream` surface this transport relies on. */
interface WritableLike {
  write(chunk: string, callback?: (error?: Error | null) => void): boolean;
  once(event: "drain" | "error" | "close", listener: (...args: unknown[]) => void): unknown;
  end(callback?: () => void): unknown;
  readonly writableNeedDrain?: boolean;
  readonly writableEnded?: boolean;
}

/** Options for {@link fileTransport}. Either a destination `path` or a pre-built `stream` is required. */
export interface FileTransportOptions<LogObj> {
  /**
   * Filesystem path to append log lines to. The parent directory is created (recursively) on the first
   * write if it does not exist. Mutually exclusive with {@link stream}; one of the two is required.
   * @example { path: "./logs/app.log" }
   */
  path?: string;
  /**
   * A pre-constructed writable stream to write lines to — the composition seam for rotation
   * (e.g. `rotating-file-stream`). When supplied, {@link path}/{@link append}/{@link encoding} are
   * ignored and the transport never opens a stream of its own; on dispose it `end()`s this stream.
   * @example { stream: createStream("app.log", { size: "10M" }) }
   */
  stream?: WritableLike;
  /**
   * Per-transport output format passed straight through to the {@link Transport.format} field, so a
   * file sink can emit JSON while the console stays pretty. Omitted → follows the logger's `type`.
   * @example { format: "json" }
   */
  format?: "pretty" | "json" | LogFormatter<LogObj>;
  /** Append to the file (default `true`) instead of truncating it on open. Ignored when {@link stream} is given. */
  append?: boolean;
  /** Text encoding for the opened file stream (default `"utf8"`). Ignored when {@link stream} is given. */
  encoding?: BufferEncoding;
  /** Optional transport name surfaced in tslog's diagnostics when a write/flush throws. Default `"file"`. */
  name?: string;
  /** Per-transport minimum level; this sink only receives logs at or above it. See {@link Transport.minLevel}. */
  minLevel?: Transport<LogObj>["minLevel"];
  /** Line terminator appended after every formatted line (default `"\n"`). Set `""` to write lines verbatim. */
  eol?: string;
}

/**
 * The concrete {@link Transport} returned by {@link fileTransport}. The extra members beyond the
 * `Transport` contract are exposed so callers can drive the stream directly in tests/teardown.
 */
export interface FileTransport<LogObj> extends Transport<LogObj> {
  /** Resolve once every queued line has been handed to the kernel (back-pressure drained). */
  flush(): Promise<void>;
  /** Flush, then close the stream and release the file descriptor. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Create a Node-only file {@link Transport} that appends each formatted log line to a file (or a
 * supplied rotating stream) without ever blocking the event loop.
 *
 * @param options - {@link FileTransportOptions}; supply `path` (the transport opens/creates the file
 *   lazily) **or** `stream` (a pre-built writable, e.g. a rotating-file-stream, for composition).
 * @returns a {@link FileTransport} ready for `logger.attachTransport(...)`.
 * @throws {TypeError} when neither `path` nor `stream` is provided.
 *
 * @example
 * const fileLog = fileTransport({ path: "./logs/app.log", format: "json", minLevel: "WARN" });
 * const detach = logger.attachTransport(fileLog);
 * // ... later, before exit:
 * await fileLog.flush();
 * await fileLog[Symbol.asyncDispose]();
 */
export function fileTransport<LogObj = unknown>(options: FileTransportOptions<LogObj>): FileTransport<LogObj> {
  if (options.path == null && options.stream == null) {
    throw new TypeError("fileTransport: either `path` or `stream` is required");
  }

  const eol = options.eol ?? "\n";
  const append = options.append ?? true;
  const encoding = options.encoding ?? "utf8";

  // The live stream and a one-shot promise that opens it (mkdir parent + createWriteStream). Both stay
  // null until the first write/flush/dispose so importing or constructing the transport touches no IO.
  let stream: WritableLike | null = options.stream ?? null;
  let opening: Promise<WritableLike> | null = null;
  let closed = false;

  // Pending writes whose `write()` callback (or `error` event) has not yet fired. `flush()` awaits the
  // current set; this is what makes flush "drain" rather than merely resolve immediately.
  const inflight = new Set<Promise<void>>();

  async function ensureStream(): Promise<WritableLike> {
    if (stream != null) {
      return stream;
    }
    if (opening == null) {
      const filePath = options.path as string;
      opening = (async () => {
        await mkdir(dirname(filePath), { recursive: true });
        const created = createWriteStream(filePath, { flags: append ? "a" : "w", encoding }) as unknown as WriteStream & WritableLike;
        stream = created;
        return created;
      })();
    }
    return opening;
  }

  /** Write one chunk, returning a promise that settles when the kernel has accepted it (or it errors). */
  function writeChunk(target: WritableLike, chunk: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // The write callback fires once the chunk has been flushed to the underlying resource; this is the
      // signal flush() needs. Errors are surfaced via the callback's first argument and via "error".
      target.write(chunk, (error?: Error | null) => {
        if (error != null) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /** Track a write promise in {@link inflight} so {@link flush} can await it; never reject the caller. */
  function track(promise: Promise<void>): void {
    const tracked = promise.then(
      () => {
        inflight.delete(tracked);
      },
      (error) => {
        inflight.delete(tracked);
        // Re-throw inside the tracked promise so flush()'s allSettled sees it, but isolate the write path:
        // the synchronous write() call must never break logging.
        throw error;
      },
    );
    inflight.add(tracked);
  }

  const transport: FileTransport<LogObj> = {
    name: options.name ?? "file",
    minLevel: options.minLevel,
    format: options.format,

    write(_record: LogObj & ILogObjMeta, line: string): void {
      if (closed) {
        return;
      }
      const chunk = line + eol;
      if (stream != null) {
        // Fast path: stream already open — enqueue synchronously, never awaiting in the log path.
        track(writeChunk(stream, chunk));
        return;
      }
      // First write (or while still opening): open the stream, then enqueue. The open+write is tracked as
      // one inflight promise so an early flush() still waits for this line.
      track(ensureStream().then((target) => writeChunk(target, chunk)));
    },

    async flush(): Promise<void> {
      // If a write is still opening the stream, awaiting the inflight set covers it. Snapshot the set so
      // writes that arrive mid-flush are not awaited forever in a single call.
      const pending = [...inflight];
      if (pending.length > 0) {
        await Promise.allSettled(pending);
      }
    },

    async [Symbol.asyncDispose](): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      // Drain anything queued before tearing the stream down.
      await transport.flush();
      // Nothing was ever opened (no writes, or only failed opens): nothing to close.
      if (stream == null) {
        return;
      }
      const target = stream;
      // Do not end a stream the caller owns past our use if it is already ended (rotating libs may close it).
      if (target.writableEnded === true) {
        return;
      }
      await new Promise<void>((resolve) => {
        target.end(() => resolve());
      });
    },
  };

  return transport;
}
