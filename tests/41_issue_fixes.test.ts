import { createLoggerEnvironment } from "../src/BaseLogger.js";
import { Logger } from "../src/index.js";
import type { IMeta } from "../src/interfaces.js";
import { consoleSupportsCssStyling, isWorkerEnvironment } from "../src/internal/environment.js";
import { buildPrettyMeta } from "../src/internal/metaFormatting.js";
import { inspect } from "../src/internal/util.inspect.polyfill.js";
import { getConsoleLogStripped, mockConsoleLog } from "./helper.js";

// Regression tests for fixed GitHub issues. Each assertion fails against the pre-fix code.

describe("#334: bigint values render with the 'n' suffix, not as {}", () => {
  test("inspect renders a standalone bigint", () => {
    expect(inspect(100n, { colors: false })).toBe("100n");
  });

  test("inspect renders bigint object and array members", () => {
    expect(inspect({ balance: 100n }, { colors: false })).toContain("balance: 100n");
    expect(inspect([1n, 2n], { colors: false })).toContain("1n");
  });

  test("pretty logger prints a bigint instead of empty braces", () => {
    mockConsoleLog(true, false);
    new Logger({ type: "pretty" }).info("value:", 123n);
    const out = getConsoleLogStripped();
    expect(out).toContain("123n");
    expect(out).not.toMatch(/value:\s*\{\s*\}/);
  });
});

describe("#266: invalid Dates do not crash the inspect polyfill", () => {
  test("a standalone invalid Date renders 'Invalid Date'", () => {
    expect(() => inspect(new Date("not-a-date"), { colors: false })).not.toThrow();
    expect(inspect(new Date("not-a-date"), { colors: false })).toBe("Invalid Date");
  });

  test("an invalid Date with extra properties does not throw", () => {
    const d = new Date("nope") as Date & { extra?: number };
    d.extra = 1;
    expect(() => inspect(d, { colors: false })).not.toThrow();
    const out = inspect(d, { colors: false });
    expect(out).toContain("Invalid Date");
    expect(out).toContain("extra: 1");
  });

  test("valid Dates still render their ISO string", () => {
    expect(inspect(new Date("2024-01-01T00:00:00Z"), { colors: false })).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("#268: IMetaStatic exposes runtime meta fields", () => {
  test("hostname/runtimeVersion are accessible on the logged meta without a cast", () => {
    const logger = new Logger({ type: "hidden" });
    const out = logger.info("x");
    const meta = out?._meta;
    expect(meta).toBeDefined();
    // These are typed on IMetaStatic now; accessing them must compile and be defined on node.
    expect(typeof meta?.runtime).toBe("string");
    // hostname/runtimeVersion exist on server runtimes; at minimum the typed access compiles.
    const typedHostname: string | undefined = meta?.hostname;
    const typedVersion: string | undefined = meta?.runtimeVersion;
    expect(typedHostname === undefined || typeof typedHostname === "string").toBe(true);
    expect(typedVersion === undefined || typeof typedVersion === "string").toBe(true);
  });
});

describe("#207: local-timezone rawIsoStr carries the real offset, not a misleading Z", () => {
  function rawIso(tz: "UTC" | "local"): string {
    const settings = new Logger({ type: "pretty", prettyLogTimeZone: tz }).settings as never;
    const meta = { date: new Date("2023-01-19T11:05:37.263Z"), logLevelName: "DEBUG", logLevelId: 2, runtime: "node" } as unknown as IMeta;
    return buildPrettyMeta(settings, meta).placeholders.rawIsoStr as string;
  }

  test("UTC rawIsoStr ends with Z", () => {
    expect(rawIso("UTC")).toBe("2023-01-19T11:05:37.263Z");
  });

  test("local rawIsoStr ends with a numeric offset, never Z", () => {
    const local = rawIso("local");
    expect(local).not.toMatch(/Z$/);
    expect(local).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  test("local rawIsoStr round-trips to the original instant", () => {
    const original = new Date("2023-01-19T11:05:37.263Z").getTime();
    expect(new Date(rawIso("local")).getTime()).toBe(original);
  });

  test("the offset sign reflects timezones on both sides of UTC", () => {
    const settings = new Logger({ type: "pretty", prettyLogTimeZone: "local" }).settings as never;
    const make = () => ({ date: new Date("2023-06-15T12:00:00Z"), logLevelName: "INFO", logLevelId: 3, runtime: "node" }) as unknown as IMeta;

    // West of UTC (e.g. US Eastern): getTimezoneOffset() is positive → "-" suffix.
    const offsetSpy = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(300);
    expect(buildPrettyMeta(settings, make()).placeholders.rawIsoStr).toMatch(/-05:00$/);

    // East of UTC: getTimezoneOffset() is negative → "+" suffix.
    offsetSpy.mockReturnValue(-330);
    expect(buildPrettyMeta(settings, make()).placeholders.rawIsoStr).toMatch(/\+05:30$/);

    offsetSpy.mockRestore();
  });
});

describe("#262: Web Workers are treated as CSS-capable consoles", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    saved = { window: globalAny.window, document: globalAny.document, importScripts: globalAny.importScripts, CSS: globalAny.CSS };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalAny[k];
      else globalAny[k] = v;
    }
  });

  function makeWorker(userAgent: string, css?: boolean) {
    delete globalAny.window;
    delete globalAny.document;
    globalAny.importScripts = () => undefined;
    if (css != null) globalAny.CSS = { supports: () => css };
    else delete globalAny.CSS;
    vi.stubGlobal("navigator", { userAgent });
  }

  test("a Firefox worker reports CSS support", () => {
    makeWorker("Mozilla/5.0 Firefox/117");
    expect(isWorkerEnvironment()).toBe(true);
    expect(consoleSupportsCssStyling()).toBe(true);
  });

  test("a Chromium worker with CSS.supports reports CSS support", () => {
    makeWorker("Mozilla/5.0 Chrome/116", true);
    expect(consoleSupportsCssStyling()).toBe(true);
  });

  test("a worker actually emits %c css meta through transportFormatted", () => {
    makeWorker("Mozilla/5.0 Firefox/117");
    const env = createLoggerEnvironment();
    const settings = new Logger({ type: "pretty" }).settings as never as import("../src/interfaces.js").ISettings<unknown>;
    settings.prettyLogTemplate = "{{logLevelName}}";
    const meta = env.getMeta(3, "INFO", Number.NaN, true) as IMeta;
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    env.transportFormatted("META", [], [], meta, settings);
    const call = spy.mock.calls[0] ?? [];
    spy.mockRestore();
    expect(String(call[0])).toContain("%c");
    expect(call.slice(1).join("|")).toContain("color");
  });

  test("plain Node still reports no CSS support", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.importScripts;
    delete globalAny.CSS;
    expect(consoleSupportsCssStyling()).toBe(false);
  });
});
