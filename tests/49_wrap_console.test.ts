import { Logger } from "../src/index.js";
import { isConsoleWrapped, restoreConsole, wrapConsole } from "../src/subpaths/wrapConsole.js";

// M3.10 — `wrapConsole(logger)` / `restoreConsole()`: route global `console.*` through a tslog logger
// and revert cleanly. We capture routed entries via an attached transport (no real I/O), then assert the
// console method → log level mapping and that restore brings the genuine native methods back.

type Captured = { level: string; message: unknown };

function makeLogger(): { logger: Logger<unknown>; captured: Captured[] } {
  const captured: Captured[] = [];
  const logger = new Logger({ type: "hidden" });
  logger.attachTransport((logObj) => {
    const meta = (logObj as { _meta?: { logLevelName?: string } })._meta;
    const message = (logObj as Record<string, unknown>)["0"];
    captured.push({ level: meta?.logLevelName ?? "?", message });
  });
  return { logger, captured };
}

describe("wrapConsole / restoreConsole (M3.10)", () => {
  afterEach(() => {
    // Always undo any wrap so a failing assertion can't leak a patched console into later tests.
    restoreConsole();
  });

  test("routes console.* to the matching tslog level", () => {
    const { logger, captured } = makeLogger();
    wrapConsole(logger);

    console.log("log-line");
    console.info("info-line");
    console.debug("debug-line");
    console.warn("warn-line");
    console.error("error-line");

    expect(captured).toEqual([
      { level: "INFO", message: "log-line" },
      { level: "INFO", message: "info-line" },
      { level: "DEBUG", message: "debug-line" },
      { level: "WARN", message: "warn-line" },
      { level: "ERROR", message: "error-line" },
    ]);
  });

  test("forwards every argument to the logger", () => {
    const { logger, captured } = makeLogger();
    const calls: unknown[][] = [];
    // Spy on the level method to confirm all variadic args pass through untouched.
    const originalInfo = logger.info.bind(logger);
    logger.info = ((...args: unknown[]) => {
      calls.push(args);
      return originalInfo(...(args as [string]));
    }) as typeof logger.info;

    wrapConsole(logger);
    console.log("with", { extra: 1 }, 42);

    expect(calls).toEqual([["with", { extra: 1 }, 42]]);
    expect(captured[0]?.level).toBe("INFO");
  });

  test("restoreConsole reverts to the native methods", () => {
    const nativeLog = console.log;
    const nativeError = console.error;
    const { logger } = makeLogger();

    wrapConsole(logger);
    expect(console.log).not.toBe(nativeLog);
    expect(isConsoleWrapped()).toBe(true);

    restoreConsole();
    expect(console.log).toBe(nativeLog);
    expect(console.error).toBe(nativeError);
    expect(isConsoleWrapped()).toBe(false);
  });

  test("wrapConsole returns a restore function that reverts the wrap", () => {
    const nativeWarn = console.warn;
    const { logger } = makeLogger();

    const restore = wrapConsole(logger);
    expect(console.warn).not.toBe(nativeWarn);

    restore();
    expect(console.warn).toBe(nativeWarn);
    expect(isConsoleWrapped()).toBe(false);
  });

  test("re-wrapping re-targets the logger while still restoring the true originals", () => {
    const nativeLog = console.log;
    const first = makeLogger();
    const second = makeLogger();

    wrapConsole(first.logger);
    wrapConsole(second.logger); // re-wrap onto a different logger

    console.log("routed");
    // Only the second logger receives output after the re-wrap.
    expect(first.captured).toEqual([]);
    expect(second.captured).toEqual([{ level: "INFO", message: "routed" }]);

    restoreConsole();
    // The genuine native method is restored, not the first wrapper.
    expect(console.log).toBe(nativeLog);
  });

  test("restoreConsole is a no-op when the console was never wrapped", () => {
    const nativeLog = console.log;
    expect(isConsoleWrapped()).toBe(false);
    expect(() => restoreConsole()).not.toThrow();
    expect(console.log).toBe(nativeLog);
  });

  describe("re-entrancy: the logger's own console sink must not recurse", () => {
    test("json logger: console.log routes through the logger and out via the saved original exactly once", () => {
      const realLog = console.log;
      const lines: unknown[][] = [];
      // Install a spy BEFORE wrapping so wrapConsole captures it as the "native" method.
      console.log = (...args: unknown[]): void => {
        lines.push(args);
      };
      try {
        const logger = new Logger({ type: "json" });
        wrapConsole(logger);

        // Without the re-entrancy guard this recursed unboundedly:
        // console.log → logger.info → renderJson → console.log (the wrapper) → …
        expect(() => console.log("hello recursion")).not.toThrow();

        expect(lines).toHaveLength(1);
        expect(String(lines[0]?.[0])).toContain("hello recursion");
      } finally {
        restoreConsole();
        console.log = realLog;
      }
    });

    test("pretty logger: console.log does not recurse either", () => {
      const realLog = console.log;
      const lines: unknown[][] = [];
      console.log = (...args: unknown[]): void => {
        lines.push(args);
      };
      try {
        const logger = new Logger({ type: "pretty", stack: { capture: "off" } });
        wrapConsole(logger);

        expect(() => console.log("pretty recursion")).not.toThrow();

        expect(lines.length).toBeGreaterThan(0);
        expect(lines.map((args) => args.join(" ")).join("\n")).toContain("pretty recursion");
      } finally {
        restoreConsole();
        console.log = realLog;
      }
    });

    test("a DIRECT logger call while wrapped prints one un-nested record and delivers exactly one transport record", () => {
      const realLog = console.log;
      const lines: unknown[][] = [];
      console.log = (...args: unknown[]): void => {
        lines.push(args);
      };
      try {
        const logger = new Logger({ type: "json" });
        const received: unknown[] = [];
        logger.attachTransport((record) => {
          received.push(record);
        });
        wrapConsole(logger);

        logger.info("direct hello");

        // The logger's own sink bypasses the wrapper: the line is NOT re-ingested as a new log.
        expect(received).toHaveLength(1);
        expect((received[0] as Record<string, unknown>)?.["0"]).toBe("direct hello");
        expect(lines).toHaveLength(1);
        const printed = JSON.parse(String(lines[0]?.[0])) as Record<string, unknown>;
        // Un-nested: the printed record's message is the plain string, not a serialized record.
        expect(printed.message).toBe("direct hello");
      } finally {
        restoreConsole();
        console.log = realLog;
      }
    });

    test("an async rejecting transport while wrapped reports once and does not re-ingest or loop", async () => {
      const realLog = console.log;
      const realError = console.error;
      const errorReports: unknown[][] = [];
      let writeCalls = 0;
      console.log = (): void => {};
      console.error = (...args: unknown[]): void => {
        errorReports.push(args);
      };
      try {
        const logger = new Logger({ type: "json" });
        logger.attachTransport({
          name: "rejector",
          write(): Promise<void> {
            writeCalls++;
            return Promise.reject(new Error("sink down"));
          },
        });
        wrapConsole(logger);

        console.log("hello");
        // Let the rejection handler (a microtask) run — pre-fix this re-ingested console.error into
        // the logger, re-dispatched to the transport, and livelocked the event loop.
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(writeCalls).toBe(1);
        expect(errorReports).toHaveLength(1);
        expect(String(errorReports[0]?.[0])).toContain("rejector");
      } finally {
        restoreConsole();
        console.log = realLog;
        console.error = realError;
      }
    });
  });
});
