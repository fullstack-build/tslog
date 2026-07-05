import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

// The worker-thread SIDE of `tslog/transports/worker` (worker.runner.ts) normally runs INSIDE a
// `new Worker()` where v8 can't see it. Here we exercise it in-process: we mock `node:worker_threads`
// so its module-level `parentPort` / `workerData` are a fake port we drive, then import the runner and
// emit the protocol messages ({write}/{flush}/{close}) it listens for. This pins the file + std
// destination branches, the flush ack round-trip, close/stream teardown, and the error swallow.

// worker.runner.ts uses node:fs (createWriteStream, appendFileSync to fd 1/2) and node:events — all
// Node-only. Bun lacks the process-std-fd appendFileSync trick + the exact worker_threads seam, so gate.
const isNode = process.versions.node != null && (process.versions as Record<string, string | undefined>).bun == null;

const RUNNER = "../src/subpaths/transports/worker.runner.js";

/** A fake `parentPort`: a real EventEmitter (so `.on("message", …)` works) with the port API spied. */
class FakePort extends EventEmitter {
  postMessage = vi.fn();
  close = vi.fn();
}

/** Mount the runner with a given `workerData`, returning the fake port it wired its listener onto. */
async function loadRunner(workerData: Record<string, unknown>): Promise<FakePort> {
  const port = new FakePort();
  vi.resetModules();
  vi.doMock("node:worker_threads", () => ({ parentPort: port, workerData }));
  await import(RUNNER);
  return port;
}

/** Captured `(fd, chunk)` pairs recorded by the std-destination `appendFileSync` mock. */
type StdWrite = { fd: unknown; chunk: unknown };

/**
 * Mount the runner for a std destination with `node:fs` mocked so `appendFileSync` records the target
 * fd + chunk instead of writing to the real process stdout/stderr (which would pollute test output).
 */
async function loadStdRunner(workerData: Record<string, unknown>): Promise<{ port: FakePort; writes: StdWrite[] }> {
  const port = new FakePort();
  const writes: StdWrite[] = [];
  const actualFs = await import("node:fs");
  vi.resetModules();
  vi.doMock("node:worker_threads", () => ({ parentPort: port, workerData }));
  vi.doMock("node:fs", () => ({
    ...actualFs,
    appendFileSync: (fd: unknown, chunk: unknown) => {
      writes.push({ fd, chunk });
    },
  }));
  await import(RUNNER);
  return { port, writes };
}

/**
 * Poll `condition` across event-loop turns until it holds (a real fs write-stream opens its fd and
 * fires write/end/drain callbacks on later I/O ticks, not on the microtask queue, so a single yield
 * is not enough to observe the file contents or a delivered ack).
 */
