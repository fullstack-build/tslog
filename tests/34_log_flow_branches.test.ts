import { formatTemplate } from "../src/formatTemplate.js";
import { Logger } from "../src/index.js";
import type { IMeta, IStackFrame } from "../src/interfaces.js";
import { consoleSupportsCssStyling, isBrowserEnvironment, safeGetCwd } from "../src/internal/environment.js";
import { collectErrorCauses, toError, toErrorObject } from "../src/internal/errorUtils.js";
import { buildPrettyMeta } from "../src/internal/metaFormatting.js";
import { clampIndex, findFirstExternalFrameIndex, getFrameAt, isIgnorableFrame, pickCallerStackFrame } from "../src/internal/stackTrace.js";

const globalAny = globalThis as Record<string, unknown>;

function hiddenLogger(settings: Record<string, unknown> = {}) {
  const transports: Array<Record<string, unknown>> = [];
  const logger = new Logger<Record<string, unknown>>({ type: "hidden", ...settings });
  logger.attachTransport((o) => transports.push(o as Record<string, unknown>));
  return { logger, transports };
}

describe("_toLogObj branches", () => {
  test("single string arg is stored under index 0", () => {
    const { logger, transports } = hiddenLogger();
    logger.info("the string");
    expect(transports[0]["0"]).toBe("the string");
  });

  test("single plain object arg is spread into the logObj", () => {
    const { logger, transports } = hiddenLogger();
    logger.info({ user: "alice", id: 42 });
    expect(transports[0].user).toBe("alice");
    expect(transports[0].id).toBe(42);
    expect(transports[0]["0"]).toBeUndefined();
  });

  test("single Date arg is kept under index 0 and not spread", () => {
    const { logger, transports } = hiddenLogger();
    const date = new Date("2020-01-02T03:04:05.000Z");
    logger.info(date);
    expect(transports[0]["0"]).toBeInstanceOf(Date);
    expect((transports[0]["0"] as Date).getTime()).toBe(date.getTime());
  });

  test("single Buffer arg is kept under index 0 and not spread", () => {
    const { logger, transports } = hiddenLogger();
    const buffer = Buffer.from("hello");
    logger.info(buffer);
    expect(Buffer.isBuffer(transports[0]["0"])).toBe(true);
    expect((transports[0]["0"] as Buffer).toString()).toBe("hello");
  });

  test("multiple args are spread under numeric indices", () => {
    const { logger, transports } = hiddenLogger();
    logger.info("a", "b", "c");
    expect(transports[0]["0"]).toBe("a");
    expect(transports[0]["1"]).toBe("b");
    expect(transports[0]["2"]).toBe("c");
  });

  test("argumentsArrayName places args under a named array property", () => {
    const { logger, transports } = hiddenLogger({ argumentsArrayName: "argv" });
    logger.info("x", "y");
    expect(Array.isArray(transports[0].argv)).toBe(true);
    expect(transports[0].argv).toEqual(["x", "y"]);
    expect(transports[0]["0"]).toBeUndefined();
  });
});

describe("_toErrorObject cause handling", () => {
  test("string cause is normalized to a native Error", () => {
    const { logger, transports } = hiddenLogger();
    const error = new Error("outer");
    (error as Error & { cause?: unknown }).cause = "the underlying reason";
    logger.error(error);

    const logObj = transports[0] as { cause?: { nativeError?: Error; message?: string } };
    expect(logObj.cause).toBeDefined();
    expect(logObj.cause?.nativeError).toBeInstanceOf(Error);
    expect(logObj.cause?.message).toBe("the underlying reason");
  });

  test("Error cause is preserved as the same native error instance", () => {
    const { logger, transports } = hiddenLogger();
    const inner = new Error("inner");
    const outer = new Error("outer");
    (outer as Error & { cause?: unknown }).cause = inner;
    logger.error(outer);

    const logObj = transports[0] as { cause?: { nativeError?: Error; message?: string } };
    expect(logObj.cause?.nativeError).toBe(inner);
    expect(logObj.cause?.message).toBe("inner");
  });

  test("self-referential cause does not infinite loop", () => {
    const { logger, transports } = hiddenLogger();
    const error = new Error("loop");
    (error as Error & { cause?: unknown }).cause = error;
    expect(() => logger.error(error)).not.toThrow();

    const logObj = transports[0] as { cause?: unknown; message?: string };
    expect(logObj.message).toBe("loop");
    // the error is already in the seen-set, so its own cause is not re-expanded
    expect(logObj.cause).toBeUndefined();
  });

  test("a deep cause chain is capped at depth 5", () => {
    const { logger, transports } = hiddenLogger();
    const errors = Array.from({ length: 7 }, (_, i) => new Error(`e${i}`));
    for (let i = 0; i < errors.length - 1; i += 1) {
      (errors[i] as Error & { cause?: unknown }).cause = errors[i + 1];
    }
    logger.error(errors[0]);

    let node = transports[0] as { cause?: { cause?: unknown; message?: string } } | undefined;
    let depth = 0;
    while (node?.cause != null) {
      node = node.cause as { cause?: { cause?: unknown; message?: string } };
      depth += 1;
    }
    // root + 5 nested causes, deepest cause's own cause is left undefined
    expect(depth).toBe(5);
  });
});

