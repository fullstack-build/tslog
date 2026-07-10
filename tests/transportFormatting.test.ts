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

  test("passObjectsNatively hands raw objects to the console (Node path)", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    const { Logger } = await import("../src/index.js");
    const logger = new Logger({ type: "pretty", pretty: { passObjectsNatively: true } });
    const payload = { nested: { a: 1 }, arr: [1, 2, 3] };
    logger.info("here", payload);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const call = consoleSpy.mock.calls[0] ?? [];
    // The meta prefix + the "here" string are rendered, but the object arg is passed by reference so a
    // DevTools console can render it collapsibly — i.e. NOT stringified into the first argument.
    expect(call).toContain(payload);
    expect(String(call[0])).not.toContain("nested");

    consoleSpy.mockRestore();
  });

  test("passObjectsNatively keeps the string-only path a single argument", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    const { Logger } = await import("../src/index.js");
    const logger = new Logger({ type: "pretty", pretty: { passObjectsNatively: true } });
    logger.info("just a string");

    const call = consoleSpy.mock.calls[0] ?? [];
    // Meta prefix is the first arg; the plain string trails as a second, raw arg.
    expect(call).toContain("just a string");

    consoleSpy.mockRestore();
  });

  test("passObjectsNatively still routes errors through the pretty template as strings", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    vi.resetModules();
    const { Logger } = await import("../src/index.js");
    const logger = new Logger({ type: "pretty", pretty: { passObjectsNatively: true } });
    logger.error("boom", new Error("kaboom"));

    const call = consoleSpy.mock.calls[0] ?? [];
    // The rendered error stack is a pre-formatted string trailing after the raw args, never an Error object.
    const joined = call.map((part) => (typeof part === "string" ? part : "")).join("\n");
    expect(joined).toContain("kaboom");
    expect(call.some((part) => part instanceof Error)).toBe(false);

    consoleSpy.mockRestore();
  });

  test("passObjectsNatively trails raw objects after the CSS-styled meta (browser path)", async () => {
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
    const logger = new Logger({ type: "pretty", pretty: { passObjectsNatively: true } });
    const payload = { user: 42 };
    logger.info("styled", payload);

    const call = consoleSpy.mock.calls.find((entry) => typeof entry[0] === "string" && entry[0].includes("%c"));
    expect(call).toBeDefined();
    // The raw object survives past the %c style values as a trailing, by-reference argument.
    expect(call).toContain(payload);

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

  test("passObjectsNatively trails the rendered error string after the raw args (browser path)", async () => {
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
    const logger = new Logger({ type: "pretty", pretty: { passObjectsNatively: true } });
    const payload = { user: 42 };
    logger.error("styled", payload, new Error("kaboom"));

    const call = consoleSpy.mock.calls.find((entry) => typeof entry[0] === "string" && entry[0].includes("%c"));
    expect(call).toBeDefined();
    // Raw args stay by-reference, and the pretty-rendered error stack still arrives — as the final
    // trailing string argument, never as an Error object.
    expect(call).toContain(payload);
    const last = call?.[call.length - 1];
    expect(typeof last).toBe("string");
    expect(last).toContain("kaboom");
    expect(call?.some((part) => part instanceof Error)).toBe(false);

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
    const { createNodeEnvironment } = await import("../src/env/environment.node.js");
    const env = createNodeEnvironment();
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
    const logger = new Logger({ type: "pretty", pretty: { template: "static output" } });
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
    logger.settings.pretty.template = "{{logLevelName}}";
    logger.settings.pretty.styles = {
      ...logger.settings.pretty.styles,
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
    const { createBrowserEnvironment } = await import("../src/env/environment.browser.js");
    const env = createBrowserEnvironment();
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
