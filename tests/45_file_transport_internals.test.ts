import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ILogObjMeta } from "../src/interfaces.js";

// NOTE: do NOT statically import from "node:fs" here — that caches the real module in the graph and the
// per-test `vi.doMock("node:fs")` would then fail to apply. All synchronous file reads below go through
// the async `readFile` from "node:fs/promises" (never mocked).

// These file-transport branches need control over the OPENED node:fs write stream that the transport
// builds internally, and over the exit-hook wiring. That means mocking `node:fs`'s `createWriteStream`
// (and, for one test, the exit-hook registry) and importing a FRESH `fileTransport` per test. This lives
// in its own file — with NO static import of the transport — because a static import would cache the real
// module in the graph and the first `vi.doMock` after 27 unmocked tests would fail to apply. The mocks
// are undone and the module registry reset in afterEach so nothing leaks to sibling test files.

const isNode = process.versions.node != null && (process.versions as Record<string, string | undefined>).bun == null;

const META = {} as ILogObjMeta;

/** Poll until `predicate()` is true or the deadline passes — avoids racing on async stream events. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: condition not met within timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tslog-file-internals-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A fake WriteStream that captures written chunks and lets a test withhold or fire each callback. */
function makeControllableStream() {
  const chunks: string[] = [];
  const pendingCallbacks: Array<(error?: Error | null) => void> = [];
  let errorListener: ((error: unknown) => void) | undefined;
  const stream = {
    write(chunk: string, callback?: (error?: Error | null) => void): boolean {
      chunks.push(chunk);
      if (callback != null) {
        pendingCallbacks.push(callback);
      }
      return true;
    },
    on(event: string, listener: (...args: unknown[]) => void): unknown {
      if (event === "error") {
        errorListener = listener as (error: unknown) => void;
      }
      return stream;
    },
    end(callback?: () => void): unknown {
      callback?.();
      return stream;
    },
    writableEnded: false,
  };
  return {
    stream,
    chunks,
    confirmNext(): void {
      pendingCallbacks.shift()?.(null);
    },
    confirmAll(): void {
      while (pendingCallbacks.length > 0) {
        pendingCallbacks.shift()?.(null);
      }
    },
    emitError(error: Error): void {
      errorListener?.(error);
    },
  };
}

/** Mock `node:fs.createWriteStream` with the given factory and return a fresh `fileTransport`. */
async function loadFileTransport(createWriteStream: (...args: unknown[]) => unknown) {
  const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.doMock("node:fs", () => ({ ...realFs, createWriteStream }));
  vi.resetModules();
  return (await import("../src/subpaths/transports/file.js")).fileTransport;
}

describe.runIf(isNode)("fileTransport (opened-stream internals)", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.doUnmock("../src/internal/exitHooks.js");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  test("flushSync skips the single mid-syscall submitted entry and writes the rest with its own fd", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "skip.log");
      const controllable = makeControllableStream();
      const fileTransport = await loadFileTransport(() => controllable.stream);
      const transport = fileTransport<unknown>({ path, exitHooks: false });

      // First write opens the fake stream and submits the chunk, but the write callback is withheld, so
      // it stays in `unconfirmed` with submitted=true while `stream != null`.
      transport.write(META, "mid-syscall");
      await waitFor(() => controllable.chunks.length === 1);
      // Second write takes the fast path (stream already set) and is also submitted-but-unconfirmed.
      transport.write(META, "rescued");
      await waitFor(() => controllable.chunks.length === 2);

      // flushSync: the FIRST submitted entry is skipped (rewriting it would duplicate on process.exit),
      // every other entry is rescued to the real file via openSync/writeSync.
      transport.flushSync();
      expect(await readFile(path, "utf8")).toBe("rescued\n");
      // Confirm the withheld writes so the disposer's flush() can drain (otherwise it would await forever).
      controllable.confirmAll();
      await transport[Symbol.asyncDispose]();
    });
  });

  test("an error AFTER a successful write is classified as 'write' and abandons the broken stream", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "reopen.log");
      const first = makeControllableStream();
      const second = makeControllableStream();
      let call = 0;
      const fileTransport = await loadFileTransport(() => (call++ === 0 ? first.stream : second.stream));
      const seen: string[] = [];
      const transport = fileTransport<unknown>({ path, exitHooks: false, onError: (_error, context) => seen.push(context) });

      // Open + successfully write once so streamReady flips to true.
      transport.write(META, "one");
      await waitFor(() => first.chunks.length === 1);
      first.confirmNext();
      await transport.flush();

      // Now the stream errors: streamReady is true, so this is a "write" error, and the broken
      // stream is abandoned (stream=null, opening=null) so the next write reopens a fresh one.
      first.emitError(new Error("late failure"));
      expect(seen).toContain("write");

      transport.write(META, "two");
      await waitFor(() => second.chunks.length === 1);
      second.confirmNext();
      await transport.flush();
      // The retry landed on the SECOND (fresh) stream, proving the broken one was abandoned.
      expect(second.chunks).toEqual(["two\n"]);
      await transport[Symbol.asyncDispose]();
    });
  });

  test("registered exit hook drives flushSync (drainSync) and flush (flushAsync)", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "exit-hook.log");
      const controllable = makeControllableStream();
      const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
      vi.doMock("node:fs", () => ({ ...realFs, createWriteStream: () => controllable.stream }));

      // Capture the ExitHook the transport registers so we can invoke its callbacks directly.
      let captured: { drainSync?: () => void; flushAsync?: () => Promise<void> | void } | undefined;
      const realHooks = await vi.importActual<typeof import("../src/internal/exitHooks.js")>("../src/internal/exitHooks.js");
      vi.doMock("../src/internal/exitHooks.js", () => ({
        ...realHooks,
        registerExitHook: (hook: typeof captured) => {
          captured = hook;
          return () => undefined;
        },
      }));
      vi.resetModules();
      const fileTransport = (await import("../src/subpaths/transports/file.js")).fileTransport;

      // exitHooks defaults to true, so the first write registers the hook.
      const transport = fileTransport<unknown>({ path });
      // Two submitted-but-unconfirmed writes (callbacks withheld): the FIRST is the single
      // possibly-mid-syscall entry, the second is queued behind it in the stream's memory buffer.
      transport.write(META, "mid-syscall");
      await waitFor(() => controllable.chunks.length === 1);
      transport.write(META, "rescued-by-hook");
      await waitFor(() => controllable.chunks.length === 2);
      expect(captured).toBeDefined();

      // The hook's drainSync closure is transport.flushSync(): it must skip the first (mid-syscall)
      // entry and rescue the second to the real file via its own fd.
      captured?.drainSync?.();
      expect(await readFile(path, "utf8")).toBe("rescued-by-hook\n");

      // The hook's flushAsync closure is transport.flush(): it resolves once the stream confirms the
      // still-tracked first write.
      const flushed = Promise.resolve(captured?.flushAsync?.());
      controllable.confirmAll();
      await expect(flushed).resolves.toBeUndefined();
      await transport[Symbol.asyncDispose]();
    });
  });
});
