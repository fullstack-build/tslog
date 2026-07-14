import { afterEach, describe, expect, test, vi } from "vitest";
import { Logger } from "../src";
import type { IErrorObject, IMeta } from "../src/interfaces";
import { pinoFormat, pinoTransport, toPinoError, toPinoLevel } from "../src/subpaths/presets/pino";

/**
 * Pino preset (`tslog/presets/pino`): a LogFormatter producing pino-shaped NDJSON plus a transport helper.
 * Covers the documented tslog 0-6 → pino 10-60 level mapping and the emitted record shape.
 */
describe("presets/pino", () => {
  test("toPinoLevel maps the canonical seven tslog levels", () => {
    expect(toPinoLevel(0)).toBe(10); // SILLY -> trace
    expect(toPinoLevel(1)).toBe(10); // TRACE -> trace
    expect(toPinoLevel(2)).toBe(20); // DEBUG
    expect(toPinoLevel(3)).toBe(30); // INFO
    expect(toPinoLevel(4)).toBe(40); // WARN
    expect(toPinoLevel(5)).toBe(50); // ERROR
    expect(toPinoLevel(6)).toBe(60); // FATAL
  });

  test("toPinoLevel snaps unknown/custom level ids to the nearest pino bucket, clamped to 10..60", () => {
    expect(toPinoLevel(7)).toBe(60); // above FATAL -> clamp to 60
    expect(toPinoLevel(100)).toBe(60);
    expect(toPinoLevel(-5)).toBe(10); // below floor -> clamp to 10
  });

  function capture(opts?: Parameters<typeof pinoTransport>[1]) {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(pinoTransport((line) => lines.push(line), opts));
    return { logger, lines };
  }

  test("emits a pino-shaped line: numeric level, epoch-ms time, msg, top-level fields", () => {
    const { logger, lines } = capture();
    logger.info({ userId: 42 }, "user logged in");

    expect(lines).toHaveLength(1);
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(obj.level).toBe(30);
    expect(typeof obj.time).toBe("number");
    expect(obj.time).toBeGreaterThan(0);
    expect(obj.msg).toBe("user logged in");
    expect(obj.userId).toBe(42);
    // pino does not nest tslog's _logMeta block, level name, or levelId.
    expect(obj._logMeta).toBeUndefined();
    expect(obj.levelId).toBeUndefined();
  });

  test("includes pid by default and hostname when present in meta", () => {
    const { logger, lines } = capture();
    logger.warn("careful");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(obj.level).toBe(40);
    // Node runtime: pid is a number, hostname is a string.
    expect(typeof obj.pid).toBe("number");
    expect(typeof obj.hostname).toBe("string");
  });

  test("pid can be disabled", () => {
    const { logger, lines } = capture({ pid: false });
    logger.info("no pid here");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.pid).toBeUndefined();
  });

  test("time: 'iso' emits an ISO-8601 string", () => {
    const { logger, lines } = capture({ time: "iso" });
    logger.info("iso time");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(typeof obj.time).toBe("string");
    expect(() => new Date(obj.time as string).toISOString()).not.toThrow();
    expect(new Date(obj.time as string).toISOString()).toBe(obj.time);
  });

  test("a bare string message lands under msg", () => {
    const { logger, lines } = capture();
    logger.debug("hello");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.level).toBe(20);
    expect(obj.msg).toBe("hello");
  });

  test("errors are serialized under err in pino's shape: type + raw stack STRING, cause chain recursed", () => {
    const { logger, lines } = capture();
    const err = new TypeError("boom", { cause: new Error("root cause") });
    (err as unknown as Record<string, unknown>).code = "E_BOOM";
    logger.error("request failed", err);
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;

    expect(obj.level).toBe(50);
    expect(obj.msg).toBe("request failed");
    const serialized = obj.err as Record<string, unknown>;
    expect(serialized).toBeTruthy();
    // pino's err-serializer wire shape: `type` (class name), `message`, `stack` as the raw multi-line
    // STRING pino-pretty and error trackers parse — NOT tslog's parsed frame array.
    expect(serialized.type).toBe("TypeError");
    expect(serialized.message).toBe("boom");
    expect(typeof serialized.stack).toBe("string");
    expect(serialized.stack as string).toContain("TypeError: boom");
    expect(serialized.stack as string).toContain("    at ");
    // extra enumerable own props ride along, like pino's serializer
    expect(serialized.code).toBe("E_BOOM");
    const cause = serialized.cause as Record<string, unknown>;
    expect(cause.type).toBe("Error");
    expect(cause.message).toBe("root cause");
    expect(typeof cause.stack).toBe("string");
    // native Error handle is stripped, not serialized as {}.
    expect(serialized.nativeError).toBeUndefined();
  });

  test("errorShape: 'tslog' keeps the structured frame-array shape", () => {
    const { logger, lines } = capture({ errorShape: "tslog" });
    logger.error("request failed", new Error("boom"));
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const serialized = obj.err as Record<string, unknown>;
    expect(serialized.name).toBe("Error");
    expect(Array.isArray(serialized.stack)).toBe(true);
    expect(serialized.type).toBeUndefined();
  });

  test("custom messageKey/errorKey are honored", () => {
    const { logger, lines } = capture({ messageKey: "message", errorKey: "error" });
    logger.info("renamed");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.message).toBe("renamed");
    expect(obj.msg).toBeUndefined();
  });

  test("pinoFormat can be used directly as a transport format", () => {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport({
      format: pinoFormat(),
      write: (_record, line) => {
        lines.push(line);
      },
    });
    logger.fatal({ code: "E_FATAL" }, "down");
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.level).toBe(60);
    expect(obj.msg).toBe("down");
    expect(obj.code).toBe("E_FATAL");
  });

  test("circular user fields do not throw", () => {
    const { logger, lines } = capture();
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(() => logger.info(circular)).not.toThrow();
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.name).toBe("loop");
    // The circular back-reference is replaced with the "[Circular]" marker somewhere in the chain,
    // so the line is valid JSON and round-trips without throwing.
    expect(JSON.stringify(obj)).toContain("[Circular]");
  });
});

