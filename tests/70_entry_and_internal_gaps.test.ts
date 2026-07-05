import type { AsyncContextStore } from "../src/core/asyncContext.js";
import { createAsyncContextStore } from "../src/core/asyncContext.js";
import type { CoreFeatures } from "../src/core/features.js";
import type { EnvironmentProvider } from "../src/env/environment.js";
import { BaseLogger, createNodeEnvironment, createLogger as createNodeLogger, Logger as NodeLogger } from "../src/index.node.js";
import { createLogger as createUniversalLogger, Logger as UniversalLogger } from "../src/index.universal.js";
import type { IMeta, ISettings } from "../src/interfaces.js";
import { consoleSupportsCssStyling, resolveDefaultType, safeGetCwd } from "../src/internal/environment.js";
import { collectErrorCauses, toError } from "../src/internal/errorUtils.js";
import { buildPrettyMeta } from "../src/internal/metaFormatting.js";
import { NATIVE_CONSOLE_KEY, nativeConsoleMethod } from "../src/internal/nativeConsole.js";
import { renderJsonUnplanned } from "../src/render/json.js";
import { LiteLogger } from "../src/subpaths/lite.js";

// Node-only gate: subprocess/env tricks that Bun's process shim doesn't fully mirror. The internal
// helper tests are runtime-agnostic and run everywhere.
const isNode = typeof process !== "undefined" && process.versions?.node != null && (process.versions as Record<string, string | undefined>).bun == null;

/* ------------------------------------------------------------------------------------------------ */
/* BaseLogger: FALLBACK_FEATURES + IDENTITY_MASKING (direct construction, no injected feature set)    */
/* ------------------------------------------------------------------------------------------------ */

