import { closeSync, createWriteStream, mkdirSync, openSync, type WriteStream, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ILogObjMeta, LogFormatter, Transport } from "../../interfaces.js";
import { registerExitHook } from "../../internal/exitHooks.js";
import { nativeConsoleMethod } from "../../internal/nativeConsole.js";

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
 * Failure semantics — a logging sink must NEVER take the process down:
 *  - Stream `error` events and write-callback errors (EACCES, ENOSPC, ENOTDIR, …) are contained and
 *    reported through {@link FileTransportOptions.onError} (default: one `console.error` per error
 *    burst — the report re-arms after a successful write). No unhandled rejection is ever produced.
 *  - A failed lazy open is retried on the next write, so a directory that appears later (or a disk
 *    that frees up) resumes logging without a restart.
 *
 * Exit semantics: lines are buffered in the stream, so a `process.exit(...)` or an uncaught exception
 * would normally lose the tail. The transport registers guarded exit hooks (opt out with
 * `exitHooks: false`): on `beforeExit` it flushes asynchronously; on `exit` it calls
 * {@link FileTransport.flushSync}, which synchronously writes the not-yet-confirmed lines with its
 * own file descriptor. The single line whose fs write is mid-syscall at that moment is skipped (the
 * stream writes serially, so there is at most one): rewriting it would deterministically duplicate it
 * on every `process.exit`, while skipping loses it only in the narrow window where the in-flight
 * kernel write also failed to complete. `flushSync` is exit-path machinery — while the process keeps
 * running, the stream remains the writer of record.
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
  on?(event: "drain" | "error" | "close", listener: (...args: unknown[]) => void): unknown;
  end(callback?: () => void): unknown;
  readonly writableNeedDrain?: boolean;
  readonly writableEnded?: boolean;
}

/** Where a contained file-transport failure occurred, passed to {@link FileTransportOptions.onError}. */
export type FileTransportErrorContext = "open" | "write" | "close";

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
  /**
   * Invoked (never throwing) when the sink fails: opening the file, an fs write error (disk full,
   * permissions), or closing. Defaults to one `console.error` per error burst; the default report
   * re-arms after the next successful write.
   */
  onError?: (error: unknown, context: FileTransportErrorContext) => void;
  /**
   * Register guarded process exit hooks (default `true`): an async flush on `beforeExit` and a
   * synchronous {@link FileTransport.flushSync} drain on `exit`, so `process.exit(...)`/crashes don't
   * lose the buffered tail. Set `false` to manage draining yourself.
   */
  exitHooks?: boolean;
}

/**
 * The concrete {@link Transport} returned by {@link fileTransport}. The extra members beyond the
 * `Transport` contract are exposed so callers can drive the stream directly in tests/teardown.
 */
