import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StdoutJsonSink } from "../src/env/stdoutSink.node.js";
import type { ExitHook } from "../src/internal/exitHooks.js";

// Process-exit hooks (src/internal/exitHooks.ts) and the buffered stdout sink's synchronous
// drainSync/EAGAIN paths (src/env/stdoutSink.node.ts). Subprocess repros in 57/61 prove the wiring
// end-to-end but don't count toward coverage; here we capture the handlers the module registers on
// `process` and invoke them BY HAND, and we drive the sink's exit-time fs.writeSync loop directly.

const isNode = process.versions.node != null && (process.versions as Record<string, string | undefined>).bun == null;

/**
 * Load a fresh copy of exitHooks with `process.on` spied, so we can capture the exact `beforeExit`
 * and `exit` listeners the module installs on first registration and call them ourselves. The module
 * has process-lifetime state (`installed`, `flushCascadeRan`, the hook Set), so every test resets the
 * registry first.
 */
async function freshExitHooks(): Promise<{
  registerExitHook: (hook: ExitHook) => () => void;
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  onSpy: ReturnType<typeof vi.spyOn>;
}> {
  vi.resetModules();
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const onSpy = vi.spyOn(process, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    const list = handlers.get(event) ?? [];
    list.push(listener);
    handlers.set(event, list);
    return process;
  }) as never);
  const mod = await import("../src/internal/exitHooks.js");
  return { registerExitHook: mod.registerExitHook, handlers, onSpy };
}

describe.runIf(isNode)("exitHooks: process listeners", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("first registration installs exactly one beforeExit and one exit listener", async () => {
    const { registerExitHook, handlers } = await freshExitHooks();
    registerExitHook({ drainSync: () => undefined });
    registerExitHook({ drainSync: () => undefined });
    // installOnce is latched: a second registration must not add duplicate process listeners.
    expect(handlers.get("beforeExit")).toHaveLength(1);
    expect(handlers.get("exit")).toHaveLength(1);
  });

  test("the exit listener runs every hook's drainSync and swallows one that throws", async () => {
    const { registerExitHook, handlers } = await freshExitHooks();
    const order: string[] = [];
    registerExitHook({
      drainSync: () => {
        order.push("a");
      },
    });
    registerExitHook({
      drainSync: () => {
        order.push("throw");
        throw new Error("a drain must never crash the exit");
      },
    });
    registerExitHook({
      drainSync: () => {
        order.push("c");
      },
    });
    // A hook with no drainSync is skipped by the optional-call, not a crash.
    registerExitHook({ flushAsync: () => undefined });

    const exit = handlers.get("exit")?.[0];
    expect(exit).toBeTypeOf("function");
    expect(() => exit?.(0)).not.toThrow();
    // The throwing hook was reached AND the later hook still ran.
    expect(order).toEqual(["a", "throw", "c"]);
  });

  test("the beforeExit listener runs flushAsync once, catches sync throws, and swallows async rejections", async () => {
    const { registerExitHook, handlers } = await freshExitHooks();
    const calls: string[] = [];
    let rejectingSettled: (() => void) | undefined;
    const rejecting = new Promise<void>((resolve) => {
      rejectingSettled = resolve;
    });

    registerExitHook({
      flushAsync: () => {
        calls.push("ok");
      },
    });
    registerExitHook({
      flushAsync: () => {
        calls.push("sync-throw");
        throw new Error("sync flush fault");
      },
    });
    registerExitHook({
      // returns a rejected promise: the module must attach a .catch so it isn't an unhandled rejection
      flushAsync: () => {
        calls.push("reject");
        rejectingSettled?.();
        return Promise.reject(new Error("async flush fault"));
      },
    });
    // A hook without flushAsync is skipped.
    registerExitHook({ drainSync: () => undefined });

    const beforeExit = handlers.get("beforeExit")?.[0];
    expect(beforeExit).toBeTypeOf("function");
    expect(() => beforeExit?.(0)).not.toThrow();
    expect(calls).toEqual(["ok", "sync-throw", "reject"]);

    // Let the rejected promise's swallowing .catch run — a real unhandled rejection would fail the run.
    await rejecting;
    await Promise.resolve();
  });

  test("the async flush cascade runs at most once per process (later ticks are no-ops)", async () => {
    const { registerExitHook, handlers } = await freshExitHooks();
    let flushes = 0;
    registerExitHook({
      flushAsync: () => {
        flushes++;
      },
    });
    const beforeExit = handlers.get("beforeExit")?.[0];
    beforeExit?.(0);
    beforeExit?.(0);
    beforeExit?.(0);
    // flushCascadeRan latch: only the first tick actually flushes.
    expect(flushes).toBe(1);
  });

  test("unregister removes the hook so it no longer runs at exit", async () => {
    const { registerExitHook, handlers } = await freshExitHooks();
    let drained = 0;
    const unregister = registerExitHook({
      drainSync: () => {
        drained++;
      },
    });
    const exit = handlers.get("exit")?.[0];
    exit?.(0);
    expect(drained).toBe(1);

    unregister();
    // idempotent: a second unregister is a harmless Set.delete of an absent member
    unregister();
    exit?.(0);
    expect(drained).toBe(1);
  });
});

