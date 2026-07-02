import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { Logger } from "../src/index.js";
import type { IMeta } from "../src/interfaces.js";

// Unified code-position detection: auto-detection (NaN callerFrame) resolves the caller
// frame the same way across every runtime, replacing the previous hardcoded Safari 4 / other 5.
// BC11: the v4 createLoggerEnvironment() singleton is gone; the universal provider re-detects the
// runtime at construction and adapts (server vs browser stack parsing), so it stands in directly.

describe("Unified caller detection across runtimes", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = {
      window: globalAny.window,
      document: globalAny.document,
      Deno: globalAny.Deno,
      Bun: globalAny.Bun,
      importScripts: globalAny.importScripts,
      location: globalAny.location,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalAny[k];
      else globalAny[k] = v;
    }
  });

  function envFor(runtime: "node" | "bun" | "deno" | "worker") {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    if (runtime === "bun") globalAny.Bun = { version: "1.3.12" };
    if (runtime === "deno") globalAny.Deno = { version: { deno: "2.0.0" } };
    if (runtime === "worker") {
      globalAny.importScripts = () => undefined;
      globalAny.location = { origin: "https://app.example.com" };
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" });
    }
    return createUniversalEnvironment();
  }

  // Server-style stacks (Node / Bun / Deno): "at fn (path:line:col)" or anonymous "at path:line:col".
  const SERVER_NAMED = [
    "Error",
    "    at getCallerStackFrame (/app/node_modules/tslog/dist/esm/BaseLogger.js:51:45)",
    "    at log (/app/node_modules/tslog/dist/esm/BaseLogger.js:830:25)",
    "    at info (/app/node_modules/tslog/dist/esm/index.js:63:26)",
    "    at myAppFunction (/app/src/myapp.js:42:11)",
  ].join("\n");

  // Bun's real shape: anonymous user frame + synthetic native frames + collapsed intermediates.
  const BUN_ANON = [
    "Error",
    "    at getCallerStackFrame (/app/node_modules/tslog/dist/esm/BaseLogger.js:51:45)",
    "    at log (/app/node_modules/tslog/dist/esm/BaseLogger.js:830:25)",
    "    at info (/app/node_modules/tslog/dist/esm/index.js:63:26)",
    "    at /app/src/myapp.js:42:11",
    "    at moduleEvaluation (native:1:11)",
  ].join("\n");

  const DENO_FILE_URL = [
    "Error",
    "    at getCallerStackFrame (file:///app/node_modules/tslog/dist/esm/BaseLogger.js:51:45)",
    "    at log (file:///app/node_modules/tslog/dist/esm/BaseLogger.js:830:25)",
    "    at info (file:///app/node_modules/tslog/dist/esm/index.js:63:26)",
    "    at myAppFunction (file:///app/src/myapp.js:42:11)",
  ].join("\n");

  // Worker uses the browser parser: "fn@url:line:col".
  const WORKER = [
    "getCallerStackFrame@https://app.example.com/node_modules/tslog/dist/esm/BaseLogger.js:51:45",
    "log@https://app.example.com/node_modules/tslog/dist/esm/BaseLogger.js:830:25",
    "info@https://app.example.com/node_modules/tslog/dist/esm/index.js:63:26",
    "myAppFunction@https://app.example.com/src/myapp.js:42:11",
  ].join("\n");

  function resolve(runtime: "node" | "bun" | "deno" | "worker", stack: string) {
    return envFor(runtime).getCallerStackFrame(Number.NaN, { stack } as Error);
  }

  test("Node resolves the application caller, not tslog internals", () => {
    const f = resolve("node", SERVER_NAMED);
    expect(f.filePath).toContain("myapp.js");
    expect(f.fileLine).toBe("42");
  });

  test("Bun resolves the caller even with anonymous + native frames", () => {
    const f = resolve("bun", BUN_ANON);
    expect(f.filePath).toContain("myapp.js");
    expect(f.fileLine).toBe("42");
  });

  test("Deno resolves the caller from file:// URLs", () => {
    const f = resolve("deno", DENO_FILE_URL);
    expect(f.filePath).toContain("myapp.js");
    expect(f.fileLine).toBe("42");
  });

  test("Worker resolves the caller from the @-style browser format", () => {
    const f = resolve("worker", WORKER);
    expect(f.filePath).toContain("myapp.js");
    expect(f.fileLine).toBe("42");
  });

  test("auto-detect and the legacy hardcoded index agree on a Safari-style stack", () => {
    globalAny.window = {};
    globalAny.document = {};
    globalAny.location = { origin: "https://app.example.com" };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Version/17 Safari/605" });
    const env = createUniversalEnvironment();
    const stack = [
      "getCallerStackFrame@https://app.example.com/node_modules/tslog/dist/esm/BaseLogger.js:51:45",
      "log@https://app.example.com/node_modules/tslog/dist/esm/BaseLogger.js:830:25",
      "info@https://app.example.com/node_modules/tslog/dist/esm/index.js:63:26",
      "myAppFunction@https://app.example.com/src/myapp.js:42:11",
    ].join("\n");
    const auto = env.getCallerStackFrame(Number.NaN, { stack } as Error);
    expect(auto.filePath).toContain("myapp.js");
    expect(auto.fileLine).toBe("42");
  });
});

describe("internalFramePatterns lets wrappers report their caller (#282)", () => {
  test("a wrapper frame is skipped so the position points at the wrapper's caller", () => {
    const env = createUniversalEnvironment();
    // A custom "company logger" wraps tslog; without internalFramePatterns auto-detect would stop
    // at the wrapper file. Registering it as internal moves detection to the real caller.
    const stack = [
      "Error",
      "    at getCallerStackFrame (/app/node_modules/tslog/dist/esm/BaseLogger.js:51:45)",
      "    at log (/app/node_modules/tslog/dist/esm/BaseLogger.js:830:25)",
      "    at action (/app/src/lib/company-logger.js:10:5)",
      "    at handleRequest (/app/src/routes/users.js:88:3)",
    ].join("\n");

    const withoutPatterns = env.getCallerStackFrame(Number.NaN, { stack } as Error);
    expect(withoutPatterns.filePath).toContain("company-logger.js");

    const withPatterns = env.getCallerStackFrame(Number.NaN, { stack } as Error, [/company-logger/]);
    expect(withPatterns.filePath).toContain("users.js");
    expect(withPatterns.fileLine).toBe("88");
  });

  test("internalFramePatterns flows from logger settings through to the meta path", () => {
    const logger = new Logger({ type: "hidden", internalFramePatterns: [/never-matches-anything/] });
    // Logger still produces a valid position for its real caller (this test file).
    const out = logger.info("x");
    const meta = out?._meta as IMeta | undefined;
    expect(meta?.path?.fileName).toContain("42_stack_position_unified.test.ts");
  });
});
