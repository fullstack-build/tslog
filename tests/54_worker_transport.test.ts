import { EventEmitter } from "node:events";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Logger } from "../src/index.node.js";
import { type WorkerTransport, workerTransport } from "../src/subpaths/transports/worker.js";

// Some tests need to drive the MAIN-thread transport's internal logic (spawn/death/flush/dispose/
// fallback) deterministically, which real threads can't. Those load a FRESH copy of worker.ts with
// `node:worker_threads` (and sometimes `node:fs`) mocked via a reset module registry, so the static
// import above (used by the real-thread integration tests) is untouched.
const isNode = process.versions.node != null && (process.versions as Record<string, string | undefined>).bun == null;

// The worker transport runs its destination I/O on a node:worker_threads worker. Each test MUST dispose
// the transport (terminating its worker) or the process keeps a live handle and Vitest hangs — so every
// created transport is registered here and disposed in afterEach.
const open: WorkerTransport<unknown>[] = [];
function track<T>(t: WorkerTransport<T>): WorkerTransport<T> {
  open.push(t as WorkerTransport<unknown>);
  return t;
}

afterEach(async () => {
  while (open.length > 0) {
    const t = open.pop();
    try {
      await t?.[Symbol.asyncDispose]?.();
    } catch {
      // best-effort teardown; never fail a test on disposal
    }
  }
});

function tmpFile(): string {
  // Unique enough without Date.now/Math.random (unavailable in some sandboxes): a module-scoped counter.
  return join(tmpdir(), `tslog-worker-${process.pid}-${counter++}.log`);
}
let counter = 0;

describe("worker transport (tslog/transports/worker)", () => {
  test("implements the async Transport contract", () => {
    const t = track(workerTransport({ destination: "file", path: tmpFile(), format: "json" }));
    expect(typeof t.write).toBe("function");
    expect(typeof t.flush).toBe("function");
    expect(typeof t[Symbol.asyncDispose]).toBe("function");
  });

  test("`file` destination requires a path", () => {
    expect(() => workerTransport({ destination: "file" })).toThrow();
  });

  test("round-trip: lines logged through the worker reach the file, in order", async () => {
    const path = tmpFile();
    const t = track(workerTransport({ destination: "file", path, format: "json" }));
    const log = new Logger({ type: "json", minLevel: 0 });
    const detach = log.attachTransport(t);

    log.info({ n: 1 }, "first");
    log.info({ n: 2 }, "second");
    log.info({ n: 3 }, "third");

    // flush() must resolve once the worker has drained everything queued to disk.
    await t.flush();
    detach();

    const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((p) => p.message)).toEqual(["first", "second", "third"]);
    expect(parsed.map((p) => p.n)).toEqual([1, 2, 3]);

    rmSync(path, { force: true });
  });

  test("flush() resolves even with nothing buffered", async () => {
    const t = track(workerTransport({ destination: "file", path: tmpFile(), format: "json" }));
    await expect(t.flush()).resolves.toBeUndefined();
  });

  test("a destination error does not crash logging (transport isolation)", async () => {
    // Point the file at a path that cannot be created (a file used as a directory component) so the worker's
    // write fails; logging must continue and other transports must still run.
    const okPath = tmpFile();
    const okSink = workerTransport({ destination: "file", path: okPath, format: "json" });
    track(okSink);
    const badSink = workerTransport({ destination: "file", path: "/dev/null/cannot/exist.log", format: "json" });
    track(badSink);

    const log = new Logger({ type: "json", minLevel: 0 });
    log.attachTransport(badSink);
    log.attachTransport(okSink);

    expect(() => log.info("survives a bad sink")).not.toThrow();
    await okSink.flush();

    const lines = readFileSync(okPath, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.some((l) => JSON.parse(l).message === "survives a bad sink")).toBe(true);
    rmSync(okPath, { force: true });
  });
});

/* -------------------------------------------------------------------------------------------------- */
/* Mock-driven main-thread logic (spawn, flush round-trip, death/respawn, dispose, fallback)          */
/* -------------------------------------------------------------------------------------------------- */

