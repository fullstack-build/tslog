import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import type { IMeta } from "../src/interfaces.js";

describe("Worker and edge runtime environments", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    // Don't save/restore navigator — it's a getter-only property in Node.
    // Use vi.stubGlobal("navigator", ...) and vi.unstubAllGlobals() instead.
    saved = {
      window: globalAny.window,
      document: globalAny.document,
      location: globalAny.location,
      Deno: globalAny.Deno,
      Bun: globalAny.Bun,
      importScripts: globalAny.importScripts,
    };
  });

  afterEach(() => {
    // Restore vi.stubGlobal changes (navigator) first
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete globalAny[key];
      } else {
        globalAny[key] = value;
      }
    }
  });

  describe("Edge runtime (simulated minimal environment)", () => {
    test("logger environment works with minimal process stub", () => {
      // Simulate edge-like: no window, document, Deno, Bun, importScripts
      // Keep process as minimal stub (can't fully remove in Node test runner)
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      // Still detects as "node" because process exists, which is correct —
      // edge runtimes that polyfill process will be detected as "node"
      expect(meta.runtime).toBeDefined();
      expect(meta.date).toBeInstanceOf(Date);
      expect(meta.logLevelId).toBe(3);
    });

    test("JSON transport works in minimal environment", () => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const env = createUniversalEnvironment();
      env.transportJSON({ msg: "hello", _logMeta: { logLevelId: 3, logLevelName: "INFO" } });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("hello");

      consoleSpy.mockRestore();
    });

    test("error trace parsing works without browser/Deno/Bun globals", () => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;

      const env = createUniversalEnvironment();
      const error = new Error("edge error");
      const frames = env.getErrorTrace(error);

      expect(Array.isArray(frames)).toBe(true);
      expect(frames.length).toBeGreaterThan(0);
    });

    test("isError and isBuffer work without extra globals", () => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;

      const env = createUniversalEnvironment();
      expect(env.isError(new Error("test"))).toBe(true);
      expect(env.isError(new TypeError("test"))).toBe(true);
      expect(env.isError({ name: "CustomError", message: "msg" })).toBe(true);
      expect(env.isError("not an error")).toBe(false);
      expect(env.isBuffer(null)).toBe(false);
    });
  });

  describe("Web Worker (simulated)", () => {
    test("runtime detected as 'worker' when importScripts is available", () => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.importScripts = function importScripts() {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Worker" });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      expect(meta.runtime).toBe("worker");
    });

    test("worker runtime includes user agent in meta", () => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.importScripts = function importScripts() {};
      vi.stubGlobal("navigator", { userAgent: "test-worker-agent" });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.runtime).toBe("worker");
      expect(meta.browser).toBe("test-worker-agent");
    });

    test("worker uses browser stack parsing", () => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.importScripts = function importScripts() {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" });

      const env = createUniversalEnvironment();
      const error = { stack: "Error\nfn@http://localhost/worker.js:10:5" } as Error;
      const frames = env.getErrorTrace(error);

      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0]?.filePath).toContain("/localhost/worker.js");
      expect(frames[0]?.fileLine).toBe("10");
    });

    test("worker environment produces valid meta with all fields", () => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.importScripts = function importScripts() {};
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as IMeta;

      expect(meta.date).toBeInstanceOf(Date);
      expect(meta.logLevelId).toBe(3);
      expect(meta.logLevelName).toBe("INFO");
      expect(meta.runtime).toBe("worker");
    });
  });

  describe("Deno (simulated)", () => {
    function setupDeno(denoGlobal: unknown) {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Bun;
      delete globalAny.importScripts;
      globalAny.Deno = denoGlobal;
    }

    test("runtime detected as 'deno' when Deno global is present", () => {
      setupDeno({ version: { deno: "2.1.0" } });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.runtime).toBe("deno");
      expect(meta.runtimeVersion).toBe("deno/2.1.0");
    });

    test("Deno hostname resolution via env.get", () => {
      setupDeno({
        version: { deno: "2.1.0" },
        env: { get: (key: string) => (key === "HOSTNAME" ? "deno-host" : undefined) },
      });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.hostname).toBe("deno-host");
    });

    test("Deno hostname resolution via hostname() function", () => {
      setupDeno({
        version: { deno: "2.1.0" },
        hostname: () => "deno-hostname-fn",
      });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.hostname).toBe("deno-hostname-fn");
    });

    test("Deno without version info still detects as deno", () => {
      setupDeno({});

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.runtime).toBe("deno");
    });
  });

  describe("Bun (simulated)", () => {
    function setupBun(bunGlobal: unknown) {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.importScripts;
      globalAny.Bun = bunGlobal;
    }

    test("runtime detected as 'bun' when Bun global is present", () => {
      setupBun({ version: "1.1.0" });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.runtime).toBe("bun");
      expect(meta.runtimeVersion).toBe("bun/1.1.0");
    });

    test("Bun hostname from env", () => {
      setupBun({ version: "1.1.0", env: { HOSTNAME: "bun-host" } });

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.hostname).toBe("bun-host");
    });

    test("Bun without version still detects as bun", () => {
      setupBun({});

      const env = createUniversalEnvironment();
      const meta = env.getMeta(3, "INFO", Number.NaN, false) as Record<string, unknown>;

      expect(meta.runtime).toBe("bun");
    });
  });
});
