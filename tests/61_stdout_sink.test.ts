import { execFileSync } from "node:child_process";
import { getStdoutJsonSink } from "../src/env/stdoutSink.node.js";
import { Logger as UniversalLogger } from "../src/index.js";
import { Logger as NodeLogger } from "../src/index.node.js";
import { captureDefaultJsonLines } from "./support/stdoutCapture.js";

// The buffered stdout sink (review 13): the Node entry's default type:"json" output batches a whole
// event-loop turn's lines into ONE process.stdout.write instead of paying console.log per line. These
// tests pin the batching, the flush/drain guarantees, and the fallbacks.

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

interface WriteSpy {
  chunks: string[];
  /** Stored callbacks, so a test can decide WHEN stdout "accepts" a chunk. */
  callbacks: (() => void)[];
  restore(): void;
}

/** Spy on process.stdout.write; `autoAck` invokes the write callback immediately (the usual stream behavior). */
function spyStdout(autoAck = true): WriteSpy {
  const chunks: string[] = [];
  const callbacks: (() => void)[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    for (const arg of rest) {
      if (typeof arg === "function") {
        if (autoAck) {
          (arg as () => void)();
        } else {
          callbacks.push(arg as () => void);
        }
      }
    }
    return true;
  }) as never);
  return { chunks, callbacks, restore: () => spy.mockRestore() };
}

function jsonLogger(): NodeLogger<Record<string, unknown>> {
  return new NodeLogger({ type: "json", stack: { capture: "off" } });
}

describe("batching", () => {
  test("a synchronous burst is buffered and lands as ONE stdout write on the next microtask", async () => {
    const spy = spyStdout();
    try {
      const logger = jsonLogger();
      logger.info("one");
      logger.info("two");
      logger.info("three");
      // Still buffered: nothing hit stdout during the synchronous burst.
      expect(spy.chunks).toHaveLength(0);
      await Promise.resolve();
      expect(spy.chunks).toHaveLength(1);
      const lines = spy.chunks[0].split("\n").filter((line) => line.length > 0);
      expect(lines).toHaveLength(3);
      expect((JSON.parse(lines[0]) as Record<string, unknown>).message).toBe("one");
      expect((JSON.parse(lines[2]) as Record<string, unknown>).message).toBe("three");
      // NDJSON: the chunk is newline-terminated.
      expect(spy.chunks[0].endsWith("\n")).toBe(true);
    } finally {
      spy.restore();
    }
  });

  test("a large burst flushes inline once the size threshold is hit (no unbounded buffering mid-turn)", () => {
    const spy = spyStdout();
    try {
      const logger = jsonLogger();
      const big = "x".repeat(4000);
      logger.info("first", { payload: big });
      logger.info("second", { payload: big });
      logger.info("third", { payload: big });
      // The threshold (8KB) forced at least one write during the synchronous burst.
      expect(spy.chunks.length).toBeGreaterThan(0);
    } finally {
      // Drain the tail INTO the spy before restoring, so nothing leaks to the real stdout.
      getStdoutJsonSink().flushSync();
      spy.restore();
    }
  });

  test("the sink keeps working after a flush (re-buffering round trip)", () => {
    const lines1 = captureDefaultJsonLines(() => jsonLogger().info("round-1"));
    const lines2 = captureDefaultJsonLines(() => jsonLogger().info("round-2"));
    expect((JSON.parse(lines1[0]) as Record<string, unknown>).message).toBe("round-1");
    expect((JSON.parse(lines2[0]) as Record<string, unknown>).message).toBe("round-2");
  });
});

describe("flush integration", () => {
  test("logger.flush() drains the buffer and resolves only after stdout accepts the chunk", async () => {
    const spy = spyStdout(false); // hold the acks
    try {
      const logger = jsonLogger();
      logger.info("pending");
      let resolved = false;
      const flushing = logger.flush().then(() => {
        resolved = true;
      });
      // The buffer was handed to stdout synchronously by flush()...
      expect(spy.chunks).toHaveLength(1);
      await Promise.resolve();
      await Promise.resolve();
      // ...but the promise waits for the stream's acceptance callback.
      expect(resolved).toBe(false);
      for (const ack of spy.callbacks.splice(0)) {
        ack();
      }
      await flushing;
      expect(resolved).toBe(true);
    } finally {
      spy.restore();
    }
  });

  test("Symbol.asyncDispose drains the default sink too", async () => {
    const spy = spyStdout();
    try {
      const logger = jsonLogger();
      logger.info("disposed");
      await logger[Symbol.asyncDispose]();
      expect(spy.chunks.join("")).toContain('"disposed"');
    } finally {
      spy.restore();
    }
  });
});