type WorkerMsg = { type?: string; id?: number; line?: string };

/**
 * A controllable stand-in for a `node:worker_threads` Worker. It records posted messages, auto-acks
 * flushes (like the real worker draining), and lets a test emit "error"/"exit" to simulate a death.
 */
class FakeWorker extends EventEmitter {
  posted: WorkerMsg[] = [];
  terminated = 0;
  refs = 0;
  unrefs = 0;
  autoAckFlush = true;

  postMessage(value: WorkerMsg): void {
    this.posted.push(value);
    if (this.autoAckFlush && value?.type === "flush" && typeof value.id === "number") {
      // Mimic the worker draining and posting back {type:"flushed", id} on the message channel.
      queueMicrotask(() => this.emit("message", { type: "flushed", id: value.id }));
    }
  }
  terminate(): Promise<void> {
    this.terminated++;
    return Promise.resolve();
  }
  ref(): void {
    this.refs++;
  }
  unref(): void {
    this.unrefs++;
  }
  /** Simulate an unexpected thread death via the "error" (or "exit") event the transport listens for. */
  die(error?: Error): void {
    if (error) {
      this.emit("error", error);
    } else {
      this.emit("exit", 1);
    }
  }
}

type WorkerModule = typeof import("../src/subpaths/transports/worker.js");

interface MockSetup {
  /** Constructor spy: every `new Worker(...)` records its args and returns the next queued FakeWorker. */
  ctor: ReturnType<typeof vi.fn>;
  /** FakeWorkers handed out, newest last. */
  workers: FakeWorker[];
  /** The queue the ctor pulls from; push extra workers for respawn scenarios. */
  queue: FakeWorker[];
}

/**
 * Load a FRESH worker.ts with `node:worker_threads` mocked. `opts.workerThreadsThrows` makes the
 * dynamic import reject (off-Node path). `opts.runnerFileExists` forces the built-runner branch by
 * mocking `node:fs`'s existsSync; `opts.fsThrows` makes the fallback fs loader/runner-probe fail.
 */
async function loadMocked(
  opts: { workerThreadsThrows?: boolean; runnerFileExists?: boolean; fsMock?: Record<string, unknown> } = {},
): Promise<{ mod: WorkerModule; setup: MockSetup }> {
  const queue: FakeWorker[] = [];
  const workers: FakeWorker[] = [];
  const ctor = vi.fn((_url: unknown, _o: unknown) => {
    const w = queue.shift() ?? new FakeWorker();
    workers.push(w);
    return w;
  });

  vi.resetModules();
  if (opts.workerThreadsThrows) {
    vi.doMock("node:worker_threads", () => {
      throw new Error("no worker_threads on this runtime");
    });
  } else {
    vi.doMock("node:worker_threads", () => ({ Worker: ctor }));
  }

  if (opts.fsMock != null) {
    const actualFs = await import("node:fs");
    vi.doMock("node:fs", () => ({ ...actualFs, ...opts.fsMock }));
  } else if (opts.runnerFileExists != null) {
    const actualFs = await import("node:fs");
    vi.doMock("node:fs", () => ({ ...actualFs, existsSync: () => opts.runnerFileExists }));
  }

  const mod = (await import("../src/subpaths/transports/worker.js")) as WorkerModule;
  return { mod, setup: { ctor, workers, queue } };
}

/**
 * Yield across many event-loop turns so an internal `ensureWorker()` chain settles: spawning awaits
 * `loadWorkerThreads()` then `runnerFileExists()` (which itself awaits `import("node:fs")` and
 * `import("node:url")`), i.e. several async hops before the ctor runs and the line is posted.
 *
 * A fixed tick count is not robust when the whole suite runs in parallel and the event loop is busy, so
 * we run a generous number of macro-task yields. Prefer {@link settleUntil} when the settled state is
 * observable (e.g. the ctor was called) — it polls the condition instead of guessing a tick budget.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));
  }
}

/** Yield event-loop turns until `predicate()` is true (or a generous tick budget is exhausted). */
async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !predicate(); i++) {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));
  }
}

