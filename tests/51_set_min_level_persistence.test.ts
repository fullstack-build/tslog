import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Logger } from "../src/index.js";

// M4.6 — runtime setMinLevel + opt-in browser localStorage level persistence.
//
// setMinLevel works on every runtime (it just resolves a number/name to a numeric id and assigns
// this.settings.minLevel). The localStorage read/persist is browser-only and opt-in via `persistLevel`,
// with ALL localStorage access try/catch-guarded so it never throws — even when localStorage is absent
// (Node, the default here) or throws on access (Safari private mode). These tests stub globalThis to
// exercise the guarded paths without a real browser.

interface LevelLog {
  _meta: { logLevelId: number };
}

describe("setMinLevel (M4.6)", () => {
  test("changes level filtering at runtime (numeric)", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0 });
    expect(logger.log(2, "DEBUG", "x")).toBeDefined();

    logger.setMinLevel(4); // WARN
    expect(logger.settings.minLevel).toBe(4);
    expect(logger.log(2, "DEBUG", "x")).toBeUndefined();
    expect(logger.log(5, "ERROR", "x")).toBeDefined();
  });

  test("resolves a level name", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0 });
    logger.setMinLevel("WARN");
    expect(logger.settings.minLevel).toBe(4);
    expect(logger.isLevelEnabled("INFO")).toBe(false);
    expect(logger.isLevelEnabled("ERROR")).toBe(true);
  });

  test("resolves a custom level name", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0, customLevels: { NOTICE: 3.5 } });
    logger.setMinLevel("NOTICE");
    expect(logger.settings.minLevel).toBe(3.5);
  });

  test("ignores an unknown level name (level left unchanged) and is chainable", () => {
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 3 });
    const returned = logger.setMinLevel("NOPE" as unknown as "WARN");
    expect(logger.settings.minLevel).toBe(3);
    expect(returned).toBe(logger);
  });

  test("works without persistence configured and never touches localStorage", () => {
    const setItem = vi.fn();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem };
    try {
      const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0 });
      logger.setMinLevel(5);
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = undefined;
    }
  });
});

describe("browser log-level persistence (M4.6, stubbed localStorage)", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    if (original != null) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      // biome-ignore lint/performance/noDelete: restore the absence of localStorage between tests
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  test("reads the initial minLevel from localStorage when persistLevel is on (numeric token)", () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => (k === "tslog:level" ? "4" : null), setItem: () => {} };
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0, persistLevel: true });
    expect(logger.settings.minLevel).toBe(4);
  });

  test("reads a level-name token from localStorage", () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => "WARN", setItem: () => {} };
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0, persistLevel: true });
    expect(logger.settings.minLevel).toBe(4);
  });

  test("honors a custom persistLevelKey", () => {
    const store: Record<string, string> = { "myapp:lvl": "5" };
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0, persistLevel: true, persistLevelKey: "myapp:lvl" });
    expect(logger.settings.minLevel).toBe(5);
  });

  test("setMinLevel persists the new level to localStorage when persistLevel is on", () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 0, persistLevel: true });
    logger.setMinLevel("ERROR");
    expect(store["tslog:level"]).toBe("5");
  });

  test("does not read localStorage when persistLevel is off", () => {
    const getItem = vi.fn(() => "0");
    (globalThis as { localStorage?: unknown }).localStorage = { getItem, setItem: () => {} };
    const logger = new Logger<LevelLog>({ type: "hidden", minLevel: 3 });
    expect(logger.settings.minLevel).toBe(3);
    expect(getItem).not.toHaveBeenCalled();
  });

  test("does not throw when localStorage.getItem throws (private mode)", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("SecurityError: private mode");
      },
      setItem: () => {
        throw new Error("SecurityError: private mode");
      },
    };
    let logger!: Logger<LevelLog>;
    expect(() => {
      logger = new Logger<LevelLog>({ type: "hidden", minLevel: 2, persistLevel: true });
    }).not.toThrow();
    // falls back to the normalized minLevel since the read failed
    expect(logger.settings.minLevel).toBe(2);
    // persisting also swallows the throw
    expect(() => logger.setMinLevel(5)).not.toThrow();
    expect(logger.settings.minLevel).toBe(5);
  });

  test("does not throw when localStorage is entirely absent (off-browser default)", () => {
    // biome-ignore lint/performance/noDelete: simulate a runtime with no localStorage at all
    delete (globalThis as { localStorage?: unknown }).localStorage;
    let logger!: Logger<LevelLog>;
    expect(() => {
      logger = new Logger<LevelLog>({ type: "hidden", minLevel: 1, persistLevel: true });
    }).not.toThrow();
    expect(logger.settings.minLevel).toBe(1);
    expect(() => logger.setMinLevel(6)).not.toThrow();
  });
});
