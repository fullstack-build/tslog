import type { ILogObjMeta, TLogFormat, Transport } from "../../interfaces.js";

/**
 * `tslog/transports/worker` — an opt-in, **Node-only** {@link Transport} that runs a destination's
 * write/flush on a `node:worker_threads` worker, so slow sink I/O (file, stdout/stderr piped to a slow
 * consumer) does not block the application's event loop under high log volume. This mirrors pino's
 * `thread-stream`.
 *
 * IMPORTANT — what this does and does NOT do:
 *  - It does **NOT** speed up the logging hot path or any benchmark of `log.info()`. The record is built
 *    and serialized into a `line` string on the **main thread** (exactly like pino — pino's per-call
 *    serialize is single-threaded; its worker only moves transport I/O). Only the already-formatted
 *    `line` (a cheap-to-transfer string — no structured-clone of the record) is posted to the worker,
 *    which performs the actual destination write. Do not expect a throughput/latency win for the log
 *    call itself; the win is that the main event loop is not stalled by the sink's I/O.
 *
 * Design:
 *  - {@link WorkerTransport.write} posts `{ type: "write", line }` to the worker via `postMessage`. The
 *    `line` is produced on the main thread using this transport's {@link Transport.format}.
 *  - {@link WorkerTransport.flush} performs a message round-trip: it posts a `flush` with a unique id and
 *    resolves when the worker acks `{ type: "flushed", id }`, i.e. once the worker has drained its queue.
 *  - {@link WorkerTransport.[Symbol.asyncDispose]} flushes, then tells the worker to close and terminates
 *    it, releasing the thread and any file descriptor it owns. Graceful shutdown.
 *  - **Lazy worker creation:** the worker is NOT spawned at import time (so `sideEffects: false` holds);
 *    it is created on the first `write` (or first `flush`/dispose). `node:worker_threads` is imported
 *    dynamically inside that first call, never at module scope.
 *  - **Non-Node guard:** on a runtime without `node:worker_threads`, the transport transparently falls
 *    back to a **synchronous inline write** on the calling thread (it never throws at construction). The
 *    fallback uses `node:fs` when present and otherwise drops the line; it keeps logging working off-Node
 *    at the cost of the off-thread benefit. This is why the subpath is safe to import deliberately on any
 *    runtime even though the offloading only happens on Node.
 *
 * No import-time side effects: this module only declares functions/consts. The worker, the dynamic
 * `node:worker_threads`/`node:fs` imports, and the message port are all created when the first log is
 * written, never when the module is loaded.
 *
 * @module subpaths/transports/worker
 */

/** Where the worker writes the lines it receives. */
export type WorkerDestination = "file" | "stdout" | "stderr";

/** Options for {@link workerTransport}. */
export interface WorkerTransportOptions<LogObj> {
  /**
   * Destination the worker writes to: a `"file"` (requires {@link path}), or the process `"stdout"` /
   * `"stderr"` streams. Default `"stdout"`.
   * @example { destination: "file", path: "./logs/app.log" }
   */
  destination?: WorkerDestination;
  /**
   * Filesystem path the worker appends to when {@link destination} is `"file"`. The parent directory is
   * created (recursively) on the worker's first write. Required for the `"file"` destination.
   * @example { destination: "file", path: "./logs/app.log" }
   */
  path?: string;
  /**
   * Per-transport output format, forwarded to the core so the `line` posted to the worker is rendered
   * with it on the main thread. Omitted → the line follows the logger's `type`. Use `"json"` for a
   * structured file/stream sink.
   * @example { format: "json" }
   */
  format?: TLogFormat<LogObj>;
  /** Append to the file (default `true`) instead of truncating it on open. Ignored for std destinations. */
  append?: boolean;
  /** Text encoding for the worker's file write stream (default `"utf8"`). Ignored for std destinations. */
  encoding?: BufferEncoding;
  /** Line terminator appended after every line by the worker (default `"\n"`). Set `""` to write verbatim. */
  eol?: string;
  /** Optional transport name surfaced in tslog's diagnostics when a write/flush throws. Default `"worker"`. */
  name?: string;
  /** Per-transport minimum level; this sink only receives logs at or above it. See {@link Transport.minLevel}. */
  minLevel?: Transport<LogObj>["minLevel"];
}

/**
 * The concrete {@link Transport} returned by {@link workerTransport}, with `flush`/`[Symbol.asyncDispose]`
 * narrowed to required so callers can drive draining + shutdown directly in tests/teardown.
 */
export interface WorkerTransport<LogObj> extends Transport<LogObj> {
  /** Round-trip the worker so it drains its queue; resolves once the worker acks. */
  flush(): Promise<void>;
  /** Flush, then close the worker's destination and terminate the worker thread. */
  [Symbol.asyncDispose](): Promise<void>;
}

/** The minimal structural surface of a `node:worker_threads` `Worker` this transport drives. */
interface WorkerLike {
  postMessage(value: unknown): void;
  on(event: "message" | "error" | "exit", listener: (arg: unknown) => void): unknown;
  terminate(): Promise<unknown> | unknown;
  unref?(): void;
}

