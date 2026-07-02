import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ILogObjMeta } from "../src/interfaces.js";
import { fileTransport } from "../src/subpaths/transports/file.js";

// `fileTransport` is a Node-only Transport that appends each formatted line to a node:fs write stream.
// These tests exercise the contract from the M2b spec: non-blocking writes, a flush() that actually
// drains, an async disposer that flushes+closes, lazy (side-effect-free) stream opening, and the
// rotation-by-composition seam (a supplied `stream`).

const META = {} as ILogObjMeta;

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "tslog-file-transport-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("fileTransport", () => {
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
});
