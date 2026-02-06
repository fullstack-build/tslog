import { test, expect } from "@playwright/test";
import type { IMeta, IStackFrame } from "../src/interfaces.js";
import { findFirstExternalFrameIndex, getDefaultIgnorePatterns } from "../src/internal/stackTrace.js";

type BrowserMetaPayload = Omit<IMeta, "date"> & { date: string | null };

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    delete (window as { __tslogEnv?: unknown }).__tslogEnv;
  });
});

async function ensureRuntimeAvailable(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const tslogGlobal = (
      window as unknown as {
        tslog?: { createLoggerEnvironment?: () => unknown; loggerEnvironment?: unknown };
      }
    ).tslog;
    return tslogGlobal != null;
  });
}

async function getMeta(
  page: import("@playwright/test").Page,
  logLevelId: number,
  logLevelName: string,
  stackDepthLevel: number,
  hideLogPositionForPerformance: boolean,
  name?: string,
  parentNames?: string[],
): Promise<IMeta> {
  await ensureRuntimeAvailable(page);
  const payload = (await page.evaluate(
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
    { logLevelId, logLevelName, stackDepthLevel, hide: hideLogPositionForPerformance, name, parentNames },
  )) as BrowserMetaPayload;
  return {
    ...payload,
    date: payload.date != null ? new Date(payload.date) : new Date(),
  } as IMeta;
}

async function getErrorTrace(page: import("@playwright/test").Page, error: Error): Promise<IStackFrame[]> {
  await ensureRuntimeAvailable(page);
  return (await page.evaluate((stack) => {
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
}

async function getCallerStackFrame(page: import("@playwright/test").Page, stackDepthLevel: number, error: Error): Promise<IStackFrame> {
  await ensureRuntimeAvailable(page);
  return (await page.evaluate(
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
}

test.describe("logger environment (browser via playwright)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });
  });

  test("reports runtime name in meta", async ({ page }) => {
    const meta = await getMeta(page, 3, "INFO", Number.NaN, false);
    expect(meta.runtime).toBe("browser");
    expect(meta.date).toBeInstanceOf(Date);
  });

  test("skips tslog frames when determining caller", async ({ page }) => {
    const errorStack = "Error\ntslog@http://localhost/node_modules/.vite/deps/tslog.js:1:1\nuserFn@http://localhost/src/main.ts:12:3";
    const error = { stack: errorStack } as Error;
    const frames = await getErrorTrace(page, error);
    const autoIndex = findFirstExternalFrameIndex(frames, getDefaultIgnorePatterns());
    expect(autoIndex).toBe(1);

    const frame = await getCallerStackFrame(page, Number.NaN, error);
    expect(frame.filePathWithLine).toBe("/localhost/src/main.ts:12");
  });
});