export interface FileTransport<LogObj> extends Transport<LogObj> {
  /** Resolve once every queued line has been handed to the kernel (back-pressure drained). */
  flush(): Promise<void>;
  /**
   * Synchronously write the lines the stream has not confirmed yet, using a dedicated file
   * descriptor; the single possibly-mid-syscall line is skipped (see the module docs on exit
   * semantics). Exit-path machinery (`process.on("exit")`, uncaught-exception handlers). No-op for a
   * caller-supplied {@link FileTransportOptions.stream}.
   */
  flushSync(): void;
  /** Flush, then close the stream and release the file descriptor. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Create a Node-only file {@link Transport} that appends each formatted log line to a file (or a
 * supplied rotating stream) without ever blocking the event loop — and without ever crashing the
 * process on an fs error.
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
  const name = options.name ?? "file";
  const ownsStream = options.stream == null;

  // The live stream and a one-shot promise that opens it (mkdir parent + createWriteStream). Both stay
  // null until the first write/flush/dispose so importing or constructing the transport touches no IO.
  let stream: WritableLike | null = options.stream ?? null;
  let opening: Promise<WritableLike> | null = null;
  let closed = false;
  let unregisterExitHook: (() => void) | null = null;

  // One report per error burst: re-armed by the next successful write so a disk-full loop does not
  // emit one console line per log call.
  let errorReported = false;
  // Whether the CURRENT stream has completed at least one write (used to classify errors as
  // open-time vs write-time) and whether ANY stream ever opened (drives flushSync's truncation flag).
  let streamReady = false;
  let everOpened = false;

  function handleError(error: unknown, context: FileTransportErrorContext): void {
    if (options.onError != null) {
      try {
        options.onError(error, context);
      } catch {
        // a failing error callback must never escape the transport
      }
      return;
    }
    if (errorReported) {
      return;
    }
    errorReported = true;
    try {
      nativeConsoleMethod("error")(`tslog: file transport "${name}" ${context} failed`, error);
    } catch {
      // even the report must never throw into the pipeline
    }
  }

  // Chunks whose write has not been confirmed yet, in write order. `submitted` flips once the chunk
  // was handed to the stream (the stream writes serially, so among submitted entries only the FIRST
  // can be mid-syscall). This is what flush() awaits and what flushSync() rescues on the exit path.
  const unconfirmed = new Map<Promise<void>, { chunk: string; submitted: boolean }>();

  async function ensureStream(): Promise<WritableLike | null> {
    // Defensive: ensureStream is only ever called from write's slow path, which its own `stream != null`
    // guard enters only when `stream` is null; there is no await between that check and this call, so
    // `stream` cannot already be set on entry here.
    /* v8 ignore next 3 -- unreachable, see comment above */
    if (stream != null) {
      return stream;
    }
    if (opening == null) {
      const filePath = options.path as string;
      opening = (async () => {
        await mkdir(dirname(filePath), { recursive: true });
        const created = createWriteStream(filePath, { flags: append ? "a" : "w", encoding }) as unknown as WriteStream & WritableLike;
        // Without an `error` listener an async open failure (EACCES, ENOTDIR) is an uncaught
        // exception that kills the process — the one thing a logging sink must never do.
        (created.on ?? created.once).call(created, "error", (error: unknown) => {
          handleError(error, streamReady ? "write" : "open");
          if (stream === created) {
            // Abandon the broken stream AND the cached open, so the next write truly reopens.
            stream = null;
            opening = null;
            streamReady = false;
          }
        });
        stream = created;
        streamReady = false;
        everOpened = true;
        return created;
      })();
      opening = opening.catch((error) => {
        // Failed open: report, then reset so a later write retries (the directory may exist by then).
        handleError(error, "open");
        opening = null;
        return null as unknown as WritableLike;
      });
    }
    return opening;
  }

  /** Write one chunk, resolving when the kernel accepted it and reporting (never rejecting) on error. */
  function writeChunk(target: WritableLike, chunk: string): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        target.write(chunk, (error?: Error | null) => {
          if (error != null) {
            handleError(error, "write");
          } else {
            errorReported = false; // success re-arms the default one-per-burst report
            streamReady = true;
          }
          resolve();
        });
      } catch (error) {
        handleError(error, "write");
        resolve();
      }
    });
  }

  /** Track a chunk until its write settles so flush()/flushSync() can cover it. Never rejects. */
  function track(chunk: string, submitted: boolean, write: (entry: { chunk: string; submitted: boolean }) => Promise<void>): void {
    const entry = { chunk, submitted };
    let settled: Promise<void>;
    const done = (): void => {
      unconfirmed.delete(settled);
    };
    settled = write(entry).then(done, done);
    unconfirmed.set(settled, entry);
  }

  function ensureExitHook(): void {
    if (unregisterExitHook != null || options.exitHooks === false) {
      return;
    }
    unregisterExitHook = registerExitHook({
      drainSync: () => transport.flushSync(),
      flushAsync: () => transport.flush(),
    });
  }

  const transport: FileTransport<LogObj> = {
    name,
    minLevel: options.minLevel,
    format: options.format,

    write(_record: LogObj & ILogObjMeta, line: string): void {
      if (closed) {
        return;
      }
      ensureExitHook();
      const chunk = line + eol;
      if (stream != null) {
        // Fast path: stream already open — enqueue synchronously, never awaiting in the log path.
        const target = stream;
        track(chunk, true, () => writeChunk(target, chunk));
        return;
      }
      // First write (or while still opening): open the stream, then enqueue. The open+write is tracked as
      // one entry so an early flush()/flushSync() still covers this line. A failed open resolves to null
      // and leaves the chunk to flushSync (or the next successful open's retry of NEW lines). The entry
      // is marked `submitted` only when the chunk is actually handed to the opened stream.
      track(chunk, false, (entry) =>
        ensureStream().then((target) => {
          if (target == null) {
            return;
          }
          entry.submitted = true;
          return writeChunk(target, chunk);
        }),
      );
    },

    async flush(): Promise<void> {
      // Snapshot so writes that arrive mid-flush are not awaited forever in a single call. Entries
      // never reject (errors are contained in writeChunk), so a plain all() is safe.
      const pending = [...unconfirmed.keys()];
      if (pending.length > 0) {
        await Promise.all(pending);
      }
    },

    flushSync(): void {
      if (!ownsStream || unconfirmed.size === 0) {
        return; // caller-supplied streams cannot be drained synchronously from here
      }
      const filePath = options.path as string;
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        // Honor append:false when no stream ever opened (the async open would have truncated).
        const fd = openSync(filePath, everOpened || append ? "a" : "w");
        everOpened = true;
        try {
          // The stream writes serially, so among submitted entries exactly the FIRST can be mid-
          // syscall — skipping it avoids deterministic duplication on process.exit; every other
          // entry still sits in the stream's in-memory buffer, which dies with the process.
          let first = true;
          for (const [key, entry] of unconfirmed) {
            if (first && entry.submitted && stream != null) {
              first = false;
              continue;
            }
            first = false;
            writeSync(fd, entry.chunk, null, encoding);
            unconfirmed.delete(key);
          }
        } finally {
          closeSync(fd);
        }
      } catch (error) {
        handleError(error, "write");
      }
    },

    async [Symbol.asyncDispose](): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      // Drain anything queued before tearing the stream down. The exit hook stays registered until
      // the drain completes: `using logger; process.exit()` must not lose everything by disposing.
      await transport.flush();
      unregisterExitHook?.();
      unregisterExitHook = null;
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
        try {
          target.end(() => resolve());
        } catch (error) {
          handleError(error, "close");
          resolve();
        }
      });
    },
  };

  return transport;
}