describe("presets/pino hand-built error-likes (review fixes)", () => {
  function capture(opts?: Parameters<typeof pinoTransport>[1]) {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(pinoTransport((line) => lines.push(line), opts));
    return { logger, lines };
  }

  test("a non-error cause on a hand-built error-like passes through verbatim instead of crashing", () => {
    const { logger, lines } = capture();
    expect(() => logger.error("hand-built", { nativeError: new Error("real"), name: "E", message: "m", stack: [], cause: "just a string" })).not.toThrow();
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const serialized = obj.err as Record<string, unknown>;
    expect(serialized.message).toBe("m");
    expect(serialized.cause).toBe("just a string");
  });

  test("a non-array stack on a nested error-like is treated as absent", () => {
    const { logger, lines } = capture();
    const errorLike = {
      nativeError: new Error("real"),
      name: "E",
      message: "m",
      stack: [],
      cause: { nativeError: new Error("inner"), name: "Inner", message: "im", stack: "bogus" },
    };
    expect(() => logger.error("nested", errorLike)).not.toThrow();
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const cause = (obj.err as Record<string, unknown>).cause as Record<string, unknown>;
    expect(cause.message).toBe("im");
    // the native handle's real stack string is still preferred, so a stack IS present here
    expect(typeof cause.stack).toBe("string");
  });
});

/** Build a serialized-tslog {@link IErrorObject} with the given native handle + parsed frames. */
function makeErrorObject(overrides: Partial<IErrorObject> & { nativeError?: unknown } = {}): IErrorObject {
  return {
    nativeError: new Error("real"),
    name: "E",
    message: "m",
    stack: [{ method: "fn", filePath: "/a.js", fileLine: "1", fileColumn: "2" }],
    ...overrides,
  } as IErrorObject;
}

