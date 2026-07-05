import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ILogObjMeta } from "../src/interfaces.js";
import { fileTransport } from "../src/subpaths/transports/file.js";

// `fileTransport` is a Node-only Transport that appends each formatted line to a node:fs write stream.
// These tests exercise the contract from the M2b spec: non-blocking writes, a flush() that actually
// drains, an async disposer that flushes+closes, lazy (side-effect-free) stream opening, and the
// rotation-by-composition seam (a supplied `stream`).

// The transport imports node:fs directly, so the whole suite is Node-only (Bun ships node:fs too, but
// the fd/`writeSync` and stream-error timing below are Node-specific enough to gate on Node).
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
  const dir = await mkdtemp(join(tmpdir(), "tslog-file-transport-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe.runIf(isNode)("fileTransport", () => {
  test("throws when neither path nor stream is supplied", () => {
    expect(() => fileTransport({})).toThrow(TypeError);
  });

  test("does not open the file until the first write (no import/construct-time IO)", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "lazy.log");
      const transport = fileTransport({ path });
      // Constructing the transport must not touch the filesystem.
      expect(existsSync(path)).toBe(false);
      transport.write(META, "first line");
      await transport.flush();
      expect(existsSync(path)).toBe(true);
      await transport[Symbol.asyncDispose]();
    });
  });

  test("writes lines (with newline terminators) and flush() drains them to disk", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "app.log");
      const transport = fileTransport({ path });

      transport.write(META, "line one");
      transport.write(META, "line two");
      transport.write(META, "line three");

      await transport.flush();
      const contents = await readFile(path, "utf8");
      expect(contents).toBe("line one\nline two\nline three\n");

      await transport[Symbol.asyncDispose]();
    });
  });

  test("write() returns synchronously (does not block on IO)", async () => {
    await withTempDir(async (dir) => {
      const transport = fileTransport({ path: join(dir, "nonblock.log") });
      const result = transport.write(META, "x");
      // The Transport contract allows void | Promise<void>; this implementation enqueues and returns void.
      expect(result).toBeUndefined();
      await transport.flush();
      await transport[Symbol.asyncDispose]();
    });
  });

  test("custom eol is respected", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "crlf.log");
      const transport = fileTransport({ path, eol: "\r\n" });
      transport.write(META, "a");
      transport.write(META, "b");
      await transport.flush();
      expect(await readFile(path, "utf8")).toBe("a\r\nb\r\n");
      await transport[Symbol.asyncDispose]();
    });
  });

  test("append:false truncates the file on open", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "trunc.log");

      const first = fileTransport({ path });
      first.write(META, "old content");
      await first.flush();
      await first[Symbol.asyncDispose]();

      const second = fileTransport({ path, append: false });
      second.write(META, "new content");
      await second.flush();
      expect(await readFile(path, "utf8")).toBe("new content\n");
      await second[Symbol.asyncDispose]();
    });
  });

  test("append:true (default) keeps existing content", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "append.log");

      const first = fileTransport({ path });
      first.write(META, "first run");
      await first.flush();
      await first[Symbol.asyncDispose]();

      const second = fileTransport({ path });
      second.write(META, "second run");
      await second.flush();
      expect(await readFile(path, "utf8")).toBe("first run\nsecond run\n");
      await second[Symbol.asyncDispose]();
    });
  });

  test("creates missing parent directories on first write", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "nested", "deeper", "app.log");
      const transport = fileTransport({ path });
      transport.write(META, "deep");
      await transport.flush();
      expect(await readFile(path, "utf8")).toBe("deep\n");
      await transport[Symbol.asyncDispose]();
    });
  });

  test("[Symbol.asyncDispose] flushes pending writes then closes the stream", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "dispose.log");
      const transport = fileTransport({ path });
      transport.write(META, "before dispose");
      // Dispose without an explicit flush first: dispose must drain the queued line.
      await transport[Symbol.asyncDispose]();
      expect(readFileSync(path, "utf8")).toBe("before dispose\n");

      // After dispose, further writes are dropped (no throw, no reopen).
      transport.write(META, "after dispose");
      await transport.flush();
      expect(readFileSync(path, "utf8")).toBe("before dispose\n");
    });
  });

  test("dispose is idempotent and dispose without any writes does not throw", async () => {
    await withTempDir(async (dir) => {
      const transport = fileTransport({ path: join(dir, "never-written.log") });
      await transport[Symbol.asyncDispose]();
      await transport[Symbol.asyncDispose]();
      // Nothing was ever written, so the file was never created.
      expect(existsSync(join(dir, "never-written.log"))).toBe(false);
    });
  });

  test("flush() with nothing pending resolves immediately", async () => {
    await withTempDir(async (dir) => {
      const transport = fileTransport({ path: join(dir, "empty.log") });
      await expect(transport.flush()).resolves.toBeUndefined();
      await transport[Symbol.asyncDispose]();
    });
  });

  test("exposes name/minLevel/format on the Transport for the logger to read", () => {
    const transport = fileTransport({ path: join(tmpdir(), "ignored.log"), name: "audit", minLevel: "WARN", format: "json" });
    expect(transport.name).toBe("audit");
    expect(transport.minLevel).toBe("WARN");
    expect(transport.format).toBe("json");
  });

  test("rotation via composition: writes to a supplied stream and end()s it on dispose", async () => {
    // Fake rotating stream standing in for e.g. rotating-file-stream: captures chunks + drain/end behaviour.
    const chunks: string[] = [];
    let ended = false;
    const fakeStream = {
      write(chunk: string, callback?: (error?: Error | null) => void): boolean {
        chunks.push(chunk);
        callback?.(null);
        return true;
      },
      once(): unknown {
        return this;
      },
      end(callback?: () => void): unknown {
        ended = true;
        callback?.();
        return this;
      },
      writableEnded: false,
    };

    const transport = fileTransport({ stream: fakeStream });
    transport.write(META, "rotated one");
    transport.write(META, "rotated two");
    await transport.flush();
    expect(chunks).toEqual(["rotated one\n", "rotated two\n"]);

    await transport[Symbol.asyncDispose]();
    expect(ended).toBe(true);
  });

  test("does not end a supplied stream that is already ended", async () => {
    let endCalls = 0;
    const fakeStream = {
      write(chunk: string, callback?: (error?: Error | null) => void): boolean {
        callback?.(null);
        return true;
      },
      once(): unknown {
        return this;
      },
      end(callback?: () => void): unknown {
        endCalls += 1;
        callback?.();
        return this;
      },
      writableEnded: true,
    };

    const transport = fileTransport({ stream: fakeStream });
    transport.write(META, "x");
    await transport[Symbol.asyncDispose]();
    expect(endCalls).toBe(0);
  });

  test("a write error is isolated: it never rejects the logging path, surfaces via flush", async () => {
    const fakeStream = {
      write(chunk: string, callback?: (error?: Error | null) => void): boolean {
        callback?.(new Error("disk full"));
        return true;
      },
      once(): unknown {
        return this;
      },
      end(callback?: () => void): unknown {
        callback?.();
        return this;
      },
      writableEnded: false,
    };

    const transport = fileTransport({ stream: fakeStream });
    // The synchronous write call must not throw even though the underlying write errors.
    expect(() => transport.write(META, "boom")).not.toThrow();
    // flush() uses allSettled internally, so a write error does not reject flush either.
    await expect(transport.flush()).resolves.toBeUndefined();
    await transport[Symbol.asyncDispose]();
  });

  // --- Error reporting: the onError callback and the default console.error report ------------------

  test("onError callback receives a write error with the 'write' context (custom sink)", async () => {
    const seen: { error: unknown; context: string }[] = [];
    const fakeStream = {
      write(_chunk: string, callback?: (error?: Error | null) => void): boolean {
        callback?.(new Error("disk full"));
        return true;
      },
      once(): unknown {
        return this;
      },
      end(callback?: () => void): unknown {
        callback?.();
        return this;
      },
      writableEnded: false,
    };
    const transport = fileTransport({ stream: fakeStream, onError: (error, context) => seen.push({ error, context }) });
    transport.write(META, "boom");
    await transport.flush();
    expect(seen).toHaveLength(1);
    expect((seen[0].error as Error).message).toBe("disk full");
    expect(seen[0].context).toBe("write");
    await transport[Symbol.asyncDispose]();
  });

  test("a throwing onError callback never escapes the transport", async () => {
    const fakeStream = {
      write(_chunk: string, callback?: (error?: Error | null) => void): boolean {
        callback?.(new Error("disk full"));
        return true;
      },
      once(): unknown {
        return this;
      },
      end(callback?: () => void): unknown {
        callback?.();
        return this;
      },
      writableEnded: false,
    };
    const transport = fileTransport({
      stream: fakeStream,
      onError: () => {
        throw new Error("callback blew up");
      },
    });
    expect(() => transport.write(META, "x")).not.toThrow();
    await expect(transport.flush()).resolves.toBeUndefined();
    await transport[Symbol.asyncDispose]();
  });

  test("default error report goes to console.error ONCE per burst and re-arms after a successful write", async () => {
    const reports: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      reports.push(args);
    });
    try {
      let fail = true;
      const fakeStream = {
        write(_chunk: string, callback?: (error?: Error | null) => void): boolean {
          callback?.(fail ? new Error("boom") : null);
          return true;
        },
        once(): unknown {
          return this;
        },
        end(callback?: () => void): unknown {
          callback?.();
          return this;
        },
        writableEnded: false,
      };
      // No onError -> default console.error path (file.ts 184-191).
      const transport = fileTransport({ stream: fakeStream, name: "audit" });
      transport.write(META, "one");
      transport.write(META, "two"); // second failure in the same burst is suppressed
      await transport.flush();
      expect(reports).toHaveLength(1);
      expect(String(reports[0][0])).toContain('file transport "audit" write failed');

      // A successful write re-arms the report, so the next failure reports again.
      fail = false;
      transport.write(META, "ok");
      await transport.flush();
      fail = true;
      transport.write(META, "boom again");
      await transport.flush();
      expect(reports).toHaveLength(2);
      await transport[Symbol.asyncDispose]();
    } finally {
      spy.mockRestore();
    }
  });

  test("even a throwing console.error never escapes the default report", async () => {
    // A hostile console whose error() throws must not turn a logging failure into a crash (file.ts 189-191).
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console is hostile");
    });
    try {
      const fakeStream = {
        write(_chunk: string, callback?: (error?: Error | null) => void): boolean {
          callback?.(new Error("boom"));
          return true;
        },
        once(): unknown {
          return this;
        },
        end(callback?: () => void): unknown {
          callback?.();
          return this;
        },
        writableEnded: false,
      };
      const transport = fileTransport({ stream: fakeStream });
      expect(() => transport.write(META, "x")).not.toThrow();
      await expect(transport.flush()).resolves.toBeUndefined();
      await transport[Symbol.asyncDispose]();
    } finally {
      spy.mockRestore();
    }
  });

  // --- Open failures: the stream 'error' listener and the failed-open catch -----------------------

  test("a failed open (path is an existing directory) is reported and does not crash", async () => {
    await withTempDir(async (dir) => {
      const seen: { error: unknown; context: string }[] = [];
      // Point the transport at the directory itself: createWriteStream on a dir emits EISDIR on 'error'.
      const transport = fileTransport({ path: dir, onError: (error, context) => seen.push({ error, context }) });
      transport.write(META, "line");
      await transport.flush();
      await waitFor(() => seen.length > 0);
      // The stream 'error' listener fired (streamReady was false → "open"), file.ts 211-217.
      expect(seen.some((s) => s.context === "open")).toBe(true);
      await transport[Symbol.asyncDispose]();
    });
  });

  test("a broken stream is abandoned so the next write retries a fresh open (directory appears later)", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "later", "app.log");
      // Pre-create a FILE where the parent dir needs to be, so mkdir(dirname) fails with ENOTDIR on
      // the first write → the async open rejects → the opening.catch runs (file.ts 224-228).
      const blocker = join(dir, "later");
      await import("node:fs/promises").then((fs) => fs.writeFile(blocker, "not a dir"));
      const seen: string[] = [];
      const transport = fileTransport({ path, onError: (_error, context) => seen.push(context) });
      transport.write(META, "first");
      await transport.flush();
      await waitFor(() => seen.includes("open"));
      expect(seen).toContain("open");

      // Remove the blocker so the parent directory can now be created; the next write must reopen.
      await rm(blocker);
      transport.write(META, "second");
      await transport.flush();
      await waitFor(() => existsSync(path));
      expect(await readFile(path, "utf8")).toBe("second\n");
      await transport[Symbol.asyncDispose]();
    });
  });

  test("a synchronous throw from stream.write is contained (writeChunk catch)", async () => {
    const seen: { context: string }[] = [];
    const fakeStream = {
      write(): boolean {
        throw new Error("write threw synchronously");
      },
      once(): unknown {
        return this;
      },
      end(callback?: () => void): unknown {
        callback?.();
        return this;
      },
      writableEnded: false,
    };
    const transport = fileTransport({ stream: fakeStream, onError: (_error, context) => seen.push({ context }) });
    expect(() => transport.write(META, "x")).not.toThrow();
    await expect(transport.flush()).resolves.toBeUndefined();
    // file.ts 247-250: the sync throw is caught and reported as a "write" failure.
    expect(seen).toEqual([{ context: "write" }]);
    await transport[Symbol.asyncDispose]();
  });

  // --- flushSync (exit-path machinery) ------------------------------------------------------------

  test("flushSync is a no-op for a caller-supplied stream", () => {
    const chunks: string[] = [];
    const fakeStream = {
      write(chunk: string, callback?: (error?: Error | null) => void): boolean {
        chunks.push(chunk);
        callback?.(null);
        return true;
      },
      once(): unknown {
        return this;
      },
      end(callback?: () => void): unknown {
        callback?.();
        return this;
      },
      writableEnded: false,
    };
    const transport = fileTransport({ stream: fakeStream });
    transport.write(META, "queued");
    // ownsStream is false → flushSync returns without touching any fd (file.ts 317).
    expect(() => transport.flushSync()).not.toThrow();
  });

  test("flushSync with nothing queued is a no-op", async () => {
    await withTempDir(async (dir) => {
      const transport = fileTransport({ path: join(dir, "sync-empty.log") });
      expect(() => transport.flushSync()).not.toThrow();
      expect(existsSync(join(dir, "sync-empty.log"))).toBe(false);
      await transport[Symbol.asyncDispose]();
    });
  });

  test("flushSync drains queued lines synchronously with its own fd before any stream opens", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "nested", "sync.log");
      const transport = fileTransport({ path });
      // Queue writes but DO NOT await flush() — the stream has not opened yet, so the entries are still
      // unconfirmed and unsubmitted. flushSync must mkdir + openSync + writeSync them all (file.ts 320-339).
      transport.write(META, "sync one");
      transport.write(META, "sync two");
      transport.flushSync();
      expect(readFileSync(path, "utf8")).toBe("sync one\nsync two\n");
      await transport[Symbol.asyncDispose]();
    });
  });

  test("flushSync honors append:false by truncating when no stream ever opened", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "sync-trunc.log");
      mkdirSync(dir, { recursive: true });
      await import("node:fs/promises").then((fs) => fs.writeFile(path, "OLD DATA\n"));
      const transport = fileTransport({ path, append: false });
      transport.write(META, "fresh");
      transport.flushSync(); // no stream opened → openSync with "w" truncates (file.ts 324).
      expect(readFileSync(path, "utf8")).toBe("fresh\n");
      await transport[Symbol.asyncDispose]();
    });
  });

  test("flushSync reports a write failure via handleError when openSync throws", async () => {
    await withTempDir(async (dir) => {
      const seen: string[] = [];
      // Path whose parent is a FILE: mkdirSync(dirname) throws ENOTDIR synchronously (file.ts 343-344).
      const blocker = join(dir, "blk");
      await import("node:fs/promises").then((fs) => fs.writeFile(blocker, "x"));
      const path = join(blocker, "deep", "app.log");
      const transport = fileTransport({ path, exitHooks: false, onError: (_error, context) => seen.push(context) });
      transport.write(META, "queued");
      transport.flushSync();
      expect(seen).toContain("write");
      await transport.flush().catch(() => undefined);
    });
  });

  // --- Dispose: end() throwing --------------------------------------------------------------------

  test("a stream whose end() throws is contained and reported as a 'close' failure", async () => {
    const seen: string[] = [];
    const fakeStream = {
      write(_chunk: string, callback?: (error?: Error | null) => void): boolean {
        callback?.(null);
        return true;
      },
      once(): unknown {
        return this;
      },
      end(): unknown {
        throw new Error("end blew up");
      },
      writableEnded: false,
    };
    const transport = fileTransport({ stream: fakeStream, onError: (_error, context) => seen.push(context) });
    transport.write(META, "x");
    // dispose must resolve even though end() throws (file.ts 370-373).
    await expect(transport[Symbol.asyncDispose]()).resolves.toBeUndefined();
    expect(seen).toContain("close");
  });
});