describe.runIf(isNode)("exitHooks: browser and no-signal runtimes", () => {
  const realProcess = globalThis.process;

  afterEach(() => {
    // Restore the real process global that the browser-path tests deleted.
    Object.defineProperty(globalThis, "process", { value: realProcess, configurable: true, writable: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Import exitHooks with `process` absent, so installOnce falls through to the browser pagehide path. */
  async function freshBrowserHooks(win: { addEventListener?: unknown; document?: unknown }): Promise<{
    registerExitHook: (hook: ExitHook) => () => void;
  }> {
    vi.resetModules();
    // The module reads process off globalThis; remove it so `typeof proc?.on === "function"` is false.
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
    for (const [key, value] of Object.entries(win)) {
      vi.stubGlobal(key, value);
    }
    const mod = await import("../src/internal/exitHooks.js");
    return { registerExitHook: mod.registerExitHook };
  }

  test("installs a pagehide listener that runs both sync drains and the async flush", async () => {
    const pagehide: (() => void)[] = [];
    const addEventListener = (event: string, listener: () => void): void => {
      if (event === "pagehide") {
        pagehide.push(listener);
      }
    };
    const { registerExitHook } = await freshBrowserHooks({ addEventListener, document: {} });

    const events: string[] = [];
    registerExitHook({
      drainSync: () => {
        events.push("drain");
      },
      flushAsync: () => {
        events.push("flush");
      },
    });

    expect(pagehide).toHaveLength(1);
    pagehide[0]();
    // pagehide runs the sync drains first, then kicks off the async flush.
    expect(events).toEqual(["drain", "flush"]);
  });

  test("no addEventListener means the runtime simply has no exit signal (registration still works)", async () => {
    // window has document but no addEventListener → the browser branch condition is false; the hook is
    // stored and only ever runs if a signal arrives (it never does here). Registration must not throw.
    const { registerExitHook } = await freshBrowserHooks({ document: {} });
    let ran = false;
    const unregister = registerExitHook({
      drainSync: () => {
        ran = true;
      },
    });
    expect(unregister).toBeTypeOf("function");
    expect(ran).toBe(false);
    unregister();
  });

  test("a throwing addEventListener is swallowed (no exit signal, no crash)", async () => {
    const addEventListener = (): void => {
      throw new Error("hostile addEventListener");
    };
    const { registerExitHook } = await freshBrowserHooks({ addEventListener, document: {} });
    // The install try/catch swallows the throw; registration returns normally.
    expect(() => registerExitHook({ drainSync: () => undefined })).not.toThrow();
  });

  test("a process whose `on` access throws falls through to the browser path", async () => {
    vi.resetModules();
    const pagehide: (() => void)[] = [];
    // A process object that throws when `.on` is read: the first try/catch swallows it and the module
    // continues to the browser branch.
    const hostileProcess = {
      get on() {
        throw new Error("hostile process.on getter");
      },
    };
    Object.defineProperty(globalThis, "process", { value: hostileProcess, configurable: true, writable: true });
    vi.stubGlobal("addEventListener", (event: string, listener: () => void) => {
      if (event === "pagehide") {
        pagehide.push(listener);
      }
    });
    vi.stubGlobal("document", {});
    const { registerExitHook } = await import("../src/internal/exitHooks.js");

    let drained = false;
    registerExitHook({
      drainSync: () => {
        drained = true;
      },
    });
    expect(pagehide).toHaveLength(1);
    pagehide[0]();
    expect(drained).toBe(true);
  });
});

/**
 * A fake stdout stream with a controllable `fd` and a `write` capture. drainSync reads `.fd` for the
 * synchronous fs.writeSync path and falls back to `write` (via writeChunk) for any un-written remainder.
 */
interface FakeStdout {
  fd: number;
  write: (chunk: string, cb?: () => void) => boolean;
  on: (event: string, listener: () => void) => void;
  captured: string[];
}

function fakeStdout(fd: number): FakeStdout {
  const captured: string[] = [];
  return {
    fd,
    captured,
    write(chunk: string, cb?: () => void): boolean {
      captured.push(chunk);
      cb?.();
      return true;
    },
    on(): void {
      // no-op error guard target
    },
  };
}

/**
 * Freshly import the sink with `process.on` spied, capture the `exit` listener the exit hook installs,
 * and return a way to invoke it — that listener runs the sink's `drainSync` with microtasks disabled,
 * exactly as `process.on("exit")` would. A fresh module registry means the captured listener drains
 * ONLY this sink.
 */
async function freshSinkWithExitDrain(): Promise<{
  sink: StdoutJsonSink;
  runExitDrain: () => void;
}> {
  vi.resetModules();
  let exitListener: ((...args: unknown[]) => void) | undefined;
  vi.spyOn(process, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "exit") {
      exitListener = listener;
    }
    return process;
  }) as never);
  const { getStdoutJsonSink } = await import("../src/env/stdoutSink.node.js");
  const sink = getStdoutJsonSink();
  return {
    sink,
    runExitDrain: () => {
      if (exitListener == null) {
        throw new Error("no exit listener was captured");
      }
      exitListener(0);
    },
  };
}

describe.runIf(isNode)("stdoutSink: synchronous exit drain (drainSync)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("drainSync writes the whole buffer to the stdout fd in one shot when the fd accepts it all", async () => {
    const dir = fs.mkdtempSync(join(tmpdir(), "tslog-sink-"));
    const tmp = join(dir, "sink-drain-full.txt");
    const fd = fs.openSync(tmp, "w");
    const stdout = fakeStdout(fd);
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    try {
      const { sink, runExitDrain } = await freshSinkWithExitDrain();
      sink.write('{"m":"exit-full-1"}');
      sink.write('{"m":"exit-full-2"}');
      // The exit drain must go through fs.writeSync (the fd), NOT the stream write fallback.
      runExitDrain();
      expect(stdout.captured).toHaveLength(0);
      const written = fs.readFileSync(tmp, "utf8");
      expect(written).toContain('"exit-full-1"');
      expect(written).toContain('"exit-full-2"');
      expect(written.endsWith("\n")).toBe(true);
    } finally {
      getter.mockRestore();
      fs.closeSync(fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("drainSync loops on a partial write and hands the un-written remainder to the stream", async () => {
    // Deterministic partial write: the sink resolves fs.writeSync lazily on the FIRST drain, so a spy
    // installed beforehand is what it caches. First call accepts 5 bytes, the retry throws EAGAIN —
    // the loop must advance the offset and hand the exact un-written byte suffix to the stream
    // fallback. The line stays far below FLUSH_THRESHOLD_CHARS: a big line would flush inline through
    // the stream at write() time and leave the exit drain nothing to do (an earlier version of this
    // test used a 400KB line over a mkfifo and never actually reached the drain loop).
    const stdout = fakeStdout(99);
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    let calls = 0;
    const writeSyncSpy = vi.spyOn(fs, "writeSync").mockImplementation(((_fd: number, _data: Uint8Array) => {
      calls += 1;
      if (calls === 1) {
        return 5; // the kernel accepted only the first 5 bytes
      }
      const eagain = new Error("EAGAIN: resource temporarily unavailable") as NodeJS.ErrnoException;
      eagain.code = "EAGAIN";
      throw eagain;
    }) as never);
    try {
      const { sink, runExitDrain } = await freshSinkWithExitDrain();
      sink.write('{"m":"partial"}');
      runExitDrain();
      // Two writeSync attempts (partial, then EAGAIN), then exactly the bytes past offset 5 reach the
      // stream — no re-sent prefix, no dropped tail.
      expect(calls).toBe(2);
      expect(stdout.captured.join("")).toBe('{"m":"partial"}\n'.slice(5));
    } finally {
      writeSyncSpy.mockRestore();
      getter.mockRestore();
    }
  });

  test("drainSync sends the whole buffer to the stream when the fd is unusable (write throws)", async () => {
    // A closed fd makes fs.writeSync throw synchronously (EBADF) on the FIRST write — offset never
    // advances, so the entire chunk becomes the remainder handed to the stream fallback.
    const dir = fs.mkdtempSync(join(tmpdir(), "tslog-sink-"));
    const tmp = join(dir, "sink-drain-badfd.txt");
    const fd = fs.openSync(tmp, "w");
    fs.closeSync(fd); // now `fd` is a closed, invalid descriptor
    const stdout = fakeStdout(fd);
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    try {
      const { sink, runExitDrain } = await freshSinkWithExitDrain();
      sink.write('{"m":"badfd"}');
      runExitDrain();
      expect(stdout.captured.join("")).toContain('"badfd"');
    } finally {
      getter.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("drainSync on an empty buffer is a no-op (nothing written)", async () => {
    const stdout = fakeStdout(1);
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    try {
      const { runExitDrain } = await freshSinkWithExitDrain();
      runExitDrain();
      expect(stdout.captured).toHaveLength(0);
    } finally {
      getter.mockRestore();
    }
  });

  test("drainSync falls back to fd 1 when the stdout stream exposes no fd", async () => {
    // The `?? 1` fallback: a stdout stream WITHOUT an `.fd` makes drainSync target fd 1. Intercept
    // fs.writeSync (the sink caches it lazily on this first drain) so the runner's real stdout is
    // never touched, and assert both the fd and the payload.
    const seen: Array<{ fd: number; text: string }> = [];
    const writeSyncSpy = vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, data: Uint8Array) => {
      seen.push({ fd, text: Buffer.from(data).toString("utf8") });
      return data.length;
    }) as never);
    const stdout = {
      write(_chunk: string, cb?: () => void): boolean {
        cb?.();
        return true;
      },
      on(): void {
        // no-op
      },
    };
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    try {
      const { sink, runExitDrain } = await freshSinkWithExitDrain();
      sink.write('{"m":"nofd"}');
      runExitDrain();
      expect(seen).toEqual([{ fd: 1, text: '{"m":"nofd"}\n' }]);
    } finally {
      getter.mockRestore();
      writeSyncSpy.mockRestore();
    }
  });
});

describe.runIf(isNode)("stdoutSink: writeChunk error-guard and console fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("a stream whose `on` throws is still written to (the listener error is swallowed)", async () => {
    const captured: string[] = [];
    const stdout = {
      write(chunk: string, cb?: () => void): boolean {
        captured.push(chunk);
        cb?.();
        return true;
      },
      on(): void {
        throw new Error("stream rejects listeners");
      },
    };
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    try {
      const { sink } = await freshSinkWithExitDrain();
      sink.write('{"m":"listener-throws"}');
      expect(() => sink.flushSync()).not.toThrow();
      expect(captured.join("")).toContain('"listener-throws"');
    } finally {
      getter.mockRestore();
    }
  });

  test("falls back to console.log (newline trimmed) when the stream has no write method", async () => {
    const printed: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      printed.push(String(line));
    });
    // A stdout stream WITHOUT a `write` function: writeChunk degrades to the console path.
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue({ on: () => undefined } as unknown as NodeJS.WriteStream);
    try {
      const { sink } = await freshSinkWithExitDrain();
      sink.write('{"m":"console-fallback"}');
      sink.flushSync();
      expect(printed).toHaveLength(1);
      // The chunk is newline-terminated; the console fallback strips the trailing newline.
      expect(printed[0]).toBe('{"m":"console-fallback"}');
    } finally {
      getter.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  test("the console fallback swallows a console.log that itself throws (last-resort drop)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("even console is broken");
    });
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue({ on: () => undefined } as unknown as NodeJS.WriteStream);
    try {
      const { sink } = await freshSinkWithExitDrain();
      sink.write('{"m":"drop"}');
      expect(() => sink.flushSync()).not.toThrow();
    } finally {
      getter.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  test("the registered flushAsync hook drains the sink asynchronously (beforeExit path)", async () => {
    const captured: string[] = [];
    const stdout = {
      write(chunk: string, cb?: () => void): boolean {
        captured.push(chunk);
        cb?.();
        return true;
      },
      on(): void {
        // no-op
      },
    };
    const getter = vi.spyOn(process, "stdout", "get").mockReturnValue(stdout as unknown as NodeJS.WriteStream);
    let beforeExitListener: ((...args: unknown[]) => void) | undefined;
    vi.spyOn(process, "on").mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
      if (event === "beforeExit") {
        beforeExitListener = listener;
      }
      return process;
    }) as never);
    try {
      vi.resetModules();
      const { getStdoutJsonSink } = await import("../src/env/stdoutSink.node.js");
      const sink = getStdoutJsonSink();
      sink.write('{"m":"async-flush"}');
      // Invoke the beforeExit hook the sink registered: it calls sink.flush() (the flushAsync arrow),
      // which hands the buffer to the stream SYNCHRONOUSLY. Assert before yielding to microtasks —
      // otherwise sink.write's own scheduled microtask flush would mask a never-registered hook.
      expect(beforeExitListener).toBeTypeOf("function");
      beforeExitListener?.(0);
      expect(captured.join("")).toContain('"async-flush"');
    } finally {
      getter.mockRestore();
    }
  });
});