describe("presets/pino toPinoError (error re-shaping edge cases)", () => {
  test("keeps the serialized name when the native constructor getter throws", () => {
    const native = new Error("real");
    Object.defineProperty(native, "constructor", {
      get() {
        throw new Error("no ctor");
      },
    });
    const out = toPinoError(makeErrorObject({ nativeError: native, name: "SerName", message: "boom" }));
    // ctor lookup threw -> `type` falls back to the serialized name.
    expect(out.type).toBe("SerName");
    expect(out.message).toBe("boom");
  });

  test("rebuilds the stack STRING from parsed frames when the native handle has no string stack", () => {
    const native = new Error("x");
    native.stack = undefined;
    const out = toPinoError(
      makeErrorObject({
        nativeError: native,
        name: "Framed",
        message: "fm",
        stack: [{ method: "doIt", fullFilePath: "/x.js", fileLine: "3", fileColumn: "4" } as never, {} as never],
      }),
    );
    // header from name+message, then one frame per parsed frame, empty frame -> the <anonymous>/unknown/0 fallbacks.
    expect(out.stack).toBe("Framed: fm\n    at doIt (/x.js:3:4)\n    at <anonymous> (unknown:0:0)");
  });

  test("falls through to the frame rebuild when the native stack getter throws", () => {
    const native = new Error("x");
    Object.defineProperty(native, "stack", {
      get() {
        throw new Error("hostile stack");
      },
    });
    const out = toPinoError(makeErrorObject({ nativeError: native, name: "Hostile", message: "hm", stack: [{ method: "g" } as never] }));
    expect(out.stack).toBe("Hostile: hm\n    at g (unknown:0:0)");
  });

  test("skips the extra own-property copy when the native ownKeys trap throws", () => {
    const native = new Proxy(new Error("k"), {
      ownKeys() {
        throw new Error("no keys");
      },
    });
    const out = toPinoError(makeErrorObject({ nativeError: native, name: "E", message: "km" }));
    // type/message/stack survive; no extras copied. `type` follows the native constructor name (Error),
    // not the serialized `name`, because a nativeError is present.
    expect(out.type).toBe("Error");
    expect(out.message).toBe("km");
  });

  test("skips an extra property whose getter throws, keeping the rest", () => {
    const native = new Error("p");
    Object.defineProperty(native, "code", {
      enumerable: true,
      get() {
        throw new Error("no code");
      },
    });
    Object.defineProperty(native, "safe", { enumerable: true, value: "ok" });
    const out = toPinoError(makeErrorObject({ nativeError: native, name: "E", message: "pm" }));
    expect(out.code).toBeUndefined();
    expect(out.safe).toBe("ok");
  });

  test("a recursed serialized cause takes its type from the native constructor name (subclass -> 'Root')", () => {
    // Cause recursion and non-error-cause passthrough are covered by the pipeline tests above; the signal
    // here is that the recursed cause's `type` follows the NATIVE constructor name, not the serialized name.
    class Root extends Error {}
    const withErrorCause = toPinoError(
      makeErrorObject({ message: "outer", cause: makeErrorObject({ nativeError: new Root("root"), name: "Root", message: "root" }) }),
    );
    expect((withErrorCause.cause as { type?: string }).type).toBe("Root");
  });

  test("no native handle and an empty parsed stack yields no stack; empty name falls back to type 'Error'", () => {
    // Pins the DIRECT-EXPORT contract of toPinoError: this input cannot reach it from the pipeline
    // (toErrorObject always sets a nativeError handle and a non-empty string name), but toPinoError is a
    // public export and must stay total for hand-built error objects.
    // native absent -> the native-stack read is skipped; stack is [] -> pinoStackString returns undefined,
    // so `out.stack` stays unset. name === "" -> `type` uses the "Error" fallback (no ctor to override it).
    const out = toPinoError(makeErrorObject({ nativeError: undefined, name: "", message: "m", stack: [] }));
    expect(out.type).toBe("Error");
    expect(out.message).toBe("m");
    expect(Object.hasOwn(out, "stack")).toBe(false);
  });

  test("rebuilds a header with no colon when the message is empty", () => {
    // native absent, but parsed frames exist -> the stack STRING is rebuilt; an empty message drops the
    // ": message" suffix so the header is just the name.
    const out = toPinoError(makeErrorObject({ nativeError: undefined, name: "Bare", message: "", stack: [{ method: "g" } as never] }));
    expect(out.stack).toBe("Bare\n    at g (unknown:0:0)");
  });

  test("skips native own keys that collide with reserved fields or are the cause key", () => {
    const native = new Error("k");
    // An own enumerable key equal to a field already on the pino output (`type`) is skipped (Object.hasOwn),
    // as is an own enumerable `cause` key (the cause chain is handled separately, not copied as an extra).
    Object.defineProperty(native, "type", { enumerable: true, value: "impostor-type" });
    Object.defineProperty(native, "cause", { enumerable: true, value: "impostor-cause" });
    Object.defineProperty(native, "keep", { enumerable: true, value: "kept" });
    const out = toPinoError(makeErrorObject({ nativeError: native, name: "E", message: "km" }));
    // `type` follows the native constructor name (Error), NOT the colliding own key.
    expect(out.type).toBe("Error");
    // the own `cause` key did not leak in as an extra (no serialized cause here -> cause stays unset).
    expect(out.cause).toBeUndefined();
    expect(out.keep).toBe("kept");
  });
});

