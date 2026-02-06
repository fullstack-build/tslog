import { safeGetCwd, consoleSupportsCssStyling } from "../src/internal/environment.js";

describe("environment helpers", () => {
  const originalProcess = globalThis.process;
  const originalDeno = (globalThis as Record<string, unknown>).Deno;
  const originalWindow = (globalThis as Record<string, unknown>).window;
  const originalDocument = (globalThis as Record<string, unknown>).document;

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.process = originalProcess;
    if (originalDeno === undefined) {
      delete (globalThis as Record<string, unknown>).Deno;
    } else {
      (globalThis as Record<string, unknown>).Deno = originalDeno;
    }
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      (globalThis as Record<string, unknown>).window = originalWindow;
    }
    if (originalDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      (globalThis as Record<string, unknown>).document = originalDocument;
    }
  });

  test("returns process cwd when available", () => {
    const cwdMock = vi.fn(() => "/tmp/process");
    // @ts-expect-error - building mock process object
    globalThis.process = { cwd: cwdMock };

    expect(safeGetCwd()).toBe("/tmp/process");
    expect(cwdMock).toHaveBeenCalled();
  });

  test("falls back to Deno cwd when process cwd fails", () => {
    const cwdMock = vi.fn(() => {
      throw new Error("no permission");
    });
    // @ts-expect-error - building mock process object
    globalThis.process = { cwd: cwdMock };
    const denoCwd = vi.fn(() => "/deno/cwd");
    (globalThis as Record<string, unknown>).Deno = { cwd: denoCwd };

    expect(safeGetCwd()).toBe("/deno/cwd");
    expect(cwdMock).toHaveBeenCalled();
    expect(denoCwd).toHaveBeenCalled();
  });

  test("returns undefined when no cwd available", () => {
    // @ts-expect-error - no cwd on purpose
    globalThis.process = {};
    delete (globalThis as Record<string, unknown>).Deno;

    expect(safeGetCwd()).toBeUndefined();
  });

  test("consoleSupportsCssStyling detects capabilities", () => {
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).document = {};
    vi.stubGlobal("navigator", { userAgent: "Firefox" });
    expect(consoleSupportsCssStyling()).toBe(true);

    vi.stubGlobal("navigator", { userAgent: "Safari" });
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).CSS = { supports: vi.fn(() => false) };
    expect(consoleSupportsCssStyling()).toBe(true);

    vi.stubGlobal("navigator", { userAgent: "Chrome" });
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).document = {};
    (globalThis as Record<string, unknown>).CSS = { supports: vi.fn(() => true) };
    expect(consoleSupportsCssStyling()).toBe(true);

    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).CSS;
    expect(consoleSupportsCssStyling()).toBe(false);
  });
});
