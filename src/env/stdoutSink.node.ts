import { createRequire } from "node:module";
import { registerExitHook } from "../internal/exitHooks.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";

/**
 * The buffered stdout sink backing the Node entry's default `type: "json"` output (review finding 13).
 *
 * `console.log` costs a `util.format` dispatch plus one unbatched stream write PER LINE — the dominant
 * per-log cost once serialization is fast, and the reason pino's default destination batches into
 * ~4KB chunks. This sink buffers finished JSON lines and hands them to `process.stdout.write` as ONE
 * chunk per event-loop turn (or immediately once {@link FLUSH_THRESHOLD_CHARS} is buffered), so a
 * burst of N logs costs one write instead of N.
 *
 * Delivery guarantees (same or better than the `console.log` it replaces — which is itself
 * asynchronous when stdout is a pipe, the normal Docker/k8s case):
 *  - the buffer is flushed within the current microtask checkpoint (before any I/O callback runs);
 *  - `logger.flush()` / `await using` resolve only after stdout has ACCEPTED every handed-off chunk;
 *  - a `beforeExit` hook flushes asynchronously, and a `process.on("exit")` hook synchronously drains
 *    whatever is still buffered via `fs.writeSync` — covering `process.exit()` and uncaught throws,
 *    where pending microtasks never run;
 *  - hard signal deaths (SIGKILL) can lose the current turn's lines, exactly like `console.log` can
 *    lose its pending pipe writes.
 *
 * Interception note: output goes through `process.stdout.write` (read at flush time, so test spies
 * see it) — NOT through `console.log`. Code that patches `console.log` to capture logs must spy on
 * `process.stdout.write` instead, or use `type: "hidden"` plus a transport. Browser/universal entries
 * keep their console sinks. Cross-sink ordering: because json lines are batched to the microtask
 * checkpoint while direct `console.log`/pretty output writes immediately, output from DIFFERENT sinks
 * inside one synchronous turn may print with the batched json lines last — within the json stream
 * itself, order is always preserved.
 *
 * No import-time side effects: the singleton, its exit hooks, and the lazy `node:fs` resolution all
 * happen on first use (`sideEffects: false` keeps holding).
 */
export interface StdoutJsonSink {
  /** Buffer one finished JSON line (no trailing newline) for the next batched stdout write. */
  write(line: string): void;
  /** Hand the buffer to stdout now and resolve once stdout has accepted every outstanding chunk. */
  flush(): Promise<void>;
  /** Hand the buffer to stdout now, without waiting for acceptance (sync callers: tests, exit paths). */
  flushSync(): void;
}

/**
 * Flush inline once this many buffered UTF-16 units accumulate mid-turn, bounding memory (and the
 * loss window) under a synchronous logging burst that never yields to the microtask queue. ~8KB of
 * ASCII, the same order of magnitude as pino's recommended `minLength: 4096`.
 */
const FLUSH_THRESHOLD_CHARS = 8192;

type StdoutLike = {
  write?: (chunk: string, callback?: () => void) => boolean;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  fd?: number;
};