// The v4 `overwrite.transportFormatted` hook (and its arity-sniffing of the formatted-meta string, the
// pretty args, the errors, the resolved logMeta, and the active settings) was removed in M2.6. The
// replacement capability is a custom `Transport.write(record, line)` plus a per-transport `format`:
// the transport receives the finished record AND the already-formatted line, and chooses its own format
// independently of the logger-wide `type`. The bits the old 4-/5-arg overloads exposed (the resolved
// meta and active settings) are reachable directly off `record[_meta]` and `logger.settings`.
describe("custom transport receives (record, line)", () => {
  test("a custom transport's write receives the finished record and the formatted pretty line", () => {
    let record: (Record<string, unknown> & { _meta?: { logLevelName?: string } }) | undefined;
    let line: string | undefined;
    const logger = new Logger({ type: "pretty", name: "PrettyT" });
    logger.attachTransport({
      format: "pretty",
      write(rec, formattedLine) {
        record = rec as typeof record;
        line = formattedLine;
      },
    });
    logger.info("x");
    expect(record).toBeDefined();
    expect(record?._meta?.logLevelName).toBe("INFO");
    // the line is the rendered pretty string for this record (carries the level name and the message)
    expect(typeof line).toBe("string");
    expect(line).toContain("INFO");
    expect(line).toContain("x");
  });

  test('per-transport format: "json" yields the flat fields-first JSON line regardless of the logger type', () => {
    let line: string | undefined;
    // logger is "pretty" yet this sink asks for json, so it receives the flat JSON line
    const logger = new Logger({ type: "pretty", name: "JsonT", minLevel: 2 });
    logger.attachTransport({
      format: "json",
      write(_rec, formattedLine) {
        line = formattedLine;
      },
    });
    logger.info("hello");
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string) as { message?: string; level?: string; levelId?: number; _meta?: { v?: number; name?: string } };
    expect(parsed.message).toBe("hello");
    expect(parsed.level).toBe("INFO");
    expect(parsed.levelId).toBe(3);
    expect(parsed._meta?.v).toBe(5);
    expect(parsed._meta?.name).toBe("JsonT");
  });

  test("per-transport format: a custom LogFormatter is used to build the line", () => {
    let line: string | undefined;
    const logger = new Logger({ type: "pretty" });
    logger.attachTransport({
      // a LogFormatter receives (record, settings) and returns the line the transport's write() gets
      format: (record, settings) => `${(record[settings.meta.property] as { logLevelName: string }).logLevelName}|${(record as Record<string, unknown>)["0"]}`,
      write(_rec, formattedLine) {
        line = formattedLine;
      },
    });
    logger.info("payload");
    expect(line).toBe("INFO|payload");
  });
});

