import "ts-jest";
import { Logger } from "../src";

describe("Logger environment adjustments", () => {
  const globalAny = globalThis as { window?: unknown; document?: unknown };
  const originalWindow = globalAny.window;
  const originalDocument = globalAny.document;

  afterEach(() => {
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
  });

  test("keeps ANSI styling enabled and relies on browser CSS support", () => {
    globalAny.window = {};
    globalAny.document = {};

    const logger = new Logger({ stylePrettyLogs: true });

    expect(logger.settings.stylePrettyLogs).toBe(true);
  });

  test("respects explicit styling opt-out", () => {
    globalAny.window = {};
    globalAny.document = {};

    const logger = new Logger({ stylePrettyLogs: false });

    expect(logger.settings.stylePrettyLogs).toBe(false);
  });
});
