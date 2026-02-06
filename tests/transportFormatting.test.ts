const originalConsoleLog = console.log;

describe("transport behaviour", () => {
  afterEach(() => {
    console.log = originalConsoleLog;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("pretty transport uses CSS styling when supported", async () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      CSS?: { supports?: (property: string, value: string) => boolean };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalCSS = globalAny.CSS;

    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox" });
    globalAny.CSS = { supports: () => true };

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    const { Logger } = await import("../src/index.js");
    const logger = new Logger({ type: "pretty" });
    logger.info("styled output");

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
    if (originalCSS === undefined) {
      delete globalAny.CSS;
    } else {
      globalAny.CSS = originalCSS;
    }
  });

  test("json transport stringifies undefined values", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    const { Logger } = await import("../src/index.js");
    const logger = new Logger({ type: "json" });
    logger.info({ value: undefined });

    expect(consoleSpy).toHaveBeenCalled();
    const payload = String(consoleSpy.mock.calls[0]?.[0] ?? "");
    expect(payload).toContain('"value":"[undefined]"');

    consoleSpy.mockRestore();
  });

  test("runtime marks objects with Error-like names as errors", async () => {
    vi.resetModules();
    const { createLoggerEnvironment } = await import("../src/BaseLogger.js");
    const env = createLoggerEnvironment();
    const errorLike = { name: "CustomError" };
    expect(env.isError(errorLike)).toBe(true);
  });

  test("pretty transport falls back to sanitized output when no CSS metadata", async () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      CSS?: { supports?: (property: string, value: string) => boolean };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalCSS = globalAny.CSS;

    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox" });
    globalAny.CSS = { supports: () => true };

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    const { Logger } = await import("../src/index.js");
    const logger = new Logger({ type: "pretty", prettyLogTemplate: "static output" });
    logger.info("unstyled");

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
    if (originalCSS === undefined) {
      delete globalAny.CSS;
    } else {
      globalAny.CSS = originalCSS;
    }
  });

  test("collectStyleTokens handles nested style definitions", async () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      CSS?: { supports?: (property: string, value: string) => boolean };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalCSS = globalAny.CSS;

    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Firefox" });
    globalAny.CSS = { supports: () => true };

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    const { Logger } = await import("../src/index.js");
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
    if (originalCSS === undefined) {
      delete globalAny.CSS;
    } else {
      globalAny.CSS = originalCSS;
    }
  });

  test("browser stack parser ignores malformed matches", async () => {
    const globalAny = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      location?: { origin?: string };
    };
    const originalWindow = globalAny.window;
    const originalDocument = globalAny.document;
    const originalLocation = globalAny.location;

    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" });
    globalAny.location = { origin: "http://localhost" };

    vi.resetModules();
    const { createLoggerEnvironment } = await import("../src/BaseLogger.js");
    const env = createLoggerEnvironment();
    const frames = env.getErrorTrace({ stack: "Error\ngarbage frame" } as Error);
    expect(frames).toEqual([]);

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
    if (originalLocation === undefined) {
      delete globalAny.location;
    } else {
      globalAny.location = originalLocation;
    }
  });
});