describe("BaseLogger without an injected feature set", () => {
  const env = createNodeEnvironment();

  test("undefined settings pass validation (FALLBACK validateSettings early return)", () => {
    // settings == null → the validator returns immediately; a hidden logger with no mask constructs fine.
    expect(() => new BaseLogger(undefined, undefined, env)).not.toThrow();
  });

  test("a censor-only mask group is still rejected (masksSomething via mask.censor)", () => {
    // Only `censor` is set (no keys/regex/paths) — the OR chain's last term must flag it.
    expect(() => new BaseLogger({ type: "hidden", mask: { censor: "hash" } }, undefined, env)).toThrow(/plaintext/);
  });

  test("pretty.enabled === true is rejected even when type is not 'pretty'", () => {
    expect(() => new BaseLogger({ type: "hidden", pretty: { enabled: true } }, undefined, env)).toThrow(/pretty/);
  });

  test("a lone URL argument expands to a plain object via IDENTITY_MASKING even without a masking engine", () => {
    const logger = new BaseLogger<Record<string, unknown>>({ type: "hidden" }, undefined, env);
    const record = logger.log(3, "INFO", new URL("https://example.com/p?x=1")) as Record<string, unknown>;
    // A single URL is spread flat onto the record (urlToObject fields at the top level).
    expect(record?.href).toBe("https://example.com/p?x=1");
    expect(record?.protocol).toBe("https:");
    expect(record?.pathname).toBe("/p");
  });

  test("non-URL args pass through IDENTITY_MASKING untouched", () => {
    const logger = new BaseLogger<Record<string, unknown>>({ type: "hidden" }, undefined, env);
    const record = logger.log(3, "INFO", "plain", { a: 1 }) as Record<string, unknown>;
    expect(record?.["0"]).toBe("plain");
    expect(record?.["1"]).toEqual({ a: 1 });
  });

  test("a URL alongside a non-URL arg: only the URL is expanded, others pass through (map ternary both sides)", () => {
    const logger = new BaseLogger<Record<string, unknown>>({ type: "hidden" }, undefined, env);
    const record = logger.log(3, "INFO", new URL("https://example.com/a"), "plain-tail") as Record<string, unknown>;
    // arg[0] (URL) is converted via urlToObject; arg[1] hits the ternary's pass-through branch.
    expect((record?.["0"] as Record<string, unknown>)?.href).toBe("https://example.com/a");
    expect(record?.["1"]).toBe("plain-tail");
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* BaseLogger: pretty path with a features set that omits buildPrettyMetaText (branch 365 fallback)   */
/* ------------------------------------------------------------------------------------------------ */

describe("BaseLogger pretty path when features has no buildPrettyMetaText", () => {
  test("the live pretty console renders with an empty meta prefix (?? '' fallback)", () => {
    // A features set that ALLOWS pretty (no validateSettings rejection) but omits buildPrettyMetaText,
    // so BaseLogger falls back to "" for the meta markup on the live pretty path.
    const featuresNoMeta: CoreFeatures = {
      renderJson: renderJsonUnplanned,
      // validateSettings omitted → pretty is not rejected.
    };
    const logger = new BaseLogger<Record<string, unknown>>(
      { type: "pretty", stack: { capture: "off" } },
      undefined,
      createNodeEnvironment(),
      Number.NaN,
      featuresNoMeta,
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(() => logger.log(3, "INFO", "pretty line")).not.toThrow();
      expect(spy).toHaveBeenCalled();
      // The meta markup was empty; the message still made it to the console.
      const printed = spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(printed).toContain("pretty line");
    } finally {
      spy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* BaseLogger: custom-level method colliding with an existing member (_installCustomLevelMethod)      */
/* ------------------------------------------------------------------------------------------------ */

describe("custom level colliding with a non-reserved instance member", () => {
  test("a level named 'constructor' is not installed as a method and warns", () => {
    // "constructor" passes validateCustomLevel (not a canonical name, not in RESERVED_MEMBER_NAMES),
    // but `this.constructor` already exists (the class) so _installCustomLevelMethod refuses to clobber
    // it. The level still works through log(id, name, ...).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const logger = new NodeLogger({ type: "hidden", customLevels: { constructor: 9 } });
      // The class constructor is untouched (still callable / not a level forwarder).
      expect(typeof (logger as unknown as { constructor: unknown }).constructor).toBe("function");
      const record = logger.log(9, "constructor", "still logs");
      expect((record as Record<string, { logLevelId: number }>)?._meta.logLevelId).toBe(9);
      const output = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(output).toContain('custom level "constructor" collides');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* BaseLogger: child() on the base class, and getSubLogger box-share opt-out                          */
/* ------------------------------------------------------------------------------------------------ */

describe("BaseLogger.child and sub-logger context box sharing", () => {
  const env = createNodeEnvironment();

  test("BaseLogger.child delegates to getSubLogger and inherits settings", () => {
    // The subclass overrides child(); calling it on a bare BaseLogger exercises the base method itself.
    const parent = new BaseLogger<Record<string, unknown>>({ type: "hidden", name: "root" }, undefined, env);
    const child = parent.child({ name: "sub" });
    expect(child).toBeInstanceOf(BaseLogger);
    const record = child.log(3, "INFO", "hi");
    expect((record as Record<string, { name?: string; parentNames?: string[] }>)?._meta.name).toBe("sub");
    expect((record as Record<string, { parentNames?: string[] }>)?._meta.parentNames).toEqual(["root"]);
  });

  test("a child injecting its OWN distinct contextStorage keeps a fresh context box", async () => {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const parentAls = new AsyncLocalStorage<Record<string, unknown>>();
    const childAls = new AsyncLocalStorage<Record<string, unknown>>();
    const parent = new NodeLogger({ type: "hidden", contextStorage: parentAls });
    // Distinct instance → getSubLogger's box-share condition is false; the child keeps its own box.
    const child = parent.child({ contextStorage: childAls });

    const parentCtx = parent.runInContext({ who: "parent" }, () => parent.getContext());
    const childCtx = child.runInContext({ who: "child" }, () => child.getContext());
    expect(parentCtx?.who).toBe("parent");
    expect(childCtx?.who).toBe("child");
    // The parent's active context must NOT be visible to the child (separate stores).
    parent.runInContext({ who: "parent-only" }, () => {
      expect(child.getContext()).toBeUndefined();
    });
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* BaseLogger: _getAsyncContextStore fallbacks + _flushDefaultSink catch + _shouldCaptureStack json    */
/* ------------------------------------------------------------------------------------------------ */

describe("BaseLogger internal store/flush/stack fallbacks", () => {
  /** A minimal env that satisfies the members getContext / flush / a log call touch, with overrides. */
  function minimalEnv(overrides: Partial<EnvironmentProvider> = {}): EnvironmentProvider {
    const base: Partial<EnvironmentProvider> = {
      isError: (value: unknown): value is Error => value instanceof Error,
      isBuffer: () => false,
      getErrorTrace: () => [],
      getMeta: (logLevelId: number, logLevelName: string) => ({ runtime: "unknown", date: new Date(), logLevelId, logLevelName }) as unknown as IMeta,
    };
    return { ...base, ...overrides } as unknown as EnvironmentProvider;
  }

  test("getContext falls back to the core createAsyncContextStore when the runtime lacks one", () => {
    // Runtime provider without createAsyncContextStore → BaseLogger uses the core global/builtin probe.
    const logger = new BaseLogger<Record<string, unknown>>({ type: "hidden" }, undefined, minimalEnv());
    // Node has AsyncLocalStorage, so the core store is enabled and propagates context.
    const seen = logger.runInContext({ requestId: "core-fallback" }, () => logger.getContext());
    expect(seen?.requestId).toBe("core-fallback");
  });

  test("_getAsyncContextStore materializes from an injected instance when the box is empty (defensive re-check)", async () => {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const als = new AsyncLocalStorage<Record<string, unknown>>();
    const logger = new BaseLogger<Record<string, unknown>>({ type: "hidden" }, undefined, minimalEnv());
    // Attach a contextStorage AFTER construction and clear the eagerly-materialized box so the lazy
    // resolver re-enters its `contextStorage != null` branch (createAsyncContextStoreFromInstance).
    const internals = logger as unknown as { settings: { contextStorage?: unknown }; asyncContextBox: { store?: AsyncContextStore } };
    internals.settings.contextStorage = als;
    internals.asyncContextBox.store = undefined;
    const seen = logger.runInContext({ requestId: "from-instance" }, () => logger.getContext());
    expect(seen?.requestId).toBe("from-instance");
  });

  test("flush swallows a throwing runtime.flushJsonSink instead of rejecting", async () => {
    const logger = new BaseLogger<Record<string, unknown>>(
      { type: "hidden" },
      undefined,
      minimalEnv({
        flushJsonSink: () => {
          throw new Error("sink flush blew up");
        },
      }),
    );
    await expect(logger.flush()).resolves.toBeUndefined();
  });

  test("_shouldCaptureStack returns true for json under 'auto' capture", () => {
    // normalizeSettings resolves json+auto to "off", so force the combination on the resolved settings
    // to reach the json short-circuit inside _shouldCaptureStack.
    const logger = new BaseLogger<Record<string, unknown>>({ type: "hidden" }, undefined, minimalEnv());
    logger.settings.type = "json";
    logger.settings.stack.capture = "auto";
    const internals = logger as unknown as { _shouldCaptureStack: () => boolean };
    expect(internals._shouldCaptureStack()).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* index.node.ts / index.universal.ts entry methods                                                  */
/* ------------------------------------------------------------------------------------------------ */

describe("node entry method + factory coverage", () => {
  test("trace() emits at id 1 / name TRACE", () => {
    const logger = new NodeLogger({ type: "hidden", minLevel: "SILLY" });
    const record = logger.trace("entering", { arg: 1 });
    const meta = (record as Record<string, { logLevelId: number; logLevelName: string }>)?._meta;
    expect(meta?.logLevelId).toBe(1);
    expect(meta?.logLevelName).toBe("TRACE");
  });

  test("createLogger returns a working Node logger", () => {
    const logger = createNodeLogger({ type: "hidden" });
    expect(logger).toBeInstanceOf(NodeLogger);
    expect(logger.info("via factory")).toBeDefined();
  });

  describe.runIf(isNode)("Logger.fromEnv reads TSLOG_* env vars", () => {
    const saved = { level: process.env.TSLOG_LEVEL, type: process.env.TSLOG_TYPE, name: process.env.TSLOG_NAME };
    afterEach(() => {
      for (const [k, v] of Object.entries({ TSLOG_LEVEL: saved.level, TSLOG_TYPE: saved.type, TSLOG_NAME: saved.name })) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    });

    test("env values seed minLevel/type/name and overrides win", () => {
      process.env.TSLOG_LEVEL = "WARN";
      process.env.TSLOG_TYPE = "json";
      process.env.TSLOG_NAME = "api";
      const logger = NodeLogger.fromEnv();
      expect(logger.settings.minLevel).toBe(4);
      expect(logger.settings.type).toBe("json");
      expect(logger.settings.name).toBe("api");

      const overridden = NodeLogger.fromEnv({ name: "override" });
      expect(overridden.settings.name).toBe("override");
    });
  });
});

describe("universal entry factory coverage", () => {
  test("createLogger returns a working universal logger", () => {
    const logger = createUniversalLogger({ type: "hidden" });
    expect(logger).toBeInstanceOf(UniversalLogger);
    // A single object arg is spread flat, so `k` lands at the top level of the record.
    const record = logger.info({ k: 2 });
    expect((record as Record<string, unknown>)?.k).toBe(2);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* internal/environment.ts — catch/fallback branches                                                 */
/* ------------------------------------------------------------------------------------------------ */

describe("internal/environment guarded branches", () => {
  const globalAny = globalThis as Record<string, unknown>;
  // Only the plainly-assignable globals are saved/restored by hand; `navigator`/`CSS` are managed via
  // vi.stubGlobal so vi.unstubAllGlobals() reverts them (direct assignment can hit a getter-only slot).
  const keys = ["process", "Deno", "window", "document", "importScripts"];
  const saved: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = globalAny[k];
    }
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of keys) {
      if (saved[k] === undefined) {
        delete globalAny[k];
      } else {
        globalAny[k] = saved[k];
      }
    }
  });

  test("safeGetCwd swallows a throwing Deno.cwd and returns undefined", () => {
    // process.cwd missing, Deno.cwd throws → both guarded branches yield undefined.
    globalAny.process = {};
    globalAny.Deno = {
      cwd: () => {
        throw new Error("no --allow-read");
      },
    };
    expect(safeGetCwd()).toBeUndefined();
  });

  test("resolveDefaultType returns 'pretty' when FORCE_COLOR is set (non-TTY, non-CI)", () => {
    // Not a browser/worker/RN; FORCE_COLOR forces pretty regardless of the TTY check.
    globalAny.process = { env: { FORCE_COLOR: "1" }, stdout: { isTTY: false } };
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    expect(resolveDefaultType()).toBe("pretty");
  });

  test("resolveDefaultType returns 'json' when the env bag read throws (unreadable process.env)", () => {
    // A process whose `env` getter throws exercises readEnvBag's catch (→ every env probe is a no-op),
    // and stdout.isTTY undefined → the final ternary resolves to json.
    globalAny.process = {
      get env(): never {
        throw new Error("env unreadable");
      },
      stdout: {},
    };
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    expect(resolveDefaultType()).toBe("json");
  });

  test("resolveDefaultType tolerates a stdout whose isTTY access throws (guarded, → json)", () => {
    globalAny.process = {
      env: {},
      get stdout(): never {
        throw new Error("no stdout");
      },
    };
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    // No FORCE_COLOR, not CI, stdoutIsTTY() caught → false → json.
    expect(resolveDefaultType()).toBe("json");
  });

  test("consoleSupportsCssStyling returns false in a non-browser, non-worker runtime", () => {
    delete globalAny.window;
    delete globalAny.document;
    delete (globalAny as { importScripts?: unknown }).importScripts;
    expect(consoleSupportsCssStyling()).toBe(false);
  });

  test("resolveDefaultType tolerates a navigator.product getter that throws (isReactNativeEnvironment catch)", () => {
    // Not a browser/worker; navigator.product access throws → isReactNativeEnvironment swallows it and
    // returns false, so resolveDefaultType proceeds to the server-side TTY logic (non-TTY → json).
    globalAny.process = { env: {}, stdout: { isTTY: false } };
    delete globalAny.window;
    delete globalAny.document;
    delete globalAny.Deno;
    vi.stubGlobal("navigator", {
      get product(): never {
        throw new Error("no product");
      },
    });
    expect(resolveDefaultType()).toBe("json");
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* internal/nativeConsole.ts — hostile console shim (catch → live method fallback)                    */
/* ------------------------------------------------------------------------------------------------ */

describe("nativeConsoleMethod hostile-shim fallback", () => {
  test("a throwing registry getter falls through to the live console method", () => {
    const realConsole = globalThis.console;
    const calls: unknown[][] = [];
    // A console whose NATIVE_CONSOLE_KEY property getter throws forces the try/catch to fall through.
    const hostile = {
      log: (...args: unknown[]) => calls.push(args),
    } as unknown as Console;
    Object.defineProperty(hostile, NATIVE_CONSOLE_KEY, {
      get() {
        throw new Error("hostile registry");
      },
    });
    globalThis.console = hostile;
    try {
      const fn = nativeConsoleMethod("log");
      fn("recovered");
      expect(calls).toEqual([["recovered"]]);
    } finally {
      globalThis.console = realConsole;
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* internal/errorUtils.ts — total stringify + total copyOwnProperties                                */
/* ------------------------------------------------------------------------------------------------ */

describe("errorUtils total behavior on hostile inputs", () => {
  test("toError falls back to '[unserializable cause]' when both JSON.stringify and String throw", () => {
    // A non-plain object that JSON.stringify cannot serialize (a BigInt reached WITHOUT the replacer's
    // help — here via a throwing toJSON) AND whose String() coercion throws (throwing Symbol.toPrimitive).
    const hostile = {
      toJSON() {
        throw new Error("no json");
      },
      [Symbol.toPrimitive]() {
        throw new Error("no primitive");
      },
    };
    const error = toError(hostile);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("[unserializable cause]");
  });

  test("collectErrorCauses tolerates a cause object whose Object.keys enumeration throws", () => {
    // The cause is a Proxy whose ownKeys trap throws — copyOwnProperties (inside toError) must swallow it.
    const hostileCause = new Proxy(
      { message: "root" },
      {
        ownKeys() {
          throw new Error("no keys");
        },
      },
    );
    const err = new Error("outer");
    (err as Error & { cause?: unknown }).cause = hostileCause;

    let causes: Error[] = [];
    expect(() => {
      causes = collectErrorCauses(err);
    }).not.toThrow();
    // The cause is still captured as an Error; property copying was skipped, message came from `.message`.
    expect(causes).toHaveLength(1);
    expect(causes[0]).toBeInstanceOf(Error);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* internal/metaFormatting.ts — pretty date fallback when String(rawDate) throws                      */
/* ------------------------------------------------------------------------------------------------ */

describe("buildPrettyMeta hostile non-Date date", () => {
  test("a non-Date meta.date whose String() throws degrades to 'Invalid Date'", () => {
    const settings = new NodeLogger({ type: "pretty" }).settings as unknown as ISettings<Record<string, unknown>>;
    // meta.date is neither a Date nor stringifiable: its Symbol.toPrimitive/toString throw.
    const hostileDate = {
      [Symbol.toPrimitive]() {
        throw new Error("no primitive");
      },
      toString() {
        throw new Error("no string");
      },
    };
    const meta = { logLevelName: "INFO", date: hostileDate } as unknown as IMeta;
    const result = buildPrettyMeta(settings, meta);
    // The pretty path degrades: the date fallback is "Invalid Date" (rawIsoStr / dateIsoStr use it).
    expect(result.placeholders.rawIsoStr).toBe("Invalid Date");
    expect(result.placeholders.dateIsoStr).toBe("Invalid Date");
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* subpaths/lite.ts — bindLevel when both the matched method and log are missing                      */
/* ------------------------------------------------------------------------------------------------ */

describe("LiteLogger with a sink missing both the level method and log()", () => {
  test("a level whose console method AND log are absent becomes a no-op", () => {
    // A sink with ONLY `info` — for warn/error, `sink.warn`/`sink.error` are undefined and so is
    // `sink.log`, so bindLevel returns the shared NOOP.
    const calls: unknown[][] = [];
    const sink = { info: (...a: unknown[]) => calls.push(a) } as Partial<Console>;
    const log = new LiteLogger({ console: sink });
    expect(() => {
      log.warn("dropped");
      log.error("dropped too");
    }).not.toThrow();
    expect(calls).toEqual([]);
    // info still works (its method IS present).
    log.info("kept");
    expect(calls).toEqual([["kept"]]);
  });
});
