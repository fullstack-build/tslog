import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "../src/index.node.js";
import { fileTransport } from "../src/subpaths/transports/file.js";
import { type FetchLike, httpTransport } from "../src/subpaths/transports/http.js";

const repoRoot = join(__dirname, "..");

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "tslog-lifecycle-"));
}

/** Run an inline ESM script in a fresh Node process (tsx loads the TS sources). */
function runScript(script: string, timeoutMs = 30_000): void {
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: repoRoot,
    timeout: timeoutMs,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

describe("logger.flush() covers in-flight async writes", () => {
  test("a plain async transport function is awaited by flush()", async () => {
    const delivered: unknown[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(async (record) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      delivered.push(record);
    });

    logger.info("slow sink");
    expect(delivered).toHaveLength(0);
    await logger.flush();
    expect(delivered).toHaveLength(1);
  });

  test("an async Transport.write without flush() is awaited too", async () => {
    const delivered: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport({
      name: "async-write",
      format: "json",
      async write(_record, line): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 30));
        delivered.push(line);
      },
    });

    logger.info("queued");
    await logger.flush();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain('"queued"');
  });

  test("a rejecting async write never surfaces as an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport({
        name: "rejector",
        write: () => Promise.reject(new Error("sink down")),
      });
      logger.info("boom");
      await logger.flush();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
      errorSpy.mockRestore();
    }
  });
});

describe("disposal ownership", () => {
  function makeSink(): {
    transport: { name: string; write: () => void; flush: () => Promise<void>; [Symbol.asyncDispose]: () => Promise<void> };
    state: { flushed: number; disposed: number };
  } {
    const state = { flushed: 0, disposed: 0 };
    return {
      state,
      transport: {
        name: "sink",
        write: () => undefined,
        flush: async () => {
          state.flushed++;
        },
        [Symbol.asyncDispose]: async () => {
          state.disposed++;
        },
      },
    };
  }

  test("disposing a sub-logger flushes but does NOT dispose the parent's transports", async () => {
    const { transport, state } = makeSink();
    const parent = new Logger({ type: "hidden", attachedTransports: [transport] });
    const child = parent.getSubLogger({ name: "req" });

    await child[Symbol.asyncDispose]();
    expect(state.flushed).toBeGreaterThan(0);
    expect(state.disposed).toBe(0);

    await parent[Symbol.asyncDispose]();
    expect(state.disposed).toBe(1);
  });

  test("a transport attached to the child itself IS disposed by the child", async () => {
    const parentSink = makeSink();
    const childSink = makeSink();
    const parent = new Logger({ type: "hidden", attachedTransports: [parentSink.transport] });
    const child = parent.getSubLogger({ name: "req" });
    child.attachTransport(childSink.transport);

    await child[Symbol.asyncDispose]();
    expect(childSink.state.disposed).toBe(1);
    expect(parentSink.state.disposed).toBe(0);
  });

  test("a grandchild inherits ownership rules transitively", async () => {
    const { transport, state } = makeSink();
    const root = new Logger({ type: "hidden", attachedTransports: [transport] });
    const grandchild = root.getSubLogger({ name: "a" }).getSubLogger({ name: "b" });

    await grandchild[Symbol.asyncDispose]();
    expect(state.disposed).toBe(0);
  });
});