describe("middleware replaces overwrite.addMeta", () => {
  test("a middleware can stash fields that surface on record._meta", () => {
    const { logger, transports } = hiddenLogger();
    logger.use((ctx) => {
      ctx.meta.traceId = "trace-abc";
      return ctx;
    });
    logger.info("x");
    const meta = transports[0]._meta as { traceId?: string; logLevelName?: string } | undefined;
    expect(meta?.traceId).toBe("trace-abc");
    expect(meta?.logLevelName).toBe("INFO");
  });

  test("a middleware can drop a log by returning null (no record, no transport call)", () => {
    const { logger, transports } = hiddenLogger({ minLevel: 0 });
    logger.use((ctx) => (ctx.logLevelId < 4 ? null : ctx));
    const dropped = logger.info("below warn");
    const kept = logger.warn("at warn");
    expect(dropped).toBeUndefined();
    expect(kept).toBeDefined();
    expect(transports).toHaveLength(1);
    expect(transports[0]["0"]).toBe("at warn");
  });
});

describe("transport contract (attach/detach + normalization)", () => {
  test("attachTransport normalizes a bare function into a Transport object with a write method", () => {
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(() => {});
    const stored = logger.settings.attachedTransports[0];
    expect(typeof stored).toBe("object");
    expect(typeof stored.write).toBe("function");
  });

  test("attachTransport returns a detach function that removes the transport", () => {
    const logger = new Logger({ type: "hidden" });
    let calls = 0;
    const detach = logger.attachTransport(() => {
      calls += 1;
    });
    expect(typeof detach).toBe("function");
    logger.info("first");
    detach();
    logger.info("second");
    expect(calls).toBe(1);
    expect(logger.settings.attachedTransports).toHaveLength(0);
    // detaching again is a no-op
    expect(() => detach()).not.toThrow();
  });
});

describe("formatTemplate", () => {
  function baseSettings(overrides: Record<string, unknown> = {}) {
    const logger = new Logger({ type: "pretty", ...overrides });
    return (logger as unknown as { settings: Record<string, unknown> }).settings as Parameters<typeof formatTemplate>[0];
  }

  test("missing placeholder keeps the literal token when hideUnsetPlaceholder is false", () => {
    const settings = baseSettings({ pretty: { style: false } });
    const result = formatTemplate(settings, "value: {{missing}}", {}, false);
    expect(result).toBe("value: {{missing}}");
  });

  test("missing placeholder becomes empty when hideUnsetPlaceholder is true", () => {
    const settings = baseSettings({ pretty: { style: false } });
    const result = formatTemplate(settings, "value: {{missing}}", {}, true);
    expect(result).toBe("value: ");
  });

  test("stylePrettyLogs false produces no ANSI escapes", () => {
    const settings = baseSettings({ pretty: { style: false } });
    const result = formatTemplate(settings, "{{logLevelName}}", { logLevelName: "INFO" });
    expect(result).toBe("INFO");
    expect(result).not.toContain("\u001b");
  });

  test("stylePrettyLogs true wraps the value in ANSI escapes", () => {
    const settings = baseSettings({ pretty: { style: true } });
    const result = formatTemplate(settings, "{{logLevelName}}", { logLevelName: "INFO" });
    expect(result).toContain("\u001b");
    expect(result).toContain("INFO");
  });
});

describe("Logger constructor browser branch", () => {
  let saved: Record<string, unknown>;
  beforeEach(() => {
    saved = {
      window: globalAny.window,
      document: globalAny.document,
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["window", "document"]) {
      if (saved[k] === undefined) delete globalAny[k];
      else globalAny[k] = saved[k];
    }
  });

  test("defaults stylePrettyLogs to true in a browser environment", () => {
    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent: "Mozilla" });
    const logger = new Logger();
    const settings = (logger as unknown as { settings: { pretty: { style: boolean } } }).settings;
    expect(settings.pretty.style).toBe(true);
  });

  test("respects an explicit stylePrettyLogs false in a browser environment", () => {
    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent: "Mozilla" });
    const logger = new Logger({ pretty: { style: false } });
    const settings = (logger as unknown as { settings: { pretty: { style: boolean } } }).settings;
    expect(settings.pretty.style).toBe(false);
  });
});

describe("environment.safeGetCwd", () => {
  let savedProcess: unknown;
  let savedDeno: unknown;
  beforeEach(() => {
    savedProcess = globalAny.process;
    savedDeno = globalAny.Deno;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedProcess === undefined) delete globalAny.process;
    else globalAny.process = savedProcess;
    if (savedDeno === undefined) delete globalAny.Deno;
    else globalAny.Deno = savedDeno;
  });

  test("falls back to Deno.cwd when process.cwd is absent", () => {
    globalAny.process = {};
    globalAny.Deno = { cwd: () => "/deno/cwd" };
    expect(safeGetCwd()).toBe("/deno/cwd");
  });
});

