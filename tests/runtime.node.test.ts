import { createBrowserEnvironment } from "../src/env/environment.browser.js";
import type { EnvironmentProvider } from "../src/env/environment.js";
import { createNodeEnvironment } from "../src/env/environment.node.js";
import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { Logger } from "../src/index.js";
import type { IMeta, ISettings } from "../src/interfaces.js";
import { registerUniversalRuntimeTests } from "./shared/runtimeHarness.js";

// v5 (BC11): the module-level `loggerEnvironment` singleton and `createLoggerEnvironment()` are gone.
// The environment is now an injected per-runtime provider. The cwd cache lives inside each provider
// instance (closure-local, no `__resetWorkingDirectoryCacheForTests` hook), so "resetting" the cwd
// means constructing a FRESH provider. `wrapEnvironment` therefore takes a factory and rebuilds the
// underlying provider on `resetWorkingDirectory()`.
function wrapEnvironment(factory: () => EnvironmentProvider = createNodeEnvironment) {
  let env = factory();
  const wrapped = {
    getMeta: (logLevelId: number, logLevelName: string, callerFrame: number, hideLogPositionForPerformance: boolean, name?: string, parentNames?: string[]) =>
      Promise.resolve(env.getMeta(logLevelId, logLevelName, callerFrame, hideLogPositionForPerformance, name, parentNames)),
    getCallerStackFrame: (callerFrame: number, error: Error) => Promise.resolve(env.getCallerStackFrame(callerFrame, error)),
    getErrorTrace: (error: Error) => Promise.resolve(env.getErrorTrace(error)),
    // Re-create the provider so it re-reads `process.cwd()` (the old cwd cache reset hook is gone).
    resetWorkingDirectory: () => {
      env = factory();
      return Promise.resolve();
    },
    dispose: () => Promise.resolve(),
    get raw() {
      return env;
    },
  };
  return wrapped;
}

const cwd = process.cwd();

registerUniversalRuntimeTests({
  label: "node",
  expectedRuntime: "node",
  create: async () => wrapEnvironment(createNodeEnvironment),
  // NOTE: the user frame lives at an absolute path OUTSIDE cwd. This repo's cwd literally ends in
  // "tslog", and v5's default ignore patterns treat any "tslog/src/" path as tslog's own source — so a
  // synthetic `${cwd}/src/app.ts` user frame would be (incorrectly, for the test's purpose) skipped as
  // internal. Using `/srv/app/src/app.ts` keeps the scenario meaningful: the only tslog-owned frame is
  // the `node_modules/.vite/deps/tslog.js` bundle, which auto-detection must skip to land on user code.
  stackScenario: {
    description: "skips tslog frames when determining caller",
    errorStack: `Error\n    at Logger.log (${cwd}/node_modules/.vite/deps/tslog.js:1:1)\n    at userFunction (/srv/app/src/app.ts:42:7)`,
    expectedFilePathWithLine: "/srv/app/src/app.ts:42",
    expectedAutoIndex: 1,
  },
});

registerUniversalRuntimeTests({
  label: "browser (simulated)",
  expectedRuntime: "browser",
  create: async () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      navigator?: unknown;
      location?: unknown;
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalLocation = globalAny.location;

    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Simulated)" });
    globalAny.location = { origin: "http://localhost" };

    // The browser provider detects the (now stubbed) DOM globals at construction time and selects
    // browser-style stack parsing — the v5 equivalent of the monolith picking the browser branch.
    const wrapped = wrapEnvironment(createBrowserEnvironment);

    const dispose = async () => {
      await wrapped.dispose?.();
      if (originalWindow === undefined) {
        delete globalAny.window;
      } else {
        globalAny.window = originalWindow;
      }
      if (originalDocument === undefined) {
        delete globalAny.document;
      } else {
        globalAny.document = originalDocument;
      }
      vi.unstubAllGlobals();
      if (originalLocation === undefined) {
        delete globalAny.location;
      } else {
        globalAny.location = originalLocation;
      }
    };

    return {
      ...wrapped,
      dispose,
    };
  },
  stackScenario: {
    description: "simulated browser skips tslog frames",
    errorStack: "Error\ntslog@http://localhost/node_modules/.vite/deps/tslog.js:1:1\nuserFn@http://localhost/src/main.ts:12:3",
    expectedFilePathWithLine: "/src/main.ts:12",
    expectedAutoIndex: 1,
  },
});

