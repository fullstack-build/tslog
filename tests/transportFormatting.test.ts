import "ts-jest";
const originalConsoleLog = console.log;

describe("transport behaviour", () => {
  afterEach(() => {
    console.log = originalConsoleLog;
    jest.resetModules();
  });

  test("pretty transport uses CSS styling when supported", () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      navigator?: { userAgent?: string };
      CSS?: { supports?: (property: string, value: string) => boolean };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalNavigator = globalAny.navigator;
    const originalCSS = globalAny.CSS;

    globalAny.window = {};
    globalAny.document = {};
    globalAny.navigator = { userAgent: "Mozilla/5.0 Firefox" };
    globalAny.CSS = { supports: () => true };

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    jest.isolateModules(() => {
      const { Logger } = require("../src/index.js") as typeof import("../src/index.js");
      const logger = new Logger({ type: "pretty" });
      logger.info("styled output");
    });

    expect(consoleSpy).toHaveBeenCalled();
    const call = consoleSpy.mock.calls.find((entry) => typeof entry[0] === "string" && entry[0].includes("%c"));
    expect(call).toBeDefined();
    expect(call && call.length).toBeGreaterThan(1);

    consoleSpy.mockRestore();

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
    if (originalCSS === undefined) {
      delete globalAny.CSS;
    } else {
      globalAny.CSS = originalCSS;
    }
  });

  test("json transport stringifies undefined values", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    jest.isolateModules(() => {
      const { Logger } = require("../src/index.js") as typeof import("../src/index.js");
      const logger = new Logger({ type: "json" });
      logger.info({ value: undefined });
    });

    expect(consoleSpy).toHaveBeenCalled();
    const payload = String(consoleSpy.mock.calls[0]?.[0] ?? "");
    expect(payload).toContain('"value":"[undefined]"');

    consoleSpy.mockRestore();
  });

  test("runtime marks objects with Error-like names as errors", () => {
    jest.isolateModules(() => {
      const { createLoggerEnvironment } = require("../src/BaseLogger.js") as typeof import("../src/BaseLogger.js");
      const env = createLoggerEnvironment();
      const errorLike = { name: "CustomError" };
      expect(env.isError(errorLike)).toBe(true);
    });
  });

  test("pretty transport falls back to sanitized output when no CSS metadata", () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      navigator?: { userAgent?: string };
      CSS?: { supports?: (property: string, value: string) => boolean };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalNavigator = globalAny.navigator;
    const originalCSS = globalAny.CSS;

    globalAny.window = {};
    globalAny.document = {};
    globalAny.navigator = { userAgent: "Mozilla/5.0 Firefox" };
    globalAny.CSS = { supports: () => true };

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    jest.isolateModules(() => {
      const { Logger } = require("../src/index.js") as typeof import("../src/index.js");
      const logger = new Logger({ type: "pretty", prettyLogTemplate: "static output" });
      logger.info("unstyled");
    });

    const call = consoleSpy.mock.calls.find((entry) => typeof entry[0] === "string" && entry[0].includes("static output"));
    expect(call).toBeDefined();
    expect(call && call.length).toBe(1);

    consoleSpy.mockRestore();

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
    if (originalCSS === undefined) {
      delete globalAny.CSS;
    } else {
      globalAny.CSS = originalCSS;
    }
  });

  test("collectStyleTokens handles nested style definitions", () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      navigator?: { userAgent?: string };
      CSS?: { supports?: (property: string, value: string) => boolean };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalNavigator = globalAny.navigator;
    const originalCSS = globalAny.CSS;

    globalAny.window = {};
    globalAny.document = {};
    globalAny.navigator = { userAgent: "Mozilla/5.0 Firefox" };
    globalAny.CSS = { supports: () => true };

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    jest.isolateModules(() => {
      const { Logger } = require("../src/index.js") as typeof import("../src/index.js");
      const logger = new Logger({ type: "pretty" });
      logger.settings.prettyLogTemplate = "{{logLevelName}}";
      logger.settings.prettyLogStyles = {
        ...logger.settings.prettyLogStyles,
        logLevelName: {
          INFO: ["bold", "underline", "hidden", "dim", "italic"],
          "*": ["italic"],
        },
      };
      logger.info("styled");
    });

    const call = consoleSpy.mock.calls.find((entry) => typeof entry[0] === "string" && entry[0].includes("%cINFO%c"));
    expect(call).toBeDefined();
    const styles = call ? call.slice(1).join(";") : "";
    expect(styles).toContain("font-weight: bold");
    expect(styles).toContain("text-decoration: underline");
    expect(styles).toContain("visibility: hidden");
    expect(styles).toContain("opacity: 0.75");
    expect(styles).toContain("font-style: italic");

    consoleSpy.mockRestore();

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
    if (originalCSS === undefined) {
      delete globalAny.CSS;
    } else {
      globalAny.CSS = originalCSS;
    }
  });

  test("browser stack parser ignores malformed matches", () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      navigator?: { userAgent?: string };
      location?: { origin?: string };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalNavigator = globalAny.navigator;
    const originalLocation = globalAny.location;

    globalAny.window = {};
    globalAny.document = {};
    globalAny.navigator = { userAgent: "Mozilla/5.0" };
    globalAny.location = { origin: "http://localhost" };

    jest.isolateModules(() => {
      const { createLoggerEnvironment } = require("../src/BaseLogger.js") as typeof import("../src/BaseLogger.js");
      const env = createLoggerEnvironment();
      const frames = env.getErrorTrace({ stack: "Error\ngarbage frame" } as Error);
      expect(frames).toEqual([]);
    });

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
  });
});