describe("environment.consoleSupportsCssStyling", () => {
  let saved: Record<string, unknown>;
  beforeEach(() => {
    saved = {
      window: globalAny.window,
      document: globalAny.document,
      CSS: globalAny.CSS,
    };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["window", "document", "CSS"]) {
      if (saved[k] === undefined) delete globalAny[k];
      else globalAny[k] = saved[k];
    }
  });

  function makeBrowser(userAgent: string) {
    globalAny.window = {};
    globalAny.document = {};
    vi.stubGlobal("navigator", { userAgent });
  }

  test("returns false outside of a browser environment", () => {
    expect(consoleSupportsCssStyling()).toBe(false);
  });

  test("returns true for firefox", () => {
    makeBrowser("Mozilla/5.0 Firefox/120.0");
    delete globalAny.CSS;
    expect(consoleSupportsCssStyling()).toBe(true);
  });

  test("returns true when CSS.supports reports support", () => {
    makeBrowser("Mozilla/5.0 SomeChrome/1.0 Chrome/1.0");
    globalAny.CSS = { supports: () => true };
    expect(consoleSupportsCssStyling()).toBe(true);
  });

  test("returns true for safari without chrome", () => {
    makeBrowser("Mozilla/5.0 (Macintosh) Version/16.0 Safari/605.1.15");
    globalAny.CSS = { supports: () => false };
    expect(consoleSupportsCssStyling()).toBe(true);
  });

  test("returns false for a safari+chrome user agent without CSS support", () => {
    makeBrowser("Mozilla/5.0 Chrome/120.0 Safari/537.36");
    globalAny.CSS = { supports: () => false };
    expect(consoleSupportsCssStyling()).toBe(false);
  });
});

describe("environment.isBrowserEnvironment", () => {
  let saved: Record<string, unknown>;
  beforeEach(() => {
    saved = { window: globalAny.window, document: globalAny.document };
  });
  afterEach(() => {
    for (const k of ["window", "document"]) {
      if (saved[k] === undefined) delete globalAny[k];
      else globalAny[k] = saved[k];
    }
  });

  test("is true when window and document exist", () => {
    globalAny.window = {};
    globalAny.document = {};
    expect(isBrowserEnvironment()).toBe(true);
  });

  test("is false when window and document are absent", () => {
    delete globalAny.window;
    delete globalAny.document;
    expect(isBrowserEnvironment()).toBe(false);
  });
});

