import { appendFileSync, createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

/**
 * `tslog/transports/worker` — the **worker-thread side** of {@link workerTransport}.
 *
 * This module is executed by Node inside a `node:worker_threads` worker spawned by `worker.ts`. It is
 * NOT a public entry point and is never imported on the main thread; it is referenced only by URL
 * (relative to `import.meta.url`) so the build emits it next to `worker.js` in `dist/esm`.
 *
 * Performance note: this code only performs the destination I/O (the slow part). The log record was
 * already built and serialized into a `line` string on the **main thread** before being posted here —
 * moving that work off-thread is explicitly *not* a goal (it mirrors pino's thread-stream). All this
 * worker does is drain `line`s to a file/stream so the app's event loop is not blocked by sink I/O.
 *
 * Protocol (messages received on {@link parentPort}):
 *  - `{ type: "write", line }` — append one already-formatted line (+ EOL) to the destination.
 *  - `{ type: "flush", id }`   — ensure everything queued is on disk, then post `{ type: "flushed", id }`.
 *  - `{ type: "close" }`       — close the stream and let the worker exit.
 *
 * @module subpaths/transports/worker.runner
 */

/** The data structure passed via `workerData` when the worker is spawned (see `worker.ts`). */
interface WorkerRunnerData {
  /** Destination kind: a file path, or one of the process std streams. */
  destination: "file" | "stdout" | "stderr";
  /** Filesystem path to append to (only when `destination === "file"`). */
  path?: string;
  /** Line terminator appended after every line. */
  eol: string;
  /** File encoding for the write stream (only for `destination === "file"`). */
  encoding: BufferEncoding;
  /** Append (`true`) vs. truncate (`false`) when opening a file. */
  append: boolean;
}

/** A message posted from the main thread to this worker. */
type InboundMessage = { type: "write"; line: string } | { type: "flush"; id: number } | { type: "close" };

const data = workerData as WorkerRunnerData;
const port = parentPort;

if (port != null) {
  // The live write stream (file destination only). Opened lazily on the first write so spawning the
  // worker without any traffic touches no filesystem. For stdout/stderr we write synchronously below.
  let stream: WriteStream | null = null;
  let stdMode: "stdout" | "stderr" | null = data.destination === "file" ? null : data.destination;

  function ensureStream(): WriteStream {
    if (stream == null) {
      const filePath = data.path as string;
      mkdirSync(dirname(filePath), { recursive: true });
      stream = createWriteStream(filePath, { flags: data.append ? "a" : "w", encoding: data.encoding });
    }
    return stream;
  }

  function writeLine(line: string): void {
    const chunk = line + data.eol;
    if (stdMode != null) {
      // appendFileSync to the process std stream fd: 1 = stdout, 2 = stderr. Synchronous and ordered.
      appendFileSync(stdMode === "stdout" ? 1 : 2, chunk);
      return;
    }
    ensureStream().write(chunk);
  }

  /** Resolve once the file stream has flushed everything queued to the kernel (std streams are sync). */
  function drain(): Promise<void> {
    if (stream == null) {
      return Promise.resolve();
    }
    const target = stream;
    return new Promise<void>((resolve) => {
      // A zero-length write whose callback fires only after all previously queued writes have drained.
      target.write("", () => resolve());
    });
  }

  port.on("message", (message: InboundMessage) => {
    try {
      if (message.type === "write") {
        writeLine(message.line);
      } else if (message.type === "flush") {
        drain().then(
          () => port.postMessage({ type: "flushed", id: message.id }),
          () => port.postMessage({ type: "flushed", id: message.id }),
        );
      } else if (message.type === "close") {
        const target = stream;
        stream = null;
        stdMode = null;
        if (target != null) {
          target.end(() => port.close());
        } else {
          port.close();
        }
      }
    } catch {
      // A destination error (disk full, bad fd) must never crash the worker and take logging down with
      // it. Swallow it here; the main-thread transport stays alive and isolated either way.
    }
  });
}
