/**
 * @jest-environment puppeteer
 */

import "expect-puppeteer";
import type { IMeta, IStackFrame } from "../src/interfaces.js";
import { registerUniversalRuntimeTests } from "./shared/runtimeHarness.js";

declare const browser: import("puppeteer").Browser;

let runtimePage: import("puppeteer").Page;

type BrowserMetaPayload = Omit<IMeta, "date"> & { date: string | null };

afterEach(async () => {
  await runtimePage.evaluate(() => {
    delete (window as { __tslogEnv?: unknown }).__tslogEnv;
  });
});

function createBrowserRuntimeAdapter() {
  const ensureRuntimeAvailable = async () => {
    await runtimePage.waitForFunction(() => {
      const tslogGlobal = (
        window as unknown as {
          tslog?: { createLoggerEnvironment?: () => unknown; loggerEnvironment?: unknown };
        }
      ).tslog;
      return tslogGlobal != null;
    });
  };

  return {
    async getMeta(
      logLevelId: number,
      logLevelName: string,
      stackDepthLevel: number,
      hideLogPositionForPerformance: boolean,
      name?: string,
      parentNames?: string[],
    ): Promise<IMeta> {
      await ensureRuntimeAvailable();
      const payload = (await runtimePage.evaluate(
        (params: { logLevelId: number; logLevelName: string; stackDepthLevel: number; hide: boolean; name?: string; parentNames?: string[] }) => {
          const tslogGlobal = window as unknown as {
            tslog?: { createLoggerEnvironment?: () => unknown; loggerEnvironment?: unknown };
            __tslogEnv?: unknown;
          };
          if (!tslogGlobal.__tslogEnv) {
            const envCandidate = tslogGlobal.tslog?.loggerEnvironment ?? tslogGlobal.tslog?.createLoggerEnvironment?.();
            tslogGlobal.__tslogEnv = envCandidate as unknown;
          }
          if (!tslogGlobal.__tslogEnv) {
            throw new Error("unable to create tslog browser runtime");
          }
          const env = tslogGlobal.__tslogEnv as {
            getMeta: (logLevelId: number, logLevelName: string, stackDepthLevel: number, hide: boolean, name?: string, parentNames?: string[]) => IMeta;
          };
          const result = env.getMeta(params.logLevelId, params.logLevelName, params.stackDepthLevel, params.hide, params.name, params.parentNames);
          return {
            ...result,
            date: result.date instanceof Date ? result.date.toISOString() : null,
          } as BrowserMetaPayload;
        },
        {
          logLevelId,
          logLevelName,
          stackDepthLevel,
          hide: hideLogPositionForPerformance,
          name,
          parentNames,
        },
      )) as BrowserMetaPayload;
      return {
        ...payload,
        date: payload.date != null ? new Date(payload.date) : new Date(),
      } as IMeta;
    },
    async getErrorTrace(error: Error): Promise<IStackFrame[]> {
      await ensureRuntimeAvailable();
      return (await runtimePage.evaluate((stack) => {
        const tslogGlobal = window as unknown as {
          tslog?: { createLoggerEnvironment?: () => unknown; loggerEnvironment?: unknown };
          __tslogEnv?: unknown;
        };
        if (!tslogGlobal.__tslogEnv) {
          const envCandidate = tslogGlobal.tslog?.loggerEnvironment ?? tslogGlobal.tslog?.createLoggerEnvironment?.();
          tslogGlobal.__tslogEnv = envCandidate as unknown;
        }
        const env = tslogGlobal.__tslogEnv as { getErrorTrace: (error: Error) => IStackFrame[] };
        const browserError = new Error("trace");
        browserError.stack = stack;
        return env.getErrorTrace(browserError) ?? [];
      }, error.stack ?? "")) as IStackFrame[];
    },
    async getCallerStackFrame(stackDepthLevel: number, error: Error): Promise<IStackFrame> {
      await ensureRuntimeAvailable();
      return (await runtimePage.evaluate(
        (params: { depth: number; stack: string }) => {
          const tslogGlobal = window as unknown as {
            tslog?: { createLoggerEnvironment?: () => unknown; loggerEnvironment?: unknown };
            __tslogEnv?: unknown;
          };
          if (!tslogGlobal.__tslogEnv) {
            const envCandidate = tslogGlobal.tslog?.loggerEnvironment ?? tslogGlobal.tslog?.createLoggerEnvironment?.();
            tslogGlobal.__tslogEnv = envCandidate as unknown;
          }
          const env = tslogGlobal.__tslogEnv as {
            getCallerStackFrame: (depth: number, error: Error) => IStackFrame;
          };
          const browserError = new Error("frame");
          browserError.stack = params.stack;
          return env.getCallerStackFrame(params.depth, browserError) ?? {};
        },
        { depth: stackDepthLevel, stack: error.stack ?? "" },
      )) as IStackFrame;
    },
  };
}

beforeAll(async () => {
  jest.setTimeout(60000);
  runtimePage = await browser.newPage();
  await runtimePage.goto("http://localhost:4444", { waitUntil: "load" });
});

afterAll(async () => {
  await runtimePage.close();
});

registerUniversalRuntimeTests({
  label: "browser (puppeteer)",
  expectedRuntime: "browser",
  create: async () => createBrowserRuntimeAdapter(),
  stackScenario: {
    description: "skips tslog frames when determining caller",
    errorStack: "Error\ntslog@http://localhost/node_modules/.vite/deps/tslog.js:1:1\nuserFn@http://localhost/src/main.ts:12:3",
    expectedFilePathWithLine: "/localhost/src/main.ts:12",
    expectedAutoIndex: 1,
  },
});
