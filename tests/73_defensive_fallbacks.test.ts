import { afterEach, describe, expect, test, vi } from "vitest";
import { readPersistedLevel, writePersistedLevel } from "../src/core/levelPersistence.js";
import { normalizeSettings } from "../src/core/settings.js";
import type { EnvironmentProvider } from "../src/env/environment.js";
import { parseBrowserStackLine } from "../src/env/shared.js";
import { BaseLogger, Logger } from "../src/index.js";
import type { IMeta, ISettingsParam, Transport } from "../src/interfaces.js";

/**
 * These tests pin the never-crash contracts of defensive catches that were previously
 * coverage-ignored; each was verified reachable through an existing seam (a hostile
 * `localStorage`, a throwing console method, a throwing default sink, or a hostile inspect
 * target), so the guards are real behavior, not dead code. All global mutations
 * (`globalThis.localStorage`, `process.env`, console spies) are restored in finally blocks.
 *
 * Also pins `_shouldCaptureStack`'s json-under-"auto" branch, which a coverage audit
 * misclassified as dead: an EXPLICIT `stack.capture: "auto"` combined with `type: "json"`
 * (directly, or inherited through getSubLogger) reaches it through the public constructor.
 */

/** A minimal EnvironmentProvider stub implementing only the members a hidden/json log call touches. */
function minimalEnv(overrides: Partial<EnvironmentProvider> = {}): EnvironmentProvider {
  const base: Partial<EnvironmentProvider> = {
    isError: (value: unknown): value is Error => value instanceof Error,
    isBuffer: () => false,
    getErrorTrace: () => [],
    getMeta: (logLevelId: number, logLevelName: string) => ({ runtime: "unknown", date: new Date(), logLevelId, logLevelName }) as unknown as IMeta,
  };
  return { ...base, ...overrides } as unknown as EnvironmentProvider;
}

/* ------------------------------------------------------------------------------------------------ */
/* core/levelPersistence.ts — the three guarded localStorage catches                                 */
/* ------------------------------------------------------------------------------------------------ */