function createStdoutJsonSink(): StdoutJsonSink {
  const buffer: string[] = [];
  let bufferedChars = 0;
  let flushScheduled = false;
  // Chunks handed to `process.stdout.write` that the stream has not ACCEPTED yet. A write counts as
  // accepted when `write()` returns non-false (the data is in the stream's internal buffer) or when
  // its callback fires — whichever comes first; only a backpressured `false` write keeps `flush()`
  // waiting on the callback. This also means a user's naive stdout stub (`mockImplementation(() =>
  // true)` — no callback) can never park `logger.flush()`/`await using` forever.
  let pendingWrites = 0;
  let waiters: (() => void)[] = [];
  // Streams already guarded with a no-op "error" listener. Keyed by stream identity (NOT a boolean):
  // process.stdout can be replaced (output-capture frameworks), and an unguarded replacement would
  // turn an EPIPE into an uncaught exception — the exact crash the listener exists to prevent.
  const errorGuardedStreams = new WeakSet<object>();
  // Lazily resolved `fs.writeSync` for the synchronous `process.on("exit")` drain (`null` = resolution
  // failed, don't retry). Regular flushes use the stream so backpressure buffering stays in Node's hands.
  let fsWriteSync: ((fd: number, data: Uint8Array) => number) | null | undefined;

  function settleWaiters(): void {
    if (pendingWrites === 0 && waiters.length > 0) {
      const settled = waiters;
      waiters = [];
      for (const resolve of settled) {
        resolve();
      }
    }
  }

  /** The live stdout stream, re-read on every flush so test spies and late replacements are honored. */
  function currentStdout(): StdoutLike | undefined {
    const proc = (globalThis as { process?: { stdout?: StdoutLike } }).process;
    return proc?.stdout;
  }

  function writeChunk(chunk: string): void {
    const stdout = currentStdout();
    if (stdout != null && typeof stdout.write === "function") {
      // An EPIPE/closed-stream error on process.stdout would otherwise surface as an uncaught
      // exception (streams throw on unhandled "error"). console.log swallows these; so do we — once
      // per STREAM, so a replaced process.stdout is guarded too.
      if (typeof stdout.on === "function" && !errorGuardedStreams.has(stdout as object)) {
        errorGuardedStreams.add(stdout as object);
        try {
          stdout.on("error", () => undefined);
        } catch {
          // a stream that rejects listeners still gets the try/catch below
        }
      }
      // Idempotent settle latch: the acceptance can arrive via the non-false return value, the write
      // callback, or the catch below — in any combination (a sync callback followed by a throw must
      // not double-decrement and silently void the flush() guarantee).
      let settled = false;
      const settle = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        pendingWrites--;
        settleWaiters();
      };
      pendingWrites++;
      try {
        const accepted = stdout.write(chunk, settle);
        if (accepted !== false) {
          // Data is in the stream's internal buffer — flush() need not wait for the ack callback.
          settle();
        }
        return;
      } catch {
        settle();
      }
    }
    // stdout is unusable (destroyed, or an exotic runtime without a stream): degrade to the console
    // path this sink replaced. Never throw into the log call.
    try {
      /* v8 ignore next -- the `: chunk` arm is unreachable: every writeChunk caller passes a newline-terminated chunk; the branch defends future callers */
      nativeConsoleMethod("log")(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk);
    } catch {
      // last resort: drop
    }
  }

  function flushNow(): void {
    if (buffer.length === 0) {
      return;
    }
    const chunk = `${buffer.join("\n")}\n`;
    buffer.length = 0;
    bufferedChars = 0;
    writeChunk(chunk);
  }

  /** Synchronous last-chance drain for `process.on("exit")`, where microtasks never run. */
  function drainSync(): void {
    if (buffer.length === 0) {
      return;
    }
    if (fsWriteSync === undefined) {
      try {
        const require = createRequire(import.meta.url);
        const fs = require("node:fs") as { writeSync: (fd: number, data: Uint8Array) => number };
        fsWriteSync = typeof fs.writeSync === "function" ? fs.writeSync : null;
        /* v8 ignore next 3 -- defensive: node:fs is always resolvable on Node; covers exotic loaders */
      } catch {
        fsWriteSync = null;
      }
    }
    const chunk = `${buffer.join("\n")}\n`;
    buffer.length = 0;
    bufferedChars = 0;
    if (fsWriteSync != null && typeof Buffer !== "undefined") {
      // write(2) on a non-blocking pipe may legally transfer FEWER bytes than asked (returning the
      // count, no exception) — a single un-looped writeSync would tear a line mid-JSON and drop the
      // rest. Loop over the byte count; on EAGAIN/closed-fd, hand the remainder to the stream path.
      const bytes = Buffer.from(chunk, "utf8");
      const fd = currentStdout()?.fd ?? 1;
      let offset = 0;
      try {
        while (offset < bytes.length) {
          const written = fsWriteSync(fd, bytes.subarray(offset));
          if (!(written > 0)) {
            break;
          }
          offset += written;
        }
      } catch {
        // EAGAIN on a saturated non-blocking pipe, or a closed fd — remainder goes to the stream
      }
      if (offset >= bytes.length) {
        return;
      }
      writeChunk(bytes.subarray(offset).toString("utf8"));
      return;
    }
    writeChunk(chunk);
  }

  registerExitHook({
    drainSync,
    flushAsync: () => sink.flush(),
  });

  const sink: StdoutJsonSink = {
    write(line: string): void {
      buffer.push(line);
      bufferedChars += line.length + 1;
      if (bufferedChars >= FLUSH_THRESHOLD_CHARS) {
        flushNow();
        return;
      }
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(() => {
          flushScheduled = false;
          flushNow();
        });
      }
    },
    flush(): Promise<void> {
      flushNow();
      if (pendingWrites === 0) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
    flushSync(): void {
      flushNow();
    },
  };

  return sink;
}

let sharedSink: StdoutJsonSink | undefined;

/**
 * The process-wide stdout JSON sink, created (and its exit hooks registered) on first use. Shared by
 * every Node-entry logger so batched chunks from different loggers never interleave mid-line.
 */
export function getStdoutJsonSink(): StdoutJsonSink {
  if (sharedSink === undefined) {
    sharedSink = createStdoutJsonSink();
  }
  return sharedSink;
}
