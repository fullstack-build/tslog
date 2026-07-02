import { expect, test } from "@playwright/test";
// v5 (BC11): the env provider's stack-frame helpers live in `src/env/stackTrace.js` — the module the
// browser provider itself imports from. The legacy `src/internal/stackTrace.js` copy is no longer the
// one the runtime uses, so assert against the env-level helpers to stay in lockstep with the runtime.
import { findFirstExternalFrameIndex, getDefaultIgnorePatterns } from "../src/env/stackTrace.js";
import type { IMeta, IStackFrame } from "../src/interfaces.js";

type BrowserMetaPayload = Omit<IMeta, "date"> & { date: string | null };

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    delete (window as { __tslogEnv?: unknown }).__tslogEnv;
  });
});

async function ensureRuntimeAvailable(page: import("@playwright/test").Page) {
  // v5 (BC11): the `loggerEnvironment` singleton and `createLoggerEnvironment()` factory are gone. The
  // browser provider is now injected into each `Logger` and exposed as the public `runtime` field, so the
  // tests reach it via `new tslog.Logger().runtime`. We only need the bundle global to be present here.
  await page.waitForFunction(() => {
    const tslogGlobal = (window as unknown as { tslog?: { Logger?: unknown } }).tslog;
    return tslogGlobal != null && typeof tslogGlobal.Logger === "function";
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
        tslog?: { Logger?: new () => { runtime?: unknown } };
        __tslogEnv?: unknown;
      };
      if (!tslogGlobal.__tslogEnv) {
        // v5: the injected per-runtime provider is reachable as `Logger.runtime`.
        const LoggerCtor = tslogGlobal.tslog?.Logger;
        tslogGlobal.__tslogEnv = LoggerCtor != null ? new LoggerCtor().runtime : undefined;
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
      tslog?: { Logger?: new () => { runtime?: unknown } };
      __tslogEnv?: unknown;
    };
    if (!tslogGlobal.__tslogEnv) {
      const LoggerCtor = tslogGlobal.tslog?.Logger;
      tslogGlobal.__tslogEnv = LoggerCtor != null ? new LoggerCtor().runtime : undefined;
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
        tslog?: { Logger?: new () => { runtime?: unknown } };
        __tslogEnv?: unknown;
      };
      if (!tslogGlobal.__tslogEnv) {
        const LoggerCtor = tslogGlobal.tslog?.Logger;
        tslogGlobal.__tslogEnv = LoggerCtor != null ? new LoggerCtor().runtime : undefined;
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