/** The `node:worker_threads` surface we dynamically import (only the `Worker` constructor). */
interface WorkerThreadsModule {
  Worker: new (filename: string | URL, options?: { workerData?: unknown; eval?: boolean }) => WorkerLike;
}

/**
 * Inline worker bootstrap used only when the sibling `worker.runner.js` is not present next to the
 * compiled module — i.e. when running from un-built TypeScript source (vitest/ts-node), where no `.js`
 * runner exists to spawn from. In a normal `npm run build` install the sibling file IS emitted and is
 * used instead (see {@link ensureWorker}). The bootstrap mirrors `worker.runner.ts`'s protocol using
 * dynamic `import()` of node builtins so it works whether the worker is launched as CJS or ESM.
 */
const INLINE_RUNNER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
if (parentPort != null) {
  let stream = null;
  const std = workerData.destination === "file" ? null : workerData.destination;
  function writeLine(line) {
    const chunk = line + workerData.eol;
    if (std != null) { fs.appendFileSync(std === "stdout" ? 1 : 2, chunk); return; }
    if (stream == null) {
      fs.mkdirSync(path.dirname(workerData.path), { recursive: true });
      stream = fs.createWriteStream(workerData.path, { flags: workerData.append ? "a" : "w", encoding: workerData.encoding });
    }
    stream.write(chunk);
  }
  function drain() {
    if (stream == null) return Promise.resolve();
    return new Promise((resolve) => stream.write("", () => resolve()));
  }
  parentPort.on("message", (message) => {
    try {
      if (message.type === "write") writeLine(message.line);
      else if (message.type === "flush") drain().then(() => parentPort.postMessage({ type: "flushed", id: message.id }), () => parentPort.postMessage({ type: "flushed", id: message.id }));
      else if (message.type === "close") {
        const target = stream; stream = null;
        if (target != null) target.end(() => parentPort.close()); else parentPort.close();
      }
    } catch {}
  });
}
`;

/** Lazily import `node:worker_threads`; returns `null` on a runtime without it (browser/Deno/edge). */
async function loadWorkerThreads(): Promise<WorkerThreadsModule | null> {
  try {
    return (await import("node:worker_threads")) as unknown as WorkerThreadsModule;
  } catch {
    return null;
  }
}

/** The bits of `node:fs`/`node:path` the synchronous off-Node fallback needs, loaded lazily. */
interface FallbackFs {
  appendFileSync: typeof import("node:fs").appendFileSync;
  mkdirSync: typeof import("node:fs").mkdirSync;
  dirname: typeof import("node:path").dirname;
}

/** Whether the sibling `worker.runner.js` exists at `url` (the built/installed case). Never throws. */
async function runnerFileExists(url: URL): Promise<boolean> {
  try {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    return fs.existsSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

/** Lazily import `node:fs`/`node:path` for the off-thread-unavailable synchronous fallback; `null` if absent. */
async function loadFallbackFs(): Promise<FallbackFs | null> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return { appendFileSync: fs.appendFileSync, mkdirSync: fs.mkdirSync, dirname: path.dirname };
  } catch {
    return null;
  }
}

/**
 * Create an opt-in, Node-only worker-thread {@link Transport} that offloads its destination's write/flush
 * to a `node:worker_threads` worker, keeping slow sink I/O off the application's event loop.
 *
 * NOTE: this does not change the performance of the log call itself — record building and JSON
 * serialization stay on the main thread (like pino). It only moves the destination write off-thread.
 *
 * @param options - {@link WorkerTransportOptions}; choose a `destination` (`"file"` needs a `path`, else
 *   `"stdout"`/`"stderr"`), an optional per-transport `format`, and file open options.
 * @returns a {@link WorkerTransport} ready for `logger.attachTransport(...)`.
 * @throws {TypeError} when `destination` is `"file"` but no `path` is supplied.
 *
 * @example
 * import { Logger } from "tslog";
 * import { workerTransport } from "tslog/transports/worker";
 *
 * const sink = workerTransport({ destination: "file", path: "./logs/app.log", format: "json" });
 * const detach = logger.attachTransport(sink);
 * // ... before exit, drain + release the worker thread:
 * await sink.flush();
 * await sink[Symbol.asyncDispose]();
 */
export function workerTransport<LogObj = unknown>(options: WorkerTransportOptions<LogObj> = {}): WorkerTransport<LogObj> {
  const destination: WorkerDestination = options.destination ?? "stdout";
  if (destination === "file" && options.path == null) {
    throw new TypeError('workerTransport: `path` is required when `destination` is "file"');
  }

  const eol = options.eol ?? "\n";
  const append = options.append ?? true;
  const encoding = options.encoding ?? "utf8";

  // The live worker and the one-shot promise that spawns it. Both stay null until the first write/flush
  // so importing or constructing the transport spawns no thread and touches no IO (sideEffects:false).
  let worker: WorkerLike | null = null;
  let spawning: Promise<WorkerLike | null> | null = null;
  let closed = false;

  // Set once we've learned the runtime has no worker_threads: we then write inline (synchronously) on the
  // calling thread via node:fs, so logging keeps working off-Node at the cost of the off-thread benefit.
  let fallbackFs: FallbackFs | null | undefined;

  // Pending flush round-trips keyed by a monotonically increasing id; resolved when the worker acks.
  const pendingFlushes = new Map<number, () => void>();
  let nextFlushId = 1;
  let onMessageBound = false;

  function handleMessage(message: unknown): void {
    const msg = message as { type?: string; id?: number };
    if (msg?.type === "flushed" && typeof msg.id === "number") {
      const resolve = pendingFlushes.get(msg.id);
      if (resolve != null) {
        pendingFlushes.delete(msg.id);
        resolve();
      }
    }
  }

  /** Spawn the worker once. Resolves to the worker, or `null` if the runtime can't run worker threads. */
  function ensureWorker(): Promise<WorkerLike | null> {
    if (worker != null) {
      return Promise.resolve(worker);
    }
    if (spawning == null) {
      spawning = (async () => {
        const wt = await loadWorkerThreads();
        if (wt == null) {
          return null; // off-Node: caller falls back to an inline synchronous write.
        }
        const workerData = { destination, path: options.path, eol, encoding, append };
        // Prefer the sibling runner module the build emits (production/installed dist). When it is
        // absent — i.e. running from un-built TS source (vitest/ts-node) where only `.runner.ts`
        // exists — spawn the equivalent worker from an inline eval bootstrap so logging still works.
        const runnerUrl = new URL("./worker.runner.js", import.meta.url);
        let created: WorkerLike;
        if (await runnerFileExists(runnerUrl)) {
          created = new wt.Worker(runnerUrl, { workerData });
        } else {
          created = new wt.Worker(INLINE_RUNNER_SOURCE, { eval: true, workerData });
        }
        if (!onMessageBound) {
          created.on("message", handleMessage);
          // On worker error/exit, fail any outstanding flush so flush() never hangs the process.
          const settleAll = () => {
            for (const [id, resolve] of pendingFlushes) {
              pendingFlushes.delete(id);
              resolve();
            }
          };
          created.on("error", settleAll);
          created.on("exit", settleAll);
          onMessageBound = true;
        }
        worker = created;
        return created;
      })();
    }
    return spawning;
  }

  /** Off-Node / no-worker_threads path: append the line synchronously on the calling thread. */
  async function inlineWrite(line: string): Promise<void> {
    if (fallbackFs === undefined) {
      fallbackFs = await loadFallbackFs();
    }
    const fs = fallbackFs;
    if (fs == null) {
      return; // no fs either (e.g. browser): nothing we can safely do — drop the line.
    }
    const chunk = line + eol;
    try {
      if (destination === "file") {
        const filePath = options.path as string;
        fs.mkdirSync(fs.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, chunk, { encoding, flag: append ? "a" : "w" });
      } else {
        fs.appendFileSync(destination === "stdout" ? 1 : 2, chunk);
      }
    } catch {
      // Isolated: an inline destination error must never break logging.
    }
  }

  const transport: WorkerTransport<LogObj> = {
    name: options.name ?? "worker",
    minLevel: options.minLevel,
    format: options.format,

    write(_record: LogObj & ILogObjMeta, line: string): void {
      if (closed) {
        return;
      }
      if (worker != null) {
        // Fast path: worker already running — post synchronously, never awaiting in the log path.
        worker.postMessage({ type: "write", line });
        return;
      }
      // First write (or while still spawning): spawn, then post (or fall back to an inline write off-Node).
      void ensureWorker().then(
        (w) => {
          if (closed) {
            return;
          }
          if (w != null) {
            w.postMessage({ type: "write", line });
          } else {
            void inlineWrite(line);
          }
        },
        () => {
          // Spawning failed unexpectedly: keep logging alive via the inline fallback.
          void inlineWrite(line);
        },
      );
    },

    async flush(): Promise<void> {
      const w = await ensureWorker();
      if (w == null) {
        // Inline fallback writes synchronously, so there is nothing buffered to drain.
        return;
      }
      const id = nextFlushId++;
      await new Promise<void>((resolve) => {
        pendingFlushes.set(id, resolve);
        w.postMessage({ type: "flush", id });
      });
    },

    async [Symbol.asyncDispose](): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      // Nothing was ever spawned (no writes): nothing to drain or terminate.
      if (worker == null && spawning == null) {
        return;
      }
      const w = await (spawning ?? Promise.resolve(worker));
      if (w == null) {
        return; // off-Node fallback: no thread to tear down.
      }
      // Drain the queue (round-trip), then close the destination and terminate the thread.
      await transport.flush();
      try {
        w.postMessage({ type: "close" });
      } catch {
        // Worker may already be gone; terminate() below still cleans up.
      }
      await w.terminate();
      worker = null;
    },
  };

  return transport;
}
