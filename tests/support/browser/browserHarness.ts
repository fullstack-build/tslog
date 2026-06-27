import type { Page } from "@playwright/test";

/**
 * Shared helpers for the browser specs. The tslog browser bundle is loaded as a
 * global (`window.tslog`) by tests/support/browser/server/static/index.html, so
 * every scenario runs inside `page.evaluate` against that global.
 *
 * Two patterns are supported:
 *  - `inPage`: run a scenario (and any value extraction) inside the page and
 *    return a JSON-serializable verdict. Use this for tests that inspect the
 *    returned logObj, which contains Date/Map/Set values that cannot cross the
 *    page boundary intact.
 *  - `captureConsole`: run a scenario with console.log recorded, and return the
 *    captured lines. Use this for tests that assert on printed output.
 */

export type LoggerSettings = Record<string, unknown>;

/**
 * Runs `body` inside the page. `body` is a function body that receives `tslog`
 * (the bundle global) and `settings`, and returns a JSON-serializable value.
 * Keep all assertions that rely on non-serializable values (Date/Map/Set,
 * instanceof checks) inside the body and return primitives/booleans.
 */
export async function inPage<T = unknown>(page: Page, settings: LoggerSettings, body: string): Promise<T> {
  return (await page.evaluate(
    ({ source, loggerSettings }) => {
      const tslog = (window as unknown as { tslog: unknown }).tslog;
      const settings = loggerSettings;
      // biome-ignore lint/security/noGlobalEval: test harness needs to run scenario source in-page
      return new Function("tslog", "settings", source)(tslog, settings);
    },
    { source: body, loggerSettings: settings },
  )) as T;
}

/**
 * Runs `body` inside the page with `console.log` patched to record every call,
 * then restores it. Returns the recorded calls plus convenience views:
 * `firstLine` (String of the first arg of the first call) and `combined`
 * (every call's args stringified and newline-joined). `body` may return a value,
 * surfaced as `returnValue`.
 */
export async function captureConsole<T = unknown>(
  page: Page,
  settings: LoggerSettings,
  body: string,
): Promise<{ calls: unknown[][]; firstLine: string; combined: string; returnValue: T | undefined }> {
  return (await page.evaluate(
    ({ source, loggerSettings }) => {
      const calls: unknown[][] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        calls.push(args);
      };
      let returnValue: unknown;
      try {
        const tslog = (window as unknown as { tslog: unknown }).tslog;
        const settings = loggerSettings;
        // biome-ignore lint/security/noGlobalEval: test harness needs to run scenario source in-page
        returnValue = new Function("tslog", "settings", source)(tslog, settings);
      } finally {
        console.log = originalLog;
      }
      const firstLine = calls.length > 0 ? String(calls[0]?.[0] ?? "") : "";
      const combined = calls.map((args) => args.map((a) => String(a)).join(" ")).join("\n");
      return { calls, firstLine, combined, returnValue };
    },
    { source: body, loggerSettings: settings },
  )) as { calls: unknown[][]; firstLine: string; combined: string; returnValue: T | undefined };
}
