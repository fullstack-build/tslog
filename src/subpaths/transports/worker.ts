import type { ILogObjMeta, TLogFormat, Transport } from "../../interfaces.js";
import { registerExitHook } from "../../internal/exitHooks.js";
import { nativeConsoleMethod } from "../../internal/nativeConsole.js";

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
  /**
   * How often an unexpectedly dead worker is respawned before the transport permanently falls back to
   * inline synchronous writes on the calling thread (default `3`).
   */
  maxRespawns?: number;
  /**
   * Register a guarded `beforeExit` hook (default `true`) that drains the worker's queue via a flush
   * round-trip, so a naturally exiting process does not lose queued lines. Set `false` to manage
   * draining yourself.
   */
  exitHooks?: boolean;
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
  ref?(): void;
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
(async () => {
  // Dynamic imports work in BOTH module systems: the eval'd worker inherits the parent's execArgv,
  // so it may be evaluated as CJS or (e.g. under --input-type=module) as ESM — require() would break there.
  const { parentPort, workerData } = await import("node:worker_threads");
  const fs = await import("node:fs");
  const path = await import("node:path");
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
})();
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
  const maxRespawns = options.maxRespawns != null && options.maxRespawns >= 0 ? options.maxRespawns : 3;
  let respawns = 0;
  // Set when the worker died more often than maxRespawns allows: every later write goes inline.
  let workerGaveUp = false;
  let deathReported = false;
  let unregisterExitHook: (() => void) | null = null;

  // Set once we've learned the runtime has no worker_threads: we then write inline (synchronously) on the
  // calling thread via node:fs, so logging keeps working off-Node at the cost of the off-thread benefit.
  let fallbackFs: FallbackFs | null | undefined;

  // Pending flush round-trips keyed by a monotonically increasing id; resolved when the worker acks.
  const pendingFlushes = new Map<number, () => void>();
  let nextFlushId = 1;
  // Whether anything was posted since the last completed flush. A flush with nothing queued is a
  // no-op — crucially so for the beforeExit hook, whose ref()d round-trip would otherwise schedule
  // fresh work on every beforeExit tick and keep the process alive in a flush loop forever.
  let queuedSinceFlush = false;
  // Serialize flush() calls: a second flush arriving inside the first one's spawn-await gap must wait
  // for (and thereby share) the first round-trip instead of seeing the cleared dirty flag and
  // resolving before anything was drained.
  let flushChain: Promise<void> = Promise.resolve();

  function handleMessage(message: unknown): void {
    const msg = message as { type?: string; id?: number };
    if (msg?.type === "flushed" && typeof msg.id === "number") {
      const resolve = pendingFlushes.get(msg.id);
      if (resolve != null) {
        pendingFlushes.delete(msg.id);
        resolve();
      }
      // No outstanding round-trips: release the event-loop handle again (see the ref() in flush()).
      if (pendingFlushes.size === 0) {
        worker?.unref?.();
      }
    }
  }

  /** Settle every outstanding flush (worker died / was terminated) so flush() can never hang. */
  function settleAllFlushes(): void {
    for (const [id, resolve] of pendingFlushes) {
      pendingFlushes.delete(id);
      resolve();
    }
  }

  /** An unexpected worker death: reset so the next write respawns, or give up after maxRespawns. */
  function handleWorkerDeath(died: WorkerLike, error?: unknown): void {
    if (worker !== died) {
      return; // stale event from an already-replaced worker — must not settle the NEW worker's flushes
    }
    settleAllFlushes();
    worker = null;
    spawning = null;
    if (closed) {
      return;
    }
    respawns++;
    if (respawns > maxRespawns) {
      workerGaveUp = true;
    }
    if (!deathReported) {
      deathReported = true;
      try {
        nativeConsoleMethod("error")(
          `tslog: worker transport "${options.name ?? "worker"}" thread died unexpectedly${workerGaveUp ? "; falling back to inline writes" : "; respawning on the next write"}`,
          error,
        );
      } catch {
        // the report itself must never throw
      }
    }
  }

  /** Spawn the worker once. Resolves to the worker, or `null` if the runtime can't run worker threads. */
  function ensureWorker(): Promise<WorkerLike | null> {
    if (worker != null) {
      return Promise.resolve(worker);
    }
    /* v8 ignore next 3 -- defensive: give-up (workerGaveUp) always coincides with worker/spawning === null, and both public callers of ensureWorker are blocked in that state (write() short-circuits to inlineWrite at the workerGaveUp guard; flush()'s "worker == null && spawning == null" guard returns before reaching here), so this is never reached */
    if (workerGaveUp) {
      return Promise.resolve(null);
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
        created.on("message", handleMessage);
        created.on("error", (error) => handleWorkerDeath(created, error));
        created.on("exit", () => handleWorkerDeath(created));
        // A ref'd worker keeps the parent event loop alive forever — a process that merely attached
        // this transport could never exit. Unref AFTER the listeners: attaching a message listener
        // re-refs the worker's port, which would silently undo an earlier unref. flush() temporarily
        // refs the worker again so an awaited drain cannot be cut short by process exit.
        created.unref?.();
        worker = created;
        deathReported = false;
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
      if (unregisterExitHook == null && options.exitHooks !== false) {
        unregisterExitHook = registerExitHook({ flushAsync: () => transport.flush() });
      }
      if (workerGaveUp) {
        void inlineWrite(line);
        return;
      }
      if (worker != null) {
        // Fast path: worker already running — post synchronously, never awaiting in the log path.
        queuedSinceFlush = true;
        worker.postMessage({ type: "write", line });
        return;
      }
      // First write (or while still spawning): spawn, then post (or fall back to an inline write off-Node).
      queuedSinceFlush = true;
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

    flush(): Promise<void> {
      const run = async (): Promise<void> => {
        // Never spawn a worker just to flush it: with no worker and no spawn in progress nothing was
        // ever queued (pre-fix, flushing an idle transport spawned a ref'd thread and hung the process).
        if (worker == null && spawning == null) {
          return;
        }
        // Nothing posted since the last completed drain: skip the round-trip entirely (see above).
        if (!queuedSinceFlush && pendingFlushes.size === 0) {
          return;
        }
        queuedSinceFlush = false;
        const w = await ensureWorker();
        if (w == null) {
          // Inline fallback writes synchronously, so there is nothing buffered to drain.
          return;
        }
        const id = nextFlushId++;
        await new Promise<void>((resolve) => {
          pendingFlushes.set(id, resolve);
          try {
            // Hold the event loop open for the round-trip: the worker is normally unref'd, and an
            // awaited promise alone does not keep a Node process alive — without this ref an
            // `await flush()` as the program's last statement would exit before the drain finished.
            w.ref?.();
            w.postMessage({ type: "flush", id });
          } catch {
            pendingFlushes.delete(id);
            if (pendingFlushes.size === 0) {
              w.unref?.();
            }
            resolve(); // worker died between check and post — nothing left to drain
          }
        });
      };
      const chained = flushChain.then(run);
      flushChain = chained.catch(() => undefined);
      return chained;
    },

    async [Symbol.asyncDispose](): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      // Nothing was ever spawned (no writes): nothing to drain or terminate.
      if (worker == null && spawning == null) {
        unregisterExitHook?.();
        unregisterExitHook = null;
        return;
      }
      // A spawn that rejected (e.g. `new Worker()` threw) already fell back to inline writes; dispose must
      // not re-throw that rejection — treat it like "no thread to tear down".
      /* v8 ignore next -- `spawning` and `worker` are only ever nulled together (handleWorkerDeath), so once the guard above passed, `spawning` is non-null and the `Promise.resolve(worker)` fallback is unreachable */
      const w = await (spawning ?? Promise.resolve(worker)).catch(() => null);
      if (w == null) {
        unregisterExitHook?.();
        unregisterExitHook = null;
        return; // off-Node fallback (or a failed spawn): no thread to tear down.
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
      // Only drop the exit-hook safety net once the drain + teardown completed.
      unregisterExitHook?.();
      unregisterExitHook = null;
    },
  };

  return transport;
}
