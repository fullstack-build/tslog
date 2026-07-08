import { Logger, LogLevel, log } from "../src/index.js";

// Tests for the developer-experience additions: named minLevel, the ready-to-use `log` export,
// and dev-mode configuration warnings.

describe("minLevel accepts level names", () => {
  test("a level name filters the same as the numeric id", () => {
    const named = new Logger({ type: "hidden", minLevel: "WARN" });
    expect(named.info("below")).toBeUndefined();
    expect(named.warn("at")).toBeDefined();
    expect(named.error("above")).toBeDefined();
    expect(named.settings.minLevel).toBe(LogLevel.WARN);
  });

  test("a numeric minLevel still works", () => {
    const numeric = new Logger({ type: "hidden", minLevel: LogLevel.ERROR });
    expect(numeric.warn("below")).toBeUndefined();
    expect(numeric.error("at")).toBeDefined();
  });

  test("a sub-logger can override minLevel with a name", () => {
    const parent = new Logger({ type: "hidden", minLevel: "SILLY" });
    const child = parent.getSubLogger({ minLevel: "ERROR" });
    expect(child.warn("below")).toBeUndefined();
    expect(child.error("at")).toBeDefined();
    expect(child.settings.minLevel).toBe(LogLevel.ERROR);
  });
});

describe("the ready-to-use log export", () => {
  test("is a usable Logger instance", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(log).toBeInstanceOf(Logger);
    const out = log.info("hello from default logger");
    expect(out?._logMeta.logLevelName).toBe("INFO");
    consoleSpy.mockRestore();
  });
});

describe("dev-mode configuration warnings", () => {
  function expectWarning(settings: ConstructorParameters<typeof Logger>[0], match: RegExp) {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new Logger(settings);
    const warned = warnSpy.mock.calls.some((c) => match.test(String(c[0])));
    warnSpy.mockRestore();
    return warned;
  }

  test("warns on an out-of-range numeric minLevel", () => {
    expect(expectWarning({ type: "hidden", minLevel: 99 }, /minLevel 99 is outside/)).toBe(true);
  });

  test("warns on an unknown minLevel name", () => {
    expect(expectWarning({ type: "hidden", minLevel: "LOUD" as never }, /unknown minLevel/)).toBe(true);
  });

  test("warns on an unknown pretty.template placeholder (typo)", () => {
    expect(expectWarning({ type: "pretty", pretty: { template: "{{loglevelname}} " } }, /unknown placeholder "\{\{loglevelname\}\}"/)).toBe(true);
  });

  test("does not warn on a valid configuration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new Logger({ type: "json", minLevel: "INFO", pretty: { template: "{{logLevelName}}\t{{filePathWithLine}}" } });
    const warned = warnSpy.mock.calls.some((c) => String(c[0]).startsWith("tslog:"));
    warnSpy.mockRestore();
    expect(warned).toBe(false);
  });

  test("warnings are suppressed in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new Logger({ type: "hidden", minLevel: 99 });
    const warned = warnSpy.mock.calls.some((c) => String(c[0]).startsWith("tslog:"));
    warnSpy.mockRestore();
    process.env.NODE_ENV = prev;
    expect(warned).toBe(false);
  });

  test("warnings can be disabled via TSLOG_DISABLE_WARNINGS", () => {
    const prev = process.env.TSLOG_DISABLE_WARNINGS;
    process.env.TSLOG_DISABLE_WARNINGS = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new Logger({ type: "hidden", minLevel: 99 });
    const warned = warnSpy.mock.calls.some((c) => String(c[0]).startsWith("tslog:"));
    warnSpy.mockRestore();
    if (prev == null) delete process.env.TSLOG_DISABLE_WARNINGS;
    else process.env.TSLOG_DISABLE_WARNINGS = prev;
    expect(warned).toBe(false);
  });
});