describe("Node runtime specifics", () => {
  const originalProcessCwd = process.cwd;

  afterEach(() => {
    process.cwd = originalProcessCwd;
  });

  test("process.cwd permission errors are ignored", () => {
    (process as unknown as { cwd: () => string }).cwd = () => {
      throw new Error("permission denied");
    };

    const logger = new Logger({ type: "pretty" });

    expect(() => logger.info("cwd failure")).not.toThrow();
  });

  test("returns empty frame when no stack entries", async () => {
    const env = wrapEnvironment();
    const frame = await env.getCallerStackFrame(Number.NaN, { stack: "Error" } as Error);
    expect(frame).toEqual({});
  });

  test("skips stack lines that are not real frames", async () => {
    const env = wrapEnvironment();
    const error = { stack: "Error\nThis is not a frame" } as unknown as Error;
    expect(await env.getErrorTrace(error)).toEqual([]);
  });

  test("parses stack lines with method and column", async () => {
    process.cwd = () => "/tmp/project";
    const env = wrapEnvironment();
    await env.resetWorkingDirectory?.();

    const error = {
      stack: "Error\n    at myMethod (/tmp/project/src/app.ts:12:3)",
    } as unknown as Error;
    const frame = await env.getCallerStackFrame(Number.NaN, error);

    expect(frame.fileName).toBe("app.ts");
    expect(frame.method).toBe("myMethod");
    expect(frame.fileColumn).toBe("3");
    expect(frame.fileLine).toBe("12");
  });

  test("parses stack lines without column numbers", async () => {
    process.cwd = () => "/tmp/project";
    const env = wrapEnvironment();
    await env.resetWorkingDirectory?.();

    const error = {
      stack: "Error\n    at /tmp/project/src/app.ts:42",
    } as unknown as Error;
    const [frame] = await env.getErrorTrace(error);

    expect(frame?.fileLine).toBe("42");
    expect(frame?.fileColumn).toBeUndefined();
  });

  test("normalizes empty relative path", async () => {
    process.cwd = () => "/tmp/project";
    const env = wrapEnvironment();
    await env.resetWorkingDirectory?.();

    const error = {
      stack: "Error\n    at loader (/tmp/project)",
    } as unknown as Error;
    const frame = await env.getCallerStackFrame(Number.NaN, error);

    expect(frame.fullFilePath).toBe("/tmp/project");
    expect(frame.filePath).toBe("/tmp/project");
  });

  test("defensively handles stack parsers receiving undefined entries", async () => {
    vi.resetModules();

    // The Node provider's stack parsing now lives in `../src/env/stackTrace.js`; mock `buildStackTrace`
    // there to feed an undefined line into the parser and assert the provider tolerates it.
    vi.doMock("../src/env/stackTrace.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/env/stackTrace.js")>();
      return {
        ...actual,
        buildStackTrace: (_error: Error, parseLine: (line: string) => unknown) => {
          const maybeFrame = parseLine(undefined as unknown as string);
          return maybeFrame != null ? [maybeFrame] : [];
        },
      };
    });

    const { createNodeEnvironment: freshCreate } = await import("../src/env/environment.node.js");
    const env = freshCreate();
    expect(env.getErrorTrace(new Error("boom"))).toEqual([]);

    vi.doUnmock("../src/env/stackTrace.js");
  });

  test("pretty error formatting omits function properties", () => {
    const logger = new Logger({ type: "pretty", pretty: { style: false } });
    const settings = {
      ...logger.settings,
      pretty: {
        ...logger.settings.pretty,
        style: false,
        errorTemplate: "{{errorMessage}}",
        styles: {},
      },
    } as ISettings<unknown>;

    const error = new Error("boom");
    Object.defineProperty(error, "context", {
      value: "details",
      configurable: true,
    });
    Object.defineProperty(error, "getMeta", {
      value: () => "should be ignored",
      configurable: true,
    });

    const env = wrapEnvironment();
    const rendered = env.raw.prettyFormatErrorObj(error, settings);

    expect(rendered).toContain("details");
    expect(rendered).not.toContain("should be ignored");
  });

  test("resolveRuntimeVersion falls back to alternative environments", () => {
    const originalProcess = (globalThis as { process?: unknown }).process;
    const originalDeno = (globalThis as { Deno?: unknown }).Deno;
    const originalBun = (globalThis as { Bun?: unknown }).Bun;

    // Runtime detection now happens at provider construction (detectRuntimeInfo). The universal
    // provider re-detects the stubbed globals each time it is created, so we rebuild it per scenario.
    (globalThis as { process?: unknown }).process = { versions: {}, env: {} };
    (globalThis as { Deno?: unknown }).Deno = { version: { deno: "1.2.3" } };
    let env = createUniversalEnvironment();
    let meta = env.getMeta(0, "INFO", 0, false) as IMeta & { runtimeVersion?: string };
    expect(meta.runtimeVersion).toBe("deno/1.2.3");

    (globalThis as { Deno?: unknown }).Deno = undefined;
    (globalThis as { Bun?: unknown }).Bun = { version: "1.0.0" };
    env = createUniversalEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { runtimeVersion?: string };
    expect(meta.runtimeVersion).toBe("bun/1.0.0");

    (globalThis as { Bun?: unknown }).Bun = undefined;
    (globalThis as { process?: unknown }).process = { env: {} } as unknown;
    env = createUniversalEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { runtimeVersion?: string };
    expect(meta.runtimeVersion).toBe("unknown");

    (globalThis as { process?: unknown }).process = originalProcess;
    (globalThis as { Deno?: unknown }).Deno = originalDeno;
    (globalThis as { Bun?: unknown }).Bun = originalBun;
  });

  test("resolveHostname checks env, Deno, and location sources", () => {
    const globalAny = globalThis as unknown as {
      process?: { env?: Record<string, string | undefined>; versions?: Record<string, string> };
      Deno?: { env?: { get?: (key: string) => string | undefined }; hostname?: () => string };
      location?: { hostname?: string };
    };
    const originalProcess = globalAny.process;
    const originalDeno = globalAny.Deno;
    const originalLocation = globalAny.location;

    globalAny.process = { env: { HOSTNAME: "env-host" }, versions: { node: "18.0.0" } };
    globalAny.Deno = undefined;
    globalAny.location = undefined;
    let env = createUniversalEnvironment();
    let meta = env.getMeta(0, "INFO", 0, false) as IMeta & { hostname?: string };
    expect(meta.hostname).toBe("env-host");

    globalAny.process = { env: {} };
    globalAny.Deno = { env: { get: () => "deno-env" } };
    globalAny.location = undefined;
    env = createUniversalEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { hostname?: string };
    expect(meta.hostname).toBe("deno-env");

    globalAny.process = { env: {} };
    globalAny.Deno = { hostname: () => "deno-host" };
    globalAny.location = undefined;
    env = createUniversalEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { hostname?: string };
    expect(meta.hostname).toBe("deno-host");

    globalAny.process = { env: {} };
    globalAny.Deno = undefined;
    globalAny.location = { hostname: "browser-host" };
    env = createUniversalEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { hostname?: string };
    expect(meta.hostname).toBe("browser-host");

    globalAny.process = originalProcess;
    globalAny.Deno = originalDeno;
    if (originalLocation === undefined) {
      delete globalAny.location;
    } else {
      globalAny.location = originalLocation;
    }
  });

  test("transportFormatted falls back when util formatting fails", async () => {
    const originalConsoleLog = console.log;
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();

    // The universal/browser providers resolve their formatter via `resolveInspect()` (native
    // `node:util` through process.getBuiltinModule, else the polyfill). Mock the resolver itself to
    // return a throwing formatter so the fallback in `formatWithOptionsSafe` is driven regardless of
    // which implementation the runtime would pick.
    vi.doMock("../src/render/inspect.js", () => ({
      resolveInspect: () => (): string => {
        throw new Error("boom");
      },
    }));

    const { createUniversalEnvironment: freshCreate } = await import("../src/env/environment.universal.js");
    const env = freshCreate();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    env.transportFormatted("meta", [circular], [], undefined, {
      pretty: {
        style: false,
        inspectOptions: { colors: false, depth: 2, compact: false },
      },
    } as unknown as Parameters<typeof env.transportFormatted>[4]);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[object Object]"));

    consoleSpy.mockRestore();
    console.log = originalConsoleLog;
    vi.doUnmock("../src/render/inspect.js");
  });
});