describe("presets/pino pinoFormat direct edge cases", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function settingsOf(): ISettingsShape {
    const logger = new Logger({ type: "hidden" });
    return logger.settings as unknown as ISettingsShape;
  }
  type ISettingsShape = { meta: { property: string }; json: { messageKey: string; errorKey: string; timeKey: string; levelKey: string; levelIdKey: string } };

  test("no _logMeta block: level snaps to trace(10) and no time is emitted", () => {
    const settings = settingsOf();
    const line = pinoFormat()({ 0: "hi" } as never, settings as never);
    const obj = JSON.parse(line) as Record<string, unknown>;
    // toPinoLevel(-1) snaps to the trace floor.
    expect(obj.level).toBe(10);
    expect(obj.msg).toBe("hi");
    expect(Object.hasOwn(obj, "time")).toBe(false);
  });

  test("a re-hydrated ISO-string _logMeta.date (JSON round-trip shape) is emitted verbatim", () => {
    // In-process meta.date is always a Date; the realistic non-Date shape is the ISO STRING a JSON
    // round-trip re-hydrates. pinoFormat's non-Date arm passes it through verbatim (no epoch conversion).
    const settings = settingsOf();
    const iso = "2023-11-14T22:13:20.000Z";
    const meta = { logLevelId: 3, logLevelName: "INFO", date: iso } as unknown as IMeta;
    const line = pinoFormat()({ 0: "iso", [settings.meta.property]: meta } as never, settings as never);
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(obj.time).toBe(iso);
  });

  test("safeStringify renders bigint fields as strings and undefined as [undefined]", () => {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(pinoTransport((line) => lines.push(line)));
    logger.info({ big: 10n, gone: undefined, keep: 1 });
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(obj.big).toBe("10");
    expect(obj.gone).toBe("[undefined]");
    expect(obj.keep).toBe(1);
  });

  test("multiple logged errors are reshaped element-wise into a pino error array", () => {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(pinoTransport((line) => lines.push(line)));
    logger.error("multi", new Error("a"), new TypeError("b"));
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const errs = obj.err as { type: string }[];
    expect(Array.isArray(errs)).toBe(true);
    expect(errs.map((e) => e.type)).toEqual(["Error", "TypeError"]);
  });

  test("errorShape: 'tslog' passes a multi-error array through as structured frame objects", () => {
    const lines: string[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport(pinoTransport((line) => lines.push(line), { errorShape: "tslog" }));
    logger.error("multi", new Error("a"), new Error("b"));
    const obj = JSON.parse(lines[0]) as Record<string, unknown>;
    const errs = obj.err as { name: string; stack: unknown }[];
    expect(errs).toHaveLength(2);
    expect(Array.isArray(errs[0].stack)).toBe(true);
    expect((errs[0] as { type?: string }).type).toBeUndefined();
  });

  test("a non-error value under the error key passes through unchanged", () => {
    const settings = settingsOf();
    const meta = { logLevelId: 5, logLevelName: "ERROR", date: new Date() } as unknown as IMeta;
    const record = { [settings.json.errorKey]: "not an error object", [settings.meta.property]: meta };
    const line = pinoFormat()(record as never, settings as never);
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(obj.err).toBe("not an error object");
  });

  test("pid is omitted when process.pid is not a number", () => {
    const settings = settingsOf();
    // Build the record BEFORE stubbing process so logger environment detection is unaffected.
    const logger = new Logger({ type: "hidden" });
    let record: unknown;
    logger.attachTransport((r) => {
      record = r;
    });
    logger.info("hi");

    vi.stubGlobal("process", { pid: "not-a-number" });
    const line = pinoFormat()(record as never, settings as never);
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(obj.pid).toBeUndefined();
  });
});