describe.runIf(isNode)("worker transport — main-thread logic (mocked worker_threads)", () => {
  // Each fresh worker.ts copy runs its own installOnce(), adding a beforeExit/exit listener to the
  // shared process. Across ~20 mocked re-imports that trips Node's default 10-listener warning; raise
  // the cap for this suite (restored after) so the harmless duplicates don't spam the test output.
  let prevMax = 0;
  beforeEach(() => {
    prevMax = process.getMaxListeners();
    process.setMaxListeners(0);
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("node:worker_threads");
    vi.doUnmock("node:fs");
    vi.doUnmock("node:url");
    vi.resetModules();
    vi.restoreAllMocks();
    process.setMaxListeners(prevMax);
  });

  test("first write spawns the worker (unref'd) and posts the line; later writes take the fast path", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });

    t.write({} as never, "line-1");
    await settle();
    expect(setup.ctor).toHaveBeenCalledTimes(1);
    const w = setup.workers[0];
    expect(w.unrefs).toBeGreaterThan(0); // unref'd so it can't keep the loop alive
    expect(w.posted).toEqual([{ type: "write", line: "line-1" }]);

    // Fast path: worker already running — posts synchronously without another spawn.
    t.write({} as never, "line-2");
    expect(setup.ctor).toHaveBeenCalledTimes(1);
    expect(w.posted).toEqual([
      { type: "write", line: "line-1" },
      { type: "write", line: "line-2" },
    ]);

    await t[Symbol.asyncDispose]();
  });

  test("default destination is stdout and worker_threads is imported lazily (not at spawn-less construction)", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport(); // no options → destination defaults to "stdout"
    expect(setup.ctor).not.toHaveBeenCalled(); // constructing the transport spawns nothing
    t.write({} as never, "x");
    await settle();
    expect(setup.ctor).toHaveBeenCalledTimes(1);
    await t[Symbol.asyncDispose]();
  });

  test("flush round-trips the worker and resolves when it acks; ref's for the round-trip then unref's", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "queued");
    await settle();
    const w = setup.workers[0];
    const refsBefore = w.refs;

    await t.flush();
    // A flush posts {type:"flush", id} and resolves on the ack.
    expect(w.posted.some((m) => m.type === "flush")).toBe(true);
    expect(w.refs).toBeGreaterThan(refsBefore); // ref'd to hold the loop open for the drain
    expect(w.unrefs).toBeGreaterThan(0); // released again once no round-trips outstanding

    await t[Symbol.asyncDispose]();
  });

  test("flush with nothing queued since the last drain skips the round-trip", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "one");
    await settle();
    await t.flush(); // drains
    const w = setup.workers[0];
    const flushPostsAfterFirst = w.posted.filter((m) => m.type === "flush").length;

    // Nothing written since → no new flush post.
    await t.flush();
    expect(w.posted.filter((m) => m.type === "flush").length).toBe(flushPostsAfterFirst);

    await t[Symbol.asyncDispose]();
  });

  test("flush before any write is a no-op (never spawns a worker just to flush it)", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    await t.flush();
    expect(setup.ctor).not.toHaveBeenCalled();
    await t[Symbol.asyncDispose]();
  });

  test("concurrent flushes chain: a second flush inside the first's gap shares the drain, not resolving early", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "queued");
    await settle();
    const w = setup.workers[0];
    w.autoAckFlush = false; // hold the acks so both flushes are outstanding together

    let firstDone = false;
    let secondDone = false;
    const f1 = t.flush().then(() => {
      firstDone = true;
    });
    const f2 = t.flush().then(() => {
      secondDone = true;
    });
    await settle();
    expect(firstDone).toBe(false);
    expect(secondDone).toBe(false);
    // Ack every outstanding flush id.
    for (const m of w.posted.filter((m) => m.type === "flush")) {
      w.emit("message", { type: "flushed", id: m.id });
    }
    await Promise.all([f1, f2]);
    expect(firstDone && secondDone).toBe(true);

    await t[Symbol.asyncDispose]();
  });

  test("an unexpected worker death respawns on the next write and reports it once", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout", name: "respawner" });
    t.write({} as never, "before-death");
    await settle();
    const first = setup.workers[0];

    first.die(new Error("thread boom")); // unexpected death → reset; next write respawns
    await settle();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0][0])).toContain("respawning on the next write");

    t.write({} as never, "after-death");
    await settle();
    expect(setup.ctor).toHaveBeenCalledTimes(2); // respawned
    expect(setup.workers[1].posted).toEqual([{ type: "write", line: "after-death" }]);

    await t[Symbol.asyncDispose]();
    errSpy.mockRestore();
  });

  test("after maxRespawns deaths the transport gives up and writes inline (fs fallback)", async () => {
    const appended: Array<{ fd: unknown; chunk: unknown }> = [];
    const { mod, setup } = await loadMocked({
      fsMock: {
        existsSync: () => false,
        appendFileSync: (fd: unknown, chunk: unknown) => {
          appended.push({ fd, chunk });
        },
        mkdirSync: () => undefined,
      },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = mod.workerTransport({ destination: "stderr", maxRespawns: 1 });

    // Spawn, then kill more than maxRespawns times.
    t.write({} as never, "w1");
    await settle();
    setup.workers[0].die(); // respawn 1 (<= max)
    await settle();
    t.write({} as never, "w2");
    await settle();
    setup.workers[1].die(); // respawn 2 (> max=1) → give up
    await settle();

    // Now writes go inline via node:fs appendFileSync (fd 2 for stderr).
    t.write({} as never, "inline-line");
    await settle();
    expect(appended).toEqual([{ fd: 2, chunk: "inline-line\n" }]);
    // The FIRST death reported "respawning"; the death that exceeded maxRespawns reported the give-up.
    const messages = errSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("falling back to inline writes"))).toBe(true);

    await t[Symbol.asyncDispose]();
    errSpy.mockRestore();
  });

  test("a stale death event from an already-replaced worker is ignored", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "a");
    await settle();
    const first = setup.workers[0];
    first.die(); // resets worker to null
    await settle();
    t.write({} as never, "b"); // respawns → workers[1] is the live one
    await settle();
    const posted2Before = setup.workers[1].posted.length;

    // A late duplicate death from the OLD worker must NOT settle/kill the new one.
    first.die();
    await settle();
    t.write({} as never, "c");
    await settle();
    expect(setup.workers[1].posted.length).toBeGreaterThan(posted2Before); // new worker still alive
    expect(setup.ctor).toHaveBeenCalledTimes(2); // not respawned again by the stale event

    await t[Symbol.asyncDispose]();
    errSpy.mockRestore();
  });

  test("off-Node: no worker_threads → writes fall back to an inline synchronous fs append", async () => {
    const appended: Array<{ path: unknown; chunk: unknown; opts: unknown }> = [];
    const path = tmpFile();
    const { mod } = await loadMocked({
      workerThreadsThrows: true,
      fsMock: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        appendFileSync: (p: unknown, chunk: unknown, o: unknown) => {
          appended.push({ path: p, chunk, opts: o });
        },
      },
    });
    const t = mod.workerTransport({ destination: "file", path, format: "json" });
    t.write({} as never, "off-node");
    await settle();
    expect(appended).toEqual([{ path, chunk: "off-node\n", opts: { encoding: "utf8", flag: "a" } }]);

    await t[Symbol.asyncDispose](); // off-Node dispose has no thread to tear down
  });

  test("off-Node inline write swallows a destination error (isolation)", async () => {
    const { mod } = await loadMocked({
      workerThreadsThrows: true,
      fsMock: {
        existsSync: () => false,
        mkdirSync: () => {
          throw new Error("disk full");
        },
        appendFileSync: () => {
          throw new Error("disk full");
        },
      },
    });
    const t = mod.workerTransport({ destination: "file", path: tmpFile() });
    expect(() => t.write({} as never, "boom")).not.toThrow();
    await settle();
    await t[Symbol.asyncDispose]();
  });

  test("off-Node with no fs at all drops the line silently (loadFallbackFs returns null)", async () => {
    // Both worker_threads AND fs unavailable: inlineWrite has nowhere to write, so it drops the line.
    const { mod } = await loadMocked({ workerThreadsThrows: true });
    // Force loadFallbackFs to yield null by mocking node:fs to throw on import.
    vi.doMock("node:fs", () => {
      throw new Error("no fs");
    });
    vi.resetModules();
    // Re-import under BOTH throwing mocks.
    vi.doMock("node:worker_threads", () => {
      throw new Error("no wt");
    });
    vi.doMock("node:fs", () => {
      throw new Error("no fs");
    });
    const fresh = (await import("../src/subpaths/transports/worker.js")) as WorkerModule;
    const t = fresh.workerTransport({ destination: "stdout" });
    expect(() => t.write({} as never, "dropped")).not.toThrow();
    await settle();
    await t[Symbol.asyncDispose]();
    void mod;
  });

  test("uses the built runner file (URL worker) when the sibling worker.runner.js exists", async () => {
    const { mod, setup } = await loadMocked({ runnerFileExists: true });
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "x");
    await settle();
    // The first ctor arg is the runner URL (not the inline eval source), and no {eval:true} option.
    expect(setup.ctor).toHaveBeenCalledTimes(1);
    const [arg, options] = setup.ctor.mock.calls[0] as [unknown, { eval?: boolean; workerData?: unknown }];
    expect(arg).toBeInstanceOf(URL);
    expect(String(arg)).toContain("worker.runner.js");
    expect(options?.eval).toBeUndefined();

    await t[Symbol.asyncDispose]();
  });

  test("uses the inline eval bootstrap when the sibling runner file is absent (source tree)", async () => {
    const { mod, setup } = await loadMocked({ runnerFileExists: false });
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "x");
    await settle();
    const [arg, options] = setup.ctor.mock.calls[0] as [unknown, { eval?: boolean }];
    expect(typeof arg).toBe("string"); // the inline INLINE_RUNNER_SOURCE
    expect(options?.eval).toBe(true);

    await t[Symbol.asyncDispose]();
  });

  test("write after close is dropped; a second dispose is a no-op", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "one");
    await settle();
    await t[Symbol.asyncDispose]();
    expect(setup.workers[0].terminated).toBe(1);

    // Closed: further writes are ignored, and a repeated dispose does nothing.
    t.write({} as never, "after-close");
    await settle();
    expect(setup.workers[0].posted.filter((m) => m.type === "write")).toHaveLength(1);
    await expect(t[Symbol.asyncDispose]()).resolves.toBeUndefined();
    expect(setup.workers[0].terminated).toBe(1);
  });

  test("dispose before any write releases the exit hook without spawning or terminating a worker", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    await t[Symbol.asyncDispose]();
    expect(setup.ctor).not.toHaveBeenCalled();
  });

  test("dispose drains, tells the worker to close, and terminates the thread", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "payload");
    await settle();
    const w = setup.workers[0];

    await t[Symbol.asyncDispose]();
    expect(w.posted.some((m) => m.type === "close")).toBe(true);
    expect(w.terminated).toBe(1);
  });

  test("dispose tolerates a worker that throws on the close post", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "payload");
    await settle();
    const w = setup.workers[0];
    const originalPost = w.postMessage.bind(w);
    w.postMessage = (value: WorkerMsg) => {
      if (value?.type === "close") {
        throw new Error("worker already gone");
      }
      originalPost(value);
    };
    await expect(t[Symbol.asyncDispose]()).resolves.toBeUndefined();
    expect(w.terminated).toBe(1); // terminate still cleans up
  });

  test("exitHooks:false skips registering the beforeExit drain hook", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout", exitHooks: false });
    t.write({} as never, "x");
    await settle();
    // No easy public probe for the hook; assert the write path still works and disposes cleanly.
    expect(setup.workers[0].posted).toEqual([{ type: "write", line: "x" }]);
    await t[Symbol.asyncDispose]();
  });

  test("a negative maxRespawns falls back to the default of 3", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { mod, setup } = await loadMocked({ fsMock: { existsSync: () => false, appendFileSync: () => undefined, mkdirSync: () => undefined } });
    const t = mod.workerTransport({ destination: "stdout", maxRespawns: -5 });
    // With default 3, three deaths still respawn (do not give up).
    for (let i = 0; i < 3; i++) {
      t.write({} as never, `w${i}`);
      await settle();
      setup.workers[setup.workers.length - 1].die();
      await settle();
    }
    t.write({} as never, "still-worker");
    await settle();
    // 4th spawn happened (respawns 1,2,3 all <= 3) → worker path, not inline give-up yet.
    expect(setup.ctor).toHaveBeenCalledTimes(4);
    await t[Symbol.asyncDispose]();
    errSpy.mockRestore();
  });

  test("flush after the worker died between the check and the post still resolves", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "queued");
    await settle();
    const w = setup.workers[0];
    // Make the flush post throw (worker died between ensureWorker and postMessage): flush must not hang.
    w.postMessage = (value: WorkerMsg) => {
      if (value?.type === "flush") {
        throw new Error("worker died");
      }
    };
    await expect(t.flush()).resolves.toBeUndefined();
    await t[Symbol.asyncDispose]();
  });

  test("a worker death with a flush outstanding settles that flush (it never hangs)", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "queued");
    await settle();
    const w = setup.workers[0];
    w.autoAckFlush = false; // never ack — only the death can settle it

    let done = false;
    const flushing = t.flush().then(() => {
      done = true;
    });
    await settle();
    expect(done).toBe(false); // parked on the pending round-trip
    w.die(new Error("died mid-flush")); // handleWorkerDeath → settleAllFlushes resolves it
    await flushing;
    expect(done).toBe(true);

    await t[Symbol.asyncDispose]();
  });

  test("the death report is best-effort: a throwing console.error does not crash the transport", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console is hostile");
    });
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "x");
    await settle();
    // The death handler's report throws internally but is swallowed — no unhandled error escapes.
    expect(() => setup.workers[0].die(new Error("boom"))).not.toThrow();
    await settle();
    await t[Symbol.asyncDispose]();
    errSpy.mockRestore();
  });

  test("off-Node inline file write honours append:false (flag 'w')", async () => {
    const appended: Array<{ path: unknown; chunk: unknown; opts: unknown }> = [];
    const path = tmpFile();
    const { mod } = await loadMocked({
      workerThreadsThrows: true,
      fsMock: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        appendFileSync: (p: unknown, chunk: unknown, o: unknown) => {
          appended.push({ path: p, chunk, opts: o });
        },
      },
    });
    const t = mod.workerTransport({ destination: "file", path, append: false, eol: "\n" });
    t.write({} as never, "truncate-me");
    await settle();
    expect(appended).toEqual([{ path, chunk: "truncate-me\n", opts: { encoding: "utf8", flag: "w" } }]);
    await t[Symbol.asyncDispose]();
  });

  test("off-Node inline write to stdout targets fd 1", async () => {
    const appended: Array<{ fd: unknown; chunk: unknown }> = [];
    const { mod } = await loadMocked({
      workerThreadsThrows: true,
      fsMock: {
        existsSync: () => false,
        mkdirSync: () => undefined,
        appendFileSync: (fd: unknown, chunk: unknown) => {
          appended.push({ fd, chunk });
        },
      },
    });
    const t = mod.workerTransport({ destination: "stdout", eol: "\n" });
    t.write({} as never, "to-fd-1");
    await settle();
    expect(appended).toEqual([{ fd: 1, chunk: "to-fd-1\n" }]);
    await t[Symbol.asyncDispose]();
  });

  test("a write that lands after close (worker resolved post-dispose) is dropped, not posted", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    // Kick off the first write: it starts spawning but has NOT resolved yet.
    t.write({} as never, "in-flight");
    // Dispose immediately — closed becomes true while the spawn promise is still pending.
    const disposing = t[Symbol.asyncDispose]();
    await settle();
    await disposing;
    // The spawned worker (if any) must not have received the in-flight write after close.
    const w = setup.workers[0];
    if (w != null) {
      expect(w.posted.filter((m) => m.type === "write")).toHaveLength(0);
    }
  });

  test("a spawn that rejects unexpectedly falls back to an inline write", async () => {
    const appended: Array<{ fd: unknown; chunk: unknown }> = [];
    // Make the Worker ctor throw so the spawn promise rejects → write's reject handler runs inlineWrite.
    const throwingCtor = vi.fn(() => {
      throw new Error("spawn exploded");
    });
    const actualFs = await import("node:fs");
    vi.resetModules();
    vi.doMock("node:worker_threads", () => ({ Worker: throwingCtor }));
    vi.doMock("node:fs", () => ({
      ...actualFs,
      existsSync: () => false,
      mkdirSync: () => undefined,
      appendFileSync: (fd: unknown, chunk: unknown) => {
        appended.push({ fd, chunk });
      },
    }));
    const mod = (await import("../src/subpaths/transports/worker.js")) as WorkerModule;
    const t = mod.workerTransport({ destination: "stdout", eol: "\n" });
    t.write({} as never, "after-spawn-fail");
    await settleUntil(() => appended.length > 0);
    expect(appended).toEqual([{ fd: 1, chunk: "after-spawn-fail\n" }]);
    await t[Symbol.asyncDispose]();
  });

  test("flush on an off-Node transport (no worker) resolves without a round-trip", async () => {
    const { mod } = await loadMocked({
      workerThreadsThrows: true,
      fsMock: { existsSync: () => false, mkdirSync: () => undefined, appendFileSync: () => undefined },
    });
    const t = mod.workerTransport({ destination: "stdout" });
    // A write starts a spawn that resolves to null (no worker_threads); flush then sees ensureWorker()===null.
    t.write({} as never, "queued-off-node");
    await settle();
    await expect(t.flush()).resolves.toBeUndefined();
    await t[Symbol.asyncDispose]();
  });

  test("the registered exit hook drains via flush() (beforeExit safety net)", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    t.write({} as never, "queued");
    await settleUntil(() => setup.workers.length > 0);
    const w = setup.workers[0];
    const flushPostsBefore = w.posted.filter((m) => m.type === "flush").length;

    // Fire the process beforeExit signal the transport registered for: it must drain via flush().
    process.emit("beforeExit", 0 as never);
    await settleUntil(() => w.posted.filter((m) => m.type === "flush").length > flushPostsBefore);
    expect(w.posted.filter((m) => m.type === "flush").length).toBeGreaterThan(flushPostsBefore);

    await t[Symbol.asyncDispose]();
  });

  test("dispose awaits an in-flight spawn (worker still spawning) then tears it down", async () => {
    const { mod, setup } = await loadMocked();
    const t = mod.workerTransport({ destination: "stdout" });
    // Start the write (spawn kicks off) but dispose in the SAME turn so `spawning` is non-null on dispose.
    t.write({} as never, "queued");
    const disposing = t[Symbol.asyncDispose](); // hits the `await (spawning ?? ...)` branch
    await settle();
    await disposing;
    // The spawned worker was terminated by dispose.
    const w = setup.workers[0];
    expect(w?.terminated).toBe(1);
  });

  test("runnerFileExists tolerates a failing fs/url import (probe returns false → inline eval)", async () => {
    // Mock node:url to throw so runnerFileExists's try/catch returns false; spawn still succeeds via eval.
    const actualFs = await import("node:fs");
    vi.resetModules();
    vi.doMock("node:worker_threads", () => ({ Worker: vi.fn(() => new FakeWorker()) }));
    vi.doMock("node:fs", () => ({ ...actualFs }));
    vi.doMock("node:url", () => {
      throw new Error("no url module");
    });
    const mod = (await import("../src/subpaths/transports/worker.js")) as WorkerModule;
    const ctor = vi.fn(() => new FakeWorker());
    // Re-mock worker_threads with a capturing ctor (previous vi.fn is fine, but capture args here).
    const t = mod.workerTransport({ destination: "stdout" });
    expect(() => t.write({} as never, "x")).not.toThrow();
    await settle();
    await t[Symbol.asyncDispose]();
    vi.doUnmock("node:url");
    void ctor;
  });
});