describe("fallbacks and scope", () => {
  test("falls back to console.log when stdout.write throws (closed stream)", () => {
    const consoleLines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      consoleLines.push(String(line));
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => {
      throw new Error("stream destroyed");
    }) as never);
    try {
      const logger = jsonLogger();
      expect(() => {
        logger.info("degraded");
        getStdoutJsonSink().flushSync();
      }).not.toThrow();
      expect(consoleLines.join("\n")).toContain('"degraded"');
    } finally {
      stdoutSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  test("the universal entry keeps console.log (no stdout sink off the Node entry)", () => {
    const consoleLines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      consoleLines.push(String(line));
    });
    const stdoutSpy = spyStdout();
    try {
      const logger = new UniversalLogger<Record<string, unknown>>({ type: "json", stack: { capture: "off" } });
      logger.info("via console");
      expect(consoleLines).toHaveLength(1);
      expect(stdoutSpy.chunks).toHaveLength(0);
    } finally {
      stdoutSpy.restore();
      consoleSpy.mockRestore();
    }
  });

  test("pretty and hidden types never touch the stdout sink", () => {
    const stdoutSpy = spyStdout();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      new NodeLogger({ type: "hidden" }).info("quiet");
      new NodeLogger({ type: "pretty", stack: { capture: "off" } }).info("styled");
      expect(stdoutSpy.chunks).toHaveLength(0);
    } finally {
      consoleInfoSpy.mockRestore();
      consoleSpy.mockRestore();
      stdoutSpy.restore();
    }
  });
});

// The subprocess repros spawn `node --import tsx`; under Bun/Deno process.execPath is not Node, so
// the exit-semantics tests run on the Node suite only (the behavior under test is Node-specific).
const isNode = process.versions.node != null && (process.versions as Record<string, string | undefined>).bun == null;

describe.runIf(isNode)("process exit integration", () => {
  function runAndCaptureStdout(script: string): string {
    return execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: repoRoot,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  }

  test("process.exit() mid-turn does not lose buffered lines (sync exit drain)", () => {
    const stdout = runAndCaptureStdout(`
      import { Logger } from "${repoRoot}/src/index.node.js";
      const logger = new Logger({ type: "json", stack: { capture: "off" } });
      logger.info("tail-1");
      logger.info("tail-2");
      process.exit(0); // pending microtasks are discarded — only the exit hook can drain
    `);
    expect(stdout).toContain('"tail-1"');
    expect(stdout).toContain('"tail-2"');
  });

  test("a normally exiting process delivers everything", () => {
    const stdout = runAndCaptureStdout(`
      import { Logger } from "${repoRoot}/src/index.node.js";
      const logger = new Logger({ type: "json", stack: { capture: "off" } });
      logger.info("normal-exit");
    `);
    expect(stdout).toContain('"normal-exit"');
  });
});

describe("review fixes: accounting and hostile streams", () => {
  test("a naive user stub (no callback invocation) cannot park logger.flush() forever", async () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
    try {
      const logger = jsonLogger();
      logger.info("naively stubbed");
      // write() returned true → accepted → flush resolves without the ack callback
      await expect(Promise.race([logger.flush().then(() => "flushed"), new Promise((resolve) => setTimeout(() => resolve("timeout"), 1_000))])).resolves.toBe(
        "flushed",
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("a sync-callback-then-throw write does not desync the pending accounting", async () => {
    // First write: invokes the callback synchronously, then throws (legal stream behavior + a fault).
    const faulty = vi.spyOn(process.stdout, "write").mockImplementation(((_chunk: unknown, cb?: () => void) => {
      cb?.();
      throw new Error("post-ack fault");
    }) as never);
    const logger = jsonLogger();
    try {
      logger.info("faulty");
      getStdoutJsonSink().flushSync();
    } finally {
      faulty.mockRestore();
    }

    // Second round on a healthy-but-backpressured stream: flush must WAIT for the ack (a negative
    // pending counter from the fault above would make it resolve early).
    const held: (() => void)[] = [];
    const holding = vi.spyOn(process.stdout, "write").mockImplementation(((_chunk: unknown, cb?: () => void) => {
      if (cb != null) {
        held.push(cb);
      }
      return false; // backpressure: acceptance arrives only via the callback
    }) as never);
    try {
      const logger2 = jsonLogger();
      logger2.info("held");
      let resolved = false;
      const flushing = logger2.flush().then(() => {
        resolved = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(false);
      for (const ack of held.splice(0)) {
        ack();
      }
      await flushing;
      expect(resolved).toBe(true);
    } finally {
      holding.mockRestore();
    }
  });

  test("a REPLACED process.stdout gets its own error guard (no once-only latch)", () => {
    const listenersA: string[] = [];
    const listenersB: string[] = [];
    const makeFakeStdout = (events: string[]): NodeJS.WriteStream =>
      ({
        write: (_chunk: unknown, cb?: () => void) => {
          cb?.();
          return true;
        },
        on: (event: string) => {
          events.push(event);
        },
      }) as unknown as NodeJS.WriteStream;

    const stdoutGetter = vi.spyOn(process, "stdout", "get");
    try {
      stdoutGetter.mockReturnValue(makeFakeStdout(listenersA));
      const logger = jsonLogger();
      logger.info("stream A");
      getStdoutJsonSink().flushSync();
      expect(listenersA).toContain("error");

      stdoutGetter.mockReturnValue(makeFakeStdout(listenersB));
      logger.info("stream B");
      getStdoutJsonSink().flushSync();
      expect(listenersB).toContain("error");
    } finally {
      stdoutGetter.mockRestore();
    }
  });
});
