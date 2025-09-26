import "ts-jest";
import { Logger } from "../src/index.js";
import { createLoggerEnvironment, loggerEnvironment } from "../src/BaseLogger.js";
import type { IMeta, ISettings } from "../src/interfaces.js";
import { registerUniversalRuntimeTests } from "./shared/runtimeHarness.js";

function wrapEnvironment(env = createLoggerEnvironment()) {
  return {
    getMeta: (
      logLevelId: number,
      logLevelName: string,
      stackDepthLevel: number,
      hideLogPositionForPerformance: boolean,
      name?: string,
      parentNames?: string[],
    ) => Promise.resolve(env.getMeta(logLevelId, logLevelName, stackDepthLevel, hideLogPositionForPerformance, name, parentNames)),
    getCallerStackFrame: (stackDepthLevel: number, error: Error) => Promise.resolve(env.getCallerStackFrame(stackDepthLevel, error)),
    getErrorTrace: (error: Error) => Promise.resolve(env.getErrorTrace(error)),
    resetWorkingDirectory: () =>
      Promise.resolve((env as unknown as { __resetWorkingDirectoryCacheForTests?: () => void }).__resetWorkingDirectoryCacheForTests?.()),
    dispose: () => Promise.resolve(),
    raw: env,
  };
}

const cwd = process.cwd();

registerUniversalRuntimeTests({
  label: "node",
  expectedRuntime: "node",
  create: async () => wrapEnvironment(),
  stackScenario: {
    description: "skips tslog frames when determining caller",
    errorStack: `Error\n    at Logger.log (${cwd}/node_modules/.vite/deps/tslog.js:1:1)\n    at userFunction (${cwd}/src/app.ts:42:7)`,
    expectedFilePathWithLine: "src/app.ts:42",
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
    const originalNavigator = globalAny.navigator;
    const originalLocation = globalAny.location;

    globalAny.window = {};
    globalAny.document = {};
    globalAny.navigator = { userAgent: "Mozilla/5.0 (Simulated)" };
    globalAny.location = { origin: "http://localhost" };

    const wrapped = wrapEnvironment(createLoggerEnvironment());

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
      if (originalNavigator === undefined) {
        delete globalAny.navigator;
      } else {
        globalAny.navigator = originalNavigator;
      }
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
    expectedFilePathWithLine: "/localhost/src/main.ts:12",
    expectedAutoIndex: 1,
  },
});

describe("Node runtime specifics", () => {
  const originalProcessCwd = process.cwd;

  afterEach(() => {
    process.cwd = originalProcessCwd;
    (loggerEnvironment as unknown as { __resetWorkingDirectoryCacheForTests?: () => void }).__resetWorkingDirectoryCacheForTests?.();
  });

  test("process.cwd permission errors are ignored", () => {
    (loggerEnvironment as unknown as { __resetWorkingDirectoryCacheForTests?: () => void }).__resetWorkingDirectoryCacheForTests?.();

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
    const sharedModulePath = require.resolve("../src/internal/stackTrace.js");

    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock(sharedModulePath, () => {
        const actual = jest.requireActual(sharedModulePath);
        return {
          ...actual,
          buildStackTrace: (_error: Error, parseLine: (line: string) => unknown) => {
            const maybeFrame = parseLine(undefined as unknown as string);
            return maybeFrame != null ? [maybeFrame] : [];
          },
        };
      });

      const { createLoggerEnvironment: freshCreate } = require("../src/BaseLogger.js");
      const env = freshCreate();
      expect(env.getErrorTrace(new Error("boom"))).toEqual([]);
    });

    jest.dontMock(sharedModulePath);
  });

  test("pretty error formatting omits function properties", () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
    const settings = {
      ...logger.settings,
      stylePrettyLogs: false,
      prettyErrorTemplate: "{{errorMessage}}",
      prettyLogStyles: {},
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

    (globalThis as { process?: unknown }).process = { versions: {}, env: {} };
    (globalThis as { Deno?: unknown }).Deno = { version: { deno: "1.2.3" } };
    let env = createLoggerEnvironment();
    let meta = env.getMeta(0, "INFO", 0, false) as IMeta & { runtimeVersion?: string };
    expect(meta.runtimeVersion).toBe("deno/1.2.3");

    (globalThis as { Deno?: unknown }).Deno = undefined;
    (globalThis as { Bun?: unknown }).Bun = { version: "1.0.0" };
    env = createLoggerEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { runtimeVersion?: string };
    expect(meta.runtimeVersion).toBe("bun/1.0.0");

    (globalThis as { Bun?: unknown }).Bun = undefined;
    (globalThis as { process?: unknown }).process = { env: {} } as unknown;
    env = createLoggerEnvironment();
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
    let env = createLoggerEnvironment();
    let meta = env.getMeta(0, "INFO", 0, false) as IMeta & { hostname?: string };
    expect(meta.hostname).toBe("env-host");

    globalAny.process = { env: {} };
    globalAny.Deno = { env: { get: () => "deno-env" } };
    globalAny.location = undefined;
    env = createLoggerEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { hostname?: string };
    expect(meta.hostname).toBe("deno-env");

    globalAny.process = { env: {} };
    globalAny.Deno = { hostname: () => "deno-host" };
    globalAny.location = undefined;
    env = createLoggerEnvironment();
    meta = env.getMeta(0, "INFO", 0, false) as IMeta & { hostname?: string };
    expect(meta.hostname).toBe("deno-host");

    globalAny.process = { env: {} };
    globalAny.Deno = undefined;
    globalAny.location = { hostname: "browser-host" };
    env = createLoggerEnvironment();
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

  test("transportFormatted falls back when util formatting fails", () => {
    const originalConsoleLog = console.log;
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock("../src/internal/util.inspect.polyfill.js", () => ({
        formatWithOptions: () => {
          throw new Error("boom");
        },
      }));

      const { createLoggerEnvironment: freshCreate } = require("../src/BaseLogger.js");
      const env = freshCreate();
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      env.transportFormatted("meta", [circular], [], undefined, {
        stylePrettyLogs: false,
        prettyInspectOptions: { colors: false, depth: 2, compact: false },
      } as unknown as Parameters<typeof env.transportFormatted>[4]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[object Object]"));
    });

    consoleSpy.mockRestore();
    console.log = originalConsoleLog;
    jest.dontMock("../src/internal/util.inspect.polyfill.js");
  });
});