async function until(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const tmpDirs: string[] = [];
function tmpLog(): string {
  const dir = mkdtempSync(join(tmpdir(), "tslog-runner-"));
  tmpDirs.push(dir);
  return join(dir, "nested", "app.log"); // nested dir forces the mkdirSync(recursive) path
}

afterEach(() => {
  vi.doUnmock("node:worker_threads");
  vi.doUnmock("node:fs");
  vi.resetModules();
  vi.restoreAllMocks();
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe.runIf(isNode)("worker.runner (worker-thread side)", () => {
  test("file destination: writes lines through the lazily-opened stream and creates the parent dir", async () => {
    const path = tmpLog();
    const port = await loadRunner({ destination: "file", path, eol: "\n", encoding: "utf8", append: true });

    // No I/O until the first write: the stream is opened lazily.
    expect(existsSync(path)).toBe(false);

    port.emit("message", { type: "write", line: '{"n":1}' });
    port.emit("message", { type: "write", line: '{"n":2}' });

    // A flush drains the stream, then acks with the SAME id.
    port.emit("message", { type: "flush", id: 42 });
    await until(() => port.postMessage.mock.calls.length > 0);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "flushed", id: 42 });

    const contents = readFileSync(path, "utf8");
    expect(contents).toBe('{"n":1}\n{"n":2}\n');
  });

  test("file destination: close ends the stream and closes the port", async () => {
    const path = tmpLog();
    const port = await loadRunner({ destination: "file", path, eol: "\n", encoding: "utf8", append: true });

    port.emit("message", { type: "write", line: "line" });

    port.emit("message", { type: "close" });
    await until(() => port.close.mock.calls.length > 0);
    expect(port.close).toHaveBeenCalledTimes(1);
    // Everything written before close is on disk after the stream's end() flush.
    expect(readFileSync(path, "utf8")).toBe("line\n");
  });

  test("file destination: honours a custom eol and append:false (truncate on open)", async () => {
    const path = tmpLog();
    // append:false → flags:"w" so a second mount truncates. First mount writes two records.
    let port = await loadRunner({ destination: "file", path, eol: "|", encoding: "utf8", append: false });
    port.emit("message", { type: "write", line: "a" });
    port.emit("message", { type: "write", line: "b" });
    port.emit("message", { type: "close" });
    await until(() => port.close.mock.calls.length > 0);
    expect(readFileSync(path, "utf8")).toBe("a|b|");

    port = await loadRunner({ destination: "file", path, eol: "|", encoding: "utf8", append: false });
    port.emit("message", { type: "write", line: "c" });
    port.emit("message", { type: "close" });
    await until(() => port.close.mock.calls.length > 0);
    expect(readFileSync(path, "utf8")).toBe("c|"); // truncated, not appended
  });

  test("flush with no stream yet (nothing written) resolves synchronously and still acks", async () => {
    const path = tmpLog();
    const port = await loadRunner({ destination: "file", path, eol: "\n", encoding: "utf8", append: true });
    // No write → stream is null → drain() short-circuits to Promise.resolve().
    port.emit("message", { type: "flush", id: 7 });
    await until(() => port.postMessage.mock.calls.length > 0);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "flushed", id: 7 });
    expect(existsSync(path)).toBe(false);
  });

  test("close with no stream open still closes the port", async () => {
    const port = await loadRunner({ destination: "file", path: tmpLog(), eol: "\n", encoding: "utf8", append: true });
    port.emit("message", { type: "close" }); // stream never opened → the else branch calls port.close directly
    await until(() => port.close.mock.calls.length > 0);
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  test("stdout destination: writes go to fd 1 (with eol) synchronously; flush is a no-op ack", async () => {
    const { port, writes } = await loadStdRunner({ destination: "stdout", eol: "\n", encoding: "utf8", append: true });

    port.emit("message", { type: "write", line: "to-stdout" });
    // Synchronous appendFileSync(1, chunk) — no stream, no lazy open; the eol is appended.
    expect(writes).toEqual([{ fd: 1, chunk: "to-stdout\n" }]);

    port.emit("message", { type: "flush", id: 1 });
    await until(() => port.postMessage.mock.calls.length > 0);
    // std destinations are synchronous: drain() returns resolved immediately, still acks the id.
    expect(port.postMessage).toHaveBeenCalledWith({ type: "flushed", id: 1 });

    port.emit("message", { type: "close" });
    await until(() => port.close.mock.calls.length > 0);
    // No stream for std → close hits the else branch (port.close directly), not stream.end().
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  test("stderr destination: routes to fd 2 without opening a file stream", async () => {
    const { port, writes } = await loadStdRunner({ destination: "stderr", eol: "\n", encoding: "utf8", append: true });
    port.emit("message", { type: "write", line: "to-stderr" });
    expect(writes).toEqual([{ fd: 2, chunk: "to-stderr\n" }]);
    port.emit("message", { type: "close" });
    await until(() => port.close.mock.calls.length > 0);
    expect(port.close).toHaveBeenCalledTimes(1);
  });

  test("a thrown destination error is swallowed — the worker never crashes", async () => {
    // Point at a path whose parent CANNOT be created (a regular file used as a directory) so the lazy
    // ensureStream()/mkdirSync throws inside the message handler's try. It must be swallowed.
    const dir = mkdtempSync(join(tmpdir(), "tslog-runner-"));
    tmpDirs.push(dir);
    const fileAsDir = join(dir, "iam-a-file");
    // Create a real file, then try to write UNDER it as if it were a directory.
    const { writeFileSync } = await import("node:fs");
    writeFileSync(fileAsDir, "x");
    const badPath = join(fileAsDir, "cannot", "app.log");

    const port = await loadRunner({ destination: "file", path: badPath, eol: "\n", encoding: "utf8", append: true });
    // The write throws inside ensureStream (mkdirSync under a file) — the catch swallows it.
    expect(() => port.emit("message", { type: "write", line: "boom" })).not.toThrow();
    // The port stays usable: a subsequent flush still acks (stream is still null, drain resolves).
    port.emit("message", { type: "flush", id: 99 });
    await until(() => port.postMessage.mock.calls.length > 0);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "flushed", id: 99 });
  });

  test("importing the runner with a null parentPort does not throw", async () => {
    vi.resetModules();
    vi.doMock("node:worker_threads", () => ({ parentPort: null, workerData: { destination: "stdout", eol: "\n", encoding: "utf8", append: true } }));
    // Import-safety smoke test: with a null port there is nothing to observe from outside — the
    // `if (port != null)` guard just has to keep the module import from throwing.
    await expect(import(RUNNER)).resolves.toBeDefined();
  });
});