describe("level persistence never throws on hostile localStorage", () => {
  const savedDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  function restoreLocalStorage(): void {
    if (savedDescriptor != null) {
      Object.defineProperty(globalThis, "localStorage", savedDescriptor);
    } else {
      // biome-ignore lint/performance/noDelete: restore the absence of localStorage after the test
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  }

  afterEach(restoreLocalStorage);

  test("a localStorage GETTER that throws (sandboxed iframe) is swallowed by both entry points", () => {
    Object.defineProperty(globalThis, "localStorage", {
      get() {
        throw new Error("SecurityError: storage blocked in this sandbox");
      },
      configurable: true,
    });
    try {
      // getLocalStorage's catch: touching the property alone throws — read yields undefined, write no-ops.
      expect(readPersistedLevel()).toBeUndefined();
      expect(() => writePersistedLevel(4)).not.toThrow();
    } finally {
      restoreLocalStorage();
    }
  });

  test("a storage whose getItem throws yields undefined from the read path", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        // The shape passes getLocalStorage's `typeof storage.getItem === "function"` probe;
        // only the actual call throws — readPersistedLevel's own catch must contain it.
        getItem() {
          throw new Error("SecurityError: private mode");
        },
        setItem() {},
      },
      configurable: true,
      writable: true,
    });
    try {
      expect(readPersistedLevel()).toBeUndefined();
    } finally {
      restoreLocalStorage();
    }
  });

  test("a working getItem with a throwing setItem (Safari private mode / quota) keeps persist a no-op", () => {
    const store: Record<string, string> = { "tslog:level": "2" };
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => store[key] ?? null,
        setItem() {
          throw new Error("QuotaExceededError");
        },
      },
      configurable: true,
      writable: true,
    });
    try {
      // The storage passes every probe — the read path proves it is live...
      expect(readPersistedLevel()).toBe("2");
      // ...so the write reaches setItem and its throw is contained by writePersistedLevel's catch.
      expect(() => writePersistedLevel(5)).not.toThrow();
      expect(store["tslog:level"]).toBe("2");
    } finally {
      restoreLocalStorage();
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* core/settings.ts — emitConfigWarning when console.warn itself throws                              */
/* ------------------------------------------------------------------------------------------------ */

describe("config warnings never crash construction", () => {
  test("a console.warn that throws is swallowed while reporting an unknown setting", () => {
    const savedNodeEnv = process.env.NODE_ENV;
    const savedDisable = process.env.TSLOG_DISABLE_WARNINGS;
    // Make the dev-mode warning fire deterministically: not production, warnings not disabled.
    process.env.NODE_ENV = "development";
    delete process.env.TSLOG_DISABLE_WARNINGS;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      throw new Error("console.warn is broken");
    });
    try {
      let logger: Logger<Record<string, unknown>> | undefined;
      // Unknown top-level setting WITHOUT strictConfig → warn-only path → emitConfigWarning → throwing
      // console.warn → the catch keeps construction alive.
      expect(() => {
        logger = new Logger({ type: "hidden", definitelyNotASetting: true } as unknown as ISettingsParam<Record<string, unknown>>);
      }).not.toThrow();
      // The warning genuinely fired (and threw inside emitConfigWarning).
      expect(warnSpy).toHaveBeenCalled();
      // The logger stays fully usable afterwards.
      expect(logger?.log(3, "INFO", "still works")).toBeDefined();
    } finally {
      warnSpy.mockRestore();
      if (savedNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = savedNodeEnv;
      }
      if (savedDisable !== undefined) {
        process.env.TSLOG_DISABLE_WARNINGS = savedDisable;
      }
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* core/transports.ts — reportTransportError when console.error itself throws                        */
/* ------------------------------------------------------------------------------------------------ */

describe("transport failure reporting never throws", () => {
  test("a throwing transport reported through a throwing console.error is fully contained", () => {
    // nativeConsoleMethod resolves the LIVE console.error per call, so the throwing stub is seen.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console.error is broken");
    });
    try {
      const logger = new Logger<Record<string, unknown>>({ type: "hidden" });
      logger.attachTransport({
        name: "exploding",
        write() {
          throw new Error("sink failure");
        },
      } as Transport<Record<string, unknown>>);
      let record: unknown;
      expect(() => {
        record = logger.log(3, "INFO", "delivered");
      }).not.toThrow();
      // The log call still completed and produced a record.
      expect(record).toBeDefined();
      // The report path was really taken: console.error was invoked (and threw into the catch).
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('attached transport "exploding" threw an error'), expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* BaseLogger — the default json sink catch (writeJsonLine / console.log throwing)                   */
/* ------------------------------------------------------------------------------------------------ */

describe("the default json sink never crashes logging", () => {
  test("a runtime writeJsonLine that throws is swallowed and the logger stays usable", () => {
    const writes: string[] = [];
    let sinkBroken = true;
    const env = minimalEnv({
      writeJsonLine(line: string) {
        if (sinkBroken) {
          throw new Error("EPIPE: stdout closed");
        }
        writes.push(line);
      },
    });
    const logger = new BaseLogger<Record<string, unknown>>({ type: "json" }, undefined, env);
    expect(() => logger.log(3, "INFO", "first")).not.toThrow();
    // The record is still built and returned even though the sink blew up.
    expect(logger.log(3, "INFO", "still returned")).toBeDefined();
    // Once the sink recovers, subsequent logs flow through it — the logger was never poisoned.
    sinkBroken = false;
    const record = logger.log(3, "INFO", "second");
    expect(record).toBeDefined();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("second");
  });

  test("a provider without writeJsonLine falls back to console.log; a throwing console.log is swallowed", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("console.log is broken");
    });
    try {
      const logger = new BaseLogger<Record<string, unknown>>({ type: "json" }, undefined, minimalEnv());
      let record: unknown;
      expect(() => {
        record = logger.log(3, "INFO", "swallowed");
      }).not.toThrow();
      expect(record).toBeDefined();
      // The console fallback was genuinely reached (and threw into the catch).
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* BaseLogger._shouldCaptureStack — json under an EXPLICIT "auto" capture is a live public path      */
/* ------------------------------------------------------------------------------------------------ */

describe("explicit stack.capture 'auto' with type json captures the log position", () => {
  function recordingEnv(hideFlags: boolean[]): EnvironmentProvider {
    return minimalEnv({
      getMeta: (logLevelId: number, logLevelName: string, _callerFrame: number, hideLogPosition: boolean) => {
        hideFlags.push(hideLogPosition);
        return { runtime: "unknown", date: new Date(), logLevelId, logLevelName } as unknown as IMeta;
      },
      writeJsonLine: () => {},
    });
  }

  test("an explicit 'auto' keeps position capture on for json; the type-driven default resolves to off", () => {
    const hideFlags: boolean[] = [];
    const env = recordingEnv(hideFlags);
    // Explicit "auto" wins over the json→"off" default in resolveStackCapture, so _shouldCaptureStack
    // reaches its json short-circuit and captures.
    const autoLogger = new BaseLogger<Record<string, unknown>>({ type: "json", stack: { capture: "auto" } }, undefined, env);
    autoLogger.log(3, "INFO", "positioned");
    // Without an explicit capture, json defaults to "off" — no position capture.
    const defaultLogger = new BaseLogger<Record<string, unknown>>({ type: "json" }, undefined, env);
    defaultLogger.log(3, "INFO", "unpositioned");
    expect(hideFlags).toEqual([false, true]);
  });

  test("a sub-logger that inherits the parent's resolved 'auto' and switches to json keeps capturing", () => {
    const hideFlags: boolean[] = [];
    const env = recordingEnv(hideFlags);
    // A hidden parent resolves stack.capture to "auto"; the child inherits that RESOLVED value
    // explicitly, so switching the child to json does not re-derive the json→"off" default.
    const parent = new BaseLogger<Record<string, unknown>>({ type: "hidden" }, undefined, env);
    expect(parent.settings.stack.capture).toBe("auto");
    const child = parent.getSubLogger({ type: "json" });
    expect(child.settings.stack.capture).toBe("auto");
    child.log(3, "INFO", "positioned via inheritance");
    // parent (hidden, default template references {{filePathWithLine}}) also captures — only assert the child's call.
    expect(hideFlags[hideFlags.length - 1]).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* env/shared.ts — parseBrowserStackLine's null guard + stringifyFallback's String() catch           */
/* ------------------------------------------------------------------------------------------------ */

describe("env/shared parser and stringify fallbacks", () => {
  test("parseBrowserStackLine(undefined) returns undefined", () => {
    // The function is exported and its signature accepts string | undefined.
    expect(parseBrowserStackLine(undefined)).toBeUndefined();
  });

  test("stringifyFallback degrades to String() when both native inspect and JSON.stringify throw", async () => {
    // Fresh module instance so resolveInspect probes the NATIVE util.formatWithOptions under Node.
    vi.resetModules();
    const { createUniversalEnvironment } = await import("../src/env/environment.universal.js");
    const provider = createUniversalEnvironment();
    // One hostile object hits both layers: the custom-inspect hook makes native inspect throw
    // (formatWithOptionsSafe falls back to args.map(stringifyFallback)), and the BigInt property
    // makes JSON.stringify throw inside stringifyFallback → String(value).
    const hostile = {
      big: 1n,
      [Symbol.for("nodejs.util.inspect.custom")](): never {
        throw new Error("no inspect");
      },
    };
    const settings = normalizeSettings<Record<string, unknown>>({ type: "pretty" });
    const line = provider.prettyFormatLine([hostile], undefined, settings);
    expect(line).toContain("[object Object]");
  });
});