describe("fileTransport failure containment", () => {
  test("an impossible path (ENOTDIR) reports via onError and never crashes or rejects", async () => {
    const dir = tmpDir();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "i am a file");
    const badPath = join(blocker, "sub", "app.log");

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const errors: { error: unknown; context: string }[] = [];
      const transport = fileTransport({ path: badPath, format: "json", exitHooks: false, onError: (error, context) => errors.push({ error, context }) });
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport(transport);

      logger.info("first");
      await logger.flush();
      logger.info("second");
      await logger.flush();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].context).toBe("open");
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a failed open is retried on the next write and recovers", async () => {
    const dir = tmpDir();
    const blocker = join(dir, "logs");
    writeFileSync(blocker, "blocking file"); // mkdir(dir/logs) will fail with ENOTDIR/EEXIST
    const target = join(blocker, "app.log");

    try {
      const errors: unknown[] = [];
      const transport = fileTransport({ path: target, format: "json", exitHooks: false, onError: (error) => errors.push(error) });
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport(transport);

      logger.info("lost line");
      await logger.flush();
      expect(errors.length).toBeGreaterThan(0);

      // Unblock the path: remove the file so the directory can be created, then log again.
      unlinkSync(blocker);
      logger.info("recovered line");
      await logger.flush();
      await transport[Symbol.asyncDispose]();

      const content = readFileSync(target, "utf8");
      expect(content).toContain("recovered line");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flushSync writes the unconfirmed tail synchronously", () => {
    const dir = tmpDir();
    const target = join(dir, "app.log");
    try {
      const transport = fileTransport({ path: target, format: "json", exitHooks: false });
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport(transport);

      logger.info("tail-1");
      logger.info("tail-2");
      transport.flushSync();

      expect(existsSync(target)).toBe(true);
      const content = readFileSync(target, "utf8");
      expect(content).toContain("tail-1");
      expect(content).toContain("tail-2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The subprocess repros spawn `node --import tsx`; under Bun/Deno process.execPath is not Node, so
// these exit-semantics tests run on the Node suite only (the behavior under test is Node-specific).
const isNode = process.versions.node != null && (process.versions as Record<string, string | undefined>).bun == null;

describe.runIf(isNode)("process exit integration", () => {
  test("process.exit() does not lose the buffered file-transport tail (exit hook drains)", () => {
    const dir = tmpDir();
    const target = join(dir, "exit.log");
    try {
      runScript(`
        import { Logger } from "${repoRoot}/src/index.node.js";
        import { fileTransport } from "${repoRoot}/src/subpaths/transports/file.js";
        const logger = new Logger({ type: "hidden" });
        logger.attachTransport(fileTransport({ path: ${JSON.stringify(target)}, format: "json" }));
        for (let i = 0; i < 100; i++) logger.info("line-" + i);
        process.exit(0);
      `);
      const lines = readFileSync(target, "utf8").trim().split("\n");
      expect(lines).toHaveLength(100);
      expect(lines[99]).toContain("line-99");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an app that LOGS in its own beforeExit handler still exits (exit-flush cascade is latched)", () => {
    const dir = tmpDir();
    const target = join(dir, "loop.log");
    try {
      // Pre-fix this looped forever (196k beforeExit ticks in 10s, 160MB written).
      runScript(
        `
        import { Logger } from "${repoRoot}/src/index.node.js";
        import { workerTransport } from "${repoRoot}/src/subpaths/transports/worker.js";
        const logger = new Logger({ type: "hidden" });
        logger.attachTransport(workerTransport({ destination: "file", path: ${JSON.stringify(target)}, format: "json" }));
        logger.info("startup");
        process.on("beforeExit", () => logger.info("shutting down"));
      `,
        20_000,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("http retries and onError still run when the flush is the process's last work (ref'd backoff)", () => {
    const dir = tmpDir();
    const marker = join(dir, "attempts.txt");
    try {
      runScript(`
        import { appendFileSync } from "node:fs";
        import { Logger } from "${repoRoot}/src/index.node.js";
        import { httpTransport } from "${repoRoot}/src/subpaths/transports/http.js";
        const logger = new Logger({ type: "hidden" });
        logger.attachTransport(httpTransport({
          url: "https://logs.invalid/ingest",
          batchSize: 1,
          retries: 2,
          retryBaseMs: 20,
          format: "json",
          fetchImpl: async () => {
            appendFileSync(${JSON.stringify(marker)}, "attempt\\n");
            throw new Error("collector down");
          },
          onError: () => appendFileSync(${JSON.stringify(marker)}, "onError\\n"),
        }));
        logger.info("doomed");
        await logger.flush();
      `);
      const lines = readFileSync(marker, "utf8").trim().split("\n");
      expect(lines.filter((line) => line === "attempt")).toHaveLength(3);
      expect(lines.filter((line) => line === "onError")).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("sync dispose followed by process.exit still persists the file tail (hook survives until drained)", () => {
    const dir = tmpDir();
    const target = join(dir, "using-exit.log");
    try {
      // Subprocess runs plain Node (no TS transpile), so use Symbol.dispose — the Node 20–compatible
      // equivalent of a synchronous `using` scope exit.
      runScript(`
        import { Logger } from "${repoRoot}/src/index.node.js";
        import { fileTransport } from "${repoRoot}/src/subpaths/transports/file.js";
        const logger = new Logger({ type: "hidden" });
        logger.attachTransport(fileTransport({ path: ${JSON.stringify(target)}, format: "json" }));
        for (let i = 0; i < 50; i++) logger.info("line-" + i);
        logger[Symbol.dispose]();
        process.exit(0);
      `);
      const lines = readFileSync(target, "utf8").trim().split("\n");
      expect(lines).toHaveLength(50);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a process that attached the worker transport exits on its own (worker is unref'd) and delivers", () => {
    const dir = tmpDir();
    const target = join(dir, "worker.log");
    try {
      runScript(`
        import { Logger } from "${repoRoot}/src/index.node.js";
        import { workerTransport } from "${repoRoot}/src/subpaths/transports/worker.js";
        const logger = new Logger({ type: "hidden" });
        logger.attachTransport(workerTransport({ destination: "file", path: ${JSON.stringify(target)}, format: "json" }));
        logger.info("w-1");
        logger.info("w-2");
        await logger.flush();
        // No dispose on purpose: pre-fix, the ref'd worker kept this process alive forever.
      `);
      const content = readFileSync(target, "utf8");
      expect(content).toContain("w-1");
      expect(content).toContain("w-2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cross-logger flush on shared transports", () => {
  test("parent.flush() awaits an async write dispatched by a child logger", async () => {
    const delivered: unknown[] = [];
    const parent = new Logger({ type: "hidden" });
    parent.attachTransport(async (record) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      delivered.push(record);
    });
    const child = parent.getSubLogger({ name: "req" });

    child.info("from child");
    expect(delivered).toHaveLength(0);
    await parent.flush();
    expect(delivered).toHaveLength(1);
  });
});

describe("fileTransport stream-error recovery", () => {
  test("a stream error abandons the cached open so the next write reopens", async () => {
    const dir = tmpDir();
    const target = join(dir, "recover.log");
    try {
      writeFileSync(target, "");
      chmodSync(target, 0o000); // open will fail with EACCES

      const errors: string[] = [];
      const transport = fileTransport({ path: target, format: "json", exitHooks: false, onError: (_e, context) => errors.push(context) });
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport(transport);

      logger.info("blocked");
      await logger.flush();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(errors.length).toBeGreaterThan(0);

      chmodSync(target, 0o644);
      logger.info("after recovery");
      await logger.flush();
      await transport[Symbol.asyncDispose]();

      expect(readFileSync(target, "utf8")).toContain("after recovery");
    } finally {
      try {
        chmodSync(target, 0o644);
      } catch {
        // already unlocked
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("httpTransport exit flushing", () => {
  test("a beforeExit tick flushes the buffered batch", async () => {
    const sent: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      sent.push(init.body);
      return { ok: true, status: 200 };
    };
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 100, format: "json", fetchImpl });
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(transport);

    logger.info("buffered");
    expect(sent).toHaveLength(0);

    // Simulate the runtime's natural end-of-loop signal.
    process.emit("beforeExit", 0);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('"buffered"');
    await logger[Symbol.asyncDispose]();
  });
});

describe("transport format-step isolation (review fix)", () => {
  test("a throwing custom formatter never escapes the log call, and other transports still deliver", () => {
    const delivered: string[] = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const logger = new Logger({ type: "hidden" });
      logger.attachTransport({
        name: "hostile-format",
        format: () => {
          throw new Error("hostile formatter");
        },
        write: () => undefined,
      });
      logger.attachTransport({ name: "healthy", format: "json", write: (_record, line) => void delivered.push(line) });
      expect(() => logger.info("isolated")).not.toThrow();
      expect(delivered).toHaveLength(1);
      expect(JSON.parse(delivered[0])).toMatchObject({ message: "isolated" });
      // the failure was reported, not swallowed silently
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test("format-less transports on a hidden logger receive the JSON line (documented default)", () => {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport({ name: "default-format", write: (_record, line) => void lines.push(line) });
    logger.info("hidden default", { n: 1 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.message).toBe("hidden default");
    expect(parsed.n).toBe(1);
  });
});