describe("errorUtils", () => {
  const parseLine = (_line: string): IStackFrame | undefined => undefined;

  test("toErrorObject falls back to default name and empty message", () => {
    const error = new Error("ignored");
    Object.defineProperty(error, "name", { value: undefined });
    Object.defineProperty(error, "message", { value: undefined });
    const result = toErrorObject(error, parseLine);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("");
    expect(result.nativeError).toBe(error);
  });

  test("toError wraps a string into an Error with that message", () => {
    const error = toError("boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
  });

  test("toError copies own properties of an object via Object.assign", () => {
    const error = toError({ code: "E_FAIL", detail: 7 });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe("E_FAIL");
    expect((error as Error & { detail?: number }).detail).toBe(7);
  });

  test("collectErrorCauses caps a deep chain at 5", () => {
    const errors = Array.from({ length: 7 }, (_, i) => new Error(`e${i}`));
    for (let i = 0; i < errors.length - 1; i += 1) {
      (errors[i] as Error & { cause?: unknown }).cause = errors[i + 1];
    }
    const causes = collectErrorCauses(errors[0]);
    expect(causes.length).toBe(5);
    expect(causes[0]).toBe(errors[1]);
    expect(causes[4]).toBe(errors[5]);
  });

  test("collectErrorCauses breaks on a cyclic cause", () => {
    const a = new Error("a");
    const b = new Error("b");
    (a as Error & { cause?: unknown }).cause = b;
    (b as Error & { cause?: unknown }).cause = a;
    const causes = collectErrorCauses(a);
    // b is collected, then a is already visited and the loop breaks
    expect(causes).toEqual([b, a]);
  });
});

describe("metaFormatting.buildPrettyMeta", () => {
  function settingsWithTemplate(template: string, prettyOverrides: Record<string, unknown> = {}) {
    const logger = new Logger({ type: "pretty", pretty: { template, ...prettyOverrides } });
    return (logger as unknown as { settings: Parameters<typeof buildPrettyMeta>[0] }).settings;
  }

  function makeMeta(extra: Partial<IMeta> = {}): IMeta {
    return {
      runtime: "Nodejs",
      hostname: "host",
      date: new Date("2021-03-04T05:06:07.008Z"),
      logLevelId: 3,
      logLevelName: "INFO",
      path: undefined,
      ...extra,
    } as unknown as IMeta;
  }

  test("local timezone uses local date getters with individual placeholders", () => {
    const settings = settingsWithTemplate("{{yyyy}}.{{mm}}", { timeZone: "local", style: false });
    const meta = makeMeta();
    const result = buildPrettyMeta(settings, meta);
    expect(result.placeholders.yyyy).toBe(meta.date?.getFullYear());
    expect(String(result.text)).toMatch(/^\d{4}\./);
  });

  test("UTC timezone uses UTC date getters with individual placeholders", () => {
    const settings = settingsWithTemplate("{{yyyy}}.{{mm}}", { timeZone: "UTC", style: false });
    const meta = makeMeta();
    const result = buildPrettyMeta(settings, meta);
    expect(result.placeholders.yyyy).toBe(meta.date?.getUTCFullYear());
    expect(result.text).toBe("2021.03");
  });

  test("missing meta.date yields the ---- year placeholder", () => {
    const settings = settingsWithTemplate("{{yyyy}}", { timeZone: "UTC", style: false });
    const meta = makeMeta({ date: undefined });
    const result = buildPrettyMeta(settings, meta);
    expect(result.placeholders.yyyy).toBe("----");
    expect(result.text).toBe("----");
  });

  test("parentNames and name combine with the separator", () => {
    const settings = settingsWithTemplate("{{name}}", { style: false });
    settings.parentNames = ["A", "B"];
    const meta = makeMeta({ name: "C" });
    const result = buildPrettyMeta(settings, meta);
    expect(result.text).toContain("A:B:C");
  });
});

describe("stackTrace helpers", () => {
  test("findFirstExternalFrameIndex skips frames matched via fullFilePath", () => {
    const frames: IStackFrame[] = [
      { filePath: "", fullFilePath: "/abs/tslog/src/BaseLogger.ts" },
      { filePath: "", fullFilePath: "/abs/app/main.ts" },
    ];
    expect(findFirstExternalFrameIndex(frames)).toBe(1);
  });

  test("isIgnorableFrame matches on filePath only and on fullFilePath only", () => {
    const patterns = [/ignore-me/i];
    expect(isIgnorableFrame({ filePath: "ignore-me/file.ts" }, patterns)).toBe(true);
    expect(isIgnorableFrame({ fullFilePath: "/abs/ignore-me/file.ts" }, patterns)).toBe(true);
    expect(isIgnorableFrame({ filePath: "other/file.ts" }, patterns)).toBe(false);
  });

  test("pickCallerStackFrame honors an explicit stackDepthLevel", () => {
    const parseLine = (line: string): IStackFrame | undefined => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return undefined;
      return { filePath: trimmed };
    };
    const error = new Error("synthetic");
    error.stack = ["Error: synthetic", "frame-a", "frame-b", "frame-c"].join("\n");
    const frame = pickCallerStackFrame(error, parseLine, { stackDepthLevel: 1 });
    expect(frame?.filePath).toBe("frame-b");
  });

  test("clampIndex clamps below zero and above the max", () => {
    expect(clampIndex(-5, 3)).toBe(0);
    expect(clampIndex(10, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });

  test("getFrameAt returns undefined for out-of-range indices", () => {
    const frames: IStackFrame[] = [{ filePath: "a" }, { filePath: "b" }];
    expect(getFrameAt(frames, -1)).toBeUndefined();
    expect(getFrameAt(frames, 2)).toBeUndefined();
    expect(getFrameAt(frames, 1)?.filePath).toBe("b");
  });
});
