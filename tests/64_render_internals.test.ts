import { Logger } from "../src/index.node.js";
import type { ILogObjMeta } from "../src/interfaces.js";
import { renderJson, renderJsonUnplanned, toFlatJsonObject } from "../src/render/json.js";
import { STYLE_PALETTE, styleTokenToAnsi } from "../src/render/styles.js";

// Bun ships process.versions.bun; Node-only probes (module-registry resets around the inspect
// resolver, process.getBuiltinModule stubbing) are gated on the true Node runtime.
const isNode = typeof process !== "undefined" && process.versions?.node != null && (process.versions as Record<string, string | undefined>).bun == null;

type AnyRecord = Record<string, unknown> & ILogObjMeta;

const FIXED = new Date("2026-01-02T03:04:05.678Z");

/** A hidden logger builds the full record (mask → logObj → meta) without printing. */
function hidden(settings: ConstructorParameters<typeof Logger<AnyRecord>>[0] = {}): Logger<AnyRecord> {
  return new Logger<AnyRecord>({ type: "hidden", stack: { capture: "off" }, clock: () => FIXED, ...settings });
}

// ---------------------------------------------------------------------------------------------
// render/styles.ts
// ---------------------------------------------------------------------------------------------

describe("render/styles: styleTokenToAnsi", () => {
  // styleTokenToAnsi is the ANSI-pair sibling of styleTokenToCss (which the browser path uses). It is
  // exported for the ANSI rendering path; pin its documented contract: known token → its [open, close]
  // pair (identical to the palette entry), unknown token → undefined (never throws).
  test("returns the palette's [open, close] pair for a known token", () => {
    expect(styleTokenToAnsi("red")).toEqual([31, 39]);
    expect(styleTokenToAnsi("bold")).toEqual([1, 22]);
    expect(styleTokenToAnsi("bgWhiteBright")).toEqual([107, 49]);
    // The pair returned is exactly the one held in the single source-of-truth palette.
    expect(styleTokenToAnsi("cyan")).toBe(STYLE_PALETTE.cyan.ansi);
  });

  test("returns undefined for an unknown token instead of throwing", () => {
    expect(styleTokenToAnsi("not-a-real-style")).toBeUndefined();
    expect(styleTokenToAnsi("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// render/json.ts — edge branches driven through the real pipeline + direct renderer calls
// ---------------------------------------------------------------------------------------------

describe("render/json: writeHead / writeMeta with no meta", () => {
  // A record whose meta property is absent exercises the `meta == null` early returns in both
  // writeHead and writeMeta: no level/time head keys and no _meta block are emitted, but the
  // message and user fields still render.
  test("a record without a _meta block still renders message + fields (no head, no _meta)", () => {
    const settings = hidden().settings;
    const record = { message: "no meta here", userId: 7 } as unknown as AnyRecord;
    const flat = toFlatJsonObject(record, settings);
    expect(flat).toEqual({ message: "no meta here", userId: 7 });
    expect("level" in flat).toBe(false);
    expect("time" in flat).toBe(false);
    expect(settings.meta.property in flat).toBe(false);
    expect(renderJson(record, settings)).toBe('{"message":"no meta here","userId":7}');
  });
});

describe("render/json: writeHead non-Date meta.date passthrough", () => {
  // When middleware replaces meta.date with a non-Date value, dateIso is undefined and the top-level
  // time key passes the raw value through verbatim (the branch at the `dateIso === undefined` guard).
  test("a non-Date meta.date is emitted verbatim under the time key", () => {
    const logger = hidden({
      middleware: [
        (ctx): typeof ctx => {
          (ctx.meta as { date: unknown }).date = "custom-stamp";
          return ctx;
        },
      ],
    });
    const record = logger.info("stamped") as AnyRecord;
    const flat = toFlatJsonObject(record, logger.settings);
    expect(flat.time).toBe("custom-stamp");
    // _meta.date is also the raw passthrough value (writeMeta only swaps in the ISO string for a Date).
    expect((flat[logger.settings.meta.property] as Record<string, unknown>).date).toBe("custom-stamp");
  });
});

describe("render/json: stableKeyOrder deep-sort of user fields (deepSortKeys)", () => {
  // stableKeyOrder routes every user value through deepSortKeys: plain objects sort recursively, arrays
  // keep order but their elements sort, and Date/Error/class instances pass through by reference. These
  // assertions pin the byte-reproducible ordering the whole deepSortKeys walk produces.
  test("nested plain objects and array elements are recursively key-sorted", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info("stable", {
      z: 1,
      a: { d: 4, c: 3, b: { g: 7, f: 6 } },
      list: [{ y: 2, x: 1 }, "kept"],
    }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    // top-level user keys sorted: a, list, z
    expect(line.indexOf('"a":')).toBeLessThan(line.indexOf('"list":'));
    expect(line.indexOf('"list":')).toBeLessThan(line.indexOf('"z":'));
    // nested object keys sorted; array order preserved but its object element sorted (x before y)
    expect(line).toContain('"a":{"b":{"f":6,"g":7},"c":3,"d":4}');
    expect(line).toContain('"list":[{"x":1,"y":2},"kept"]');
    // byte-identical to the plan-free renderer
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("Date and class-instance values pass through deepSortKeys by reference (not sorted/dropped)", () => {
    class Point {
      constructor(
        public y: number,
        public x: number,
      ) {}
    }
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info("passthrough", { when: FIXED, point: new Point(2, 1) }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    // Date serializes via toJSON (ISO), untouched by the sorter.
    expect(line).toContain('"when":"2026-01-02T03:04:05.678Z"');
    // A non-plain class instance is emitted as-is: its own insertion order (y before x) is preserved.
    expect(line).toContain('"point":{"y":2,"x":1}');
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("a circular structure collapses to [Circular] under stableKeyOrder", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const record = logger.info("cycle", { cyclic }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toContain('"self":"[Circular]"');
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });
});

describe("render/json: stableKeyOrder awkward-value fast/safe serializer choice (renderJsonUnplanned)", () => {
  // In stable mode buildFlat deep-walks every value and reports `awkward`. A bigint/undefined/native
  // Error flips it, forcing the safe replacer path (line 478's awkward branch); a clean record stays on
  // native stringify. Both must produce the documented representations.
  test("a bigint field triggers the safe path and stringifies as a string", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info("big", { count: 42n }) as AnyRecord;
    const line = renderJsonUnplanned(record, logger.settings);
    expect(line).toContain('"count":"42"');
    expect(JSON.parse(line).message).toBe("big");
  });

  test("an explicit undefined field survives as [undefined] under stableKeyOrder", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info("undef", { present: 1, missing: undefined }) as AnyRecord;
    const line = renderJsonUnplanned(record, logger.settings);
    expect(JSON.parse(line).missing).toBe("[undefined]");
    expect(JSON.parse(line).present).toBe(1);
  });

  test("a native Error nested in a plain field flips awkward and the native handle is dropped", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info("wrapped", { detail: { boom: new Error("nested") } }) as AnyRecord;
    const line = renderJsonUnplanned(record, logger.settings);
    // The native Error serializes to {} on the fast path; the safe replacer drops it to undefined,
    // so the field is emitted as an empty object either way — the point is the safe path was taken
    // without throwing and the rest of the line is intact.
    expect(JSON.parse(line).message).toBe("wrapped");
    expect(line).toBe(renderJson(record, logger.settings));
  });
});

describe("render/json: containsAwkwardValue array scan (non-stable path)", () => {
  // Off the stable path buildFlat returns scanned:false, so jsonStringifyValue runs its own
  // containsAwkwardValue scan. Arrays are walked element-by-element: an awkward element short-circuits
  // to the safe path; an all-clean array falls through to native stringify.
  test("an array containing a bigint routes through the safe serializer", () => {
    const logger = hidden();
    const record = logger.info("arr", { values: [1, 2, 10n] }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toContain('"values":[1,2,"10"]');
  });

  test("an all-clean array serializes natively and unchanged", () => {
    const logger = hidden();
    const record = logger.info("arr", { values: [1, "two", true, null] }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toContain('"values":[1,"two",true,null]');
  });
});

describe("render/json: error slow path", () => {
  // A lone logged Error whose logger carries bindings is the spread-error + bound-fields case: the
  // error is emitted under errorKey and the bound fields land as regular top-level user fields.
  test("a lone Error from a logger with bindings emits the bound fields at the top level", () => {
    const logger = hidden({ bindings: { tenant: "acme", region: "eu" } });
    const record = logger.error(new Error("boom")) as AnyRecord;
    const line = renderJson(record, logger.settings);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.tenant).toBe("acme");
    expect(parsed.region).toBe("eu");
    expect((parsed.error as Record<string, unknown>).message).toBe("boom");
    // toFlatJsonObject agrees (drives the same buildFlat slow path).
    const flat = toFlatJsonObject(record, logger.settings);
    expect(flat.tenant).toBe("acme");
  });

  test("multiple logged Errors serialize as an errorKey ARRAY, sorted in stable mode", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.error("two errors", new Error("first"), new Error("second"), { z: 9, a: 1 }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const errors = parsed.error as Array<Record<string, unknown>>;
    expect(Array.isArray(errors)).toBe(true);
    expect(errors).toHaveLength(2);
    expect(errors[0].message).toBe("first");
    expect(errors[1].message).toBe("second");
    // stable mode sorts the trailing user fields (bucketed under the positional key): a before z.
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("non-stable multi-field error record keeps insertion order (slow-path non-stable branch)", () => {
    const logger = hidden();
    const record = logger.error("err", new Error("x"), { first: 1, second: 2 }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect((parsed.error as Record<string, unknown>).message).toBe("x");
    expect(parsed.message).toBe("err");
  });
});

describe("render/json: line-plan bail-outs (renderPlannedLine / buildLinePlan)", () => {
  // The precompiled plan only covers the common shape; every uncovered shape must fall through to the
  // object path and stay byte-identical. Each case here forces a specific bail return.

  test("json.time !== iso bails buildLinePlan (defensive guard) and stays byte-identical", () => {
    // renderJson gates on time==="iso" before the plan, so drive renderPlannedLine's builder via a
    // record whose settings say epoch: the plan is never active, output matches the unplanned path.
    const logger = hidden({ json: { time: "epoch" } });
    const record = logger.info("epoch", { a: 1 }) as AnyRecord;
    expect(renderJson(record, logger.settings)).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("a record with no _meta block bails the planned line (meta == null)", () => {
    const settings = hidden().settings;
    const record = { message: "planless", a: 1 } as unknown as AnyRecord;
    // No meta → renderPlannedLine returns undefined → object path; identical to the unplanned renderer.
    expect(renderJson(record, settings)).toBe(renderJsonUnplanned(record, settings));
    expect(renderJson(record, settings)).toBe('{"message":"planless","a":1}');
  });

  test("a non-Date meta.date bails the planned line", () => {
    const logger = hidden({
      middleware: [
        (ctx): typeof ctx => {
          (ctx.meta as { date: unknown }).date = 12345;
          return ctx;
        },
      ],
    });
    const record = logger.info("no date instance") as AnyRecord;
    expect(renderJson(record, logger.settings)).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("stack capture on (a `path` meta key) marks the logger permanently unplannable", () => {
    // A `path` meta key means every record of this logger is unplannable (buildLinePlan returns false).
    const logger = new Logger<AnyRecord>({ type: "hidden", stack: { capture: "full" }, clock: () => FIXED });
    const record = logger.info("with path", { a: 1 }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("a non-serializable static meta value bails the plan (buildLinePlan isPlanStaticValue false)", () => {
    // Smuggle a non-primitive static-looking meta key so isPlanStaticValue rejects it → plan bails.
    const logger = hidden({
      middleware: [
        (ctx): typeof ctx => {
          (ctx.meta as Record<string, unknown>).hostname = { nested: true };
          return ctx;
        },
      ],
    });
    const record = logger.info("bad host") as AnyRecord;
    expect(renderJson(record, logger.settings)).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("an extra per-record meta key (context field) bails the planned line without poisoning the cache", () => {
    // First record adds an unknown non-`path` meta key → buildLinePlan returns null (retry later), the
    // planned line bails for THIS record but a later clean record can still plan. Both stay identical.
    const logger = hidden();
    const dirty = logger.getSubLogger();
    dirty.settings.overwrite = {
      addMeta: (logObjMeta) => {
        (logObjMeta as { _meta: Record<string, unknown> })._meta.correlationId = "abc";
        return logObjMeta as never;
      },
    } as never;
    const record = dirty.info("has extra meta") as AnyRecord;
    expect(renderJson(record, dirty.settings)).toBe(renderJsonUnplanned(record, dirty.settings));
  });

  test("a spread lone Error bails the planned line into the error slow path", () => {
    const logger = hidden();
    const record = logger.error(new Error("planned bail")) as AnyRecord;
    expect(renderJson(record, logger.settings)).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("an embedded IErrorObject field bails the planned line (isErrorObject in the field loop)", () => {
    // A message + a trailing positional Error → toLogObj lifts the Error to a top-level field that the
    // planned line's field loop classifies via isErrorObject and then bails on (errorKey nesting needed).
    const logger = hidden();
    const record = logger.info("with embedded", new Error("embedded")) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
    expect((JSON.parse(line).error as Record<string, unknown>).message).toBe("embedded");
  });
});

// ---------------------------------------------------------------------------------------------
// render/inspect.ts — the native-formatWithOptions resolver (Node-only, node:util plumbing)
// ---------------------------------------------------------------------------------------------

describe.runIf(isNode)("render/inspect: resolveInspect native probe", () => {
  // The resolver memoizes its probe at module scope, so each scenario re-imports the module fresh
  // (vi.resetModules gives a clean nativeFormatWithOptions) after installing the globals it should see.
  // resetModules also freshens the polyfill module, so grab that instance too for identity comparison.
  async function freshResolve(): Promise<{ resolve: () => unknown; polyfill: unknown }> {
    vi.resetModules();
    const mod = await import("../src/render/inspect.js");
    const polyfillMod = await import("../src/render/inspect.polyfill.js");
    return { resolve: mod.resolveInspect as unknown as () => unknown, polyfill: polyfillMod.formatWithOptions };
  }

  const proc = globalThis as unknown as { process?: { getBuiltinModule?: unknown } };
  let savedGetBuiltinModule: unknown;
  let hadGetBuiltinModule: boolean;

  beforeEach(() => {
    hadGetBuiltinModule = proc.process != null && "getBuiltinModule" in proc.process;
    savedGetBuiltinModule = proc.process?.getBuiltinModule;
  });

  afterEach(() => {
    // Restore process.getBuiltinModule and any require/window stubs.
    if (proc.process != null) {
      if (hadGetBuiltinModule) {
        proc.process.getBuiltinModule = savedGetBuiltinModule;
      } else {
        delete proc.process.getBuiltinModule;
      }
    }
    delete (globalThis as { require?: unknown }).require;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  test("uses process.getBuiltinModule('node:util') when available (the real Node path)", async () => {
    // Native util renders a Map faithfully — the whole reason this path is preferred over the polyfill.
    const { resolve, polyfill } = await freshResolve();
    const fmt = resolve() as (opts: object, ...a: unknown[]) => string;
    expect(fmt({}, new Map([["k", "v"]]))).toContain("Map");
    // Not the polyfill.
    expect(fmt).not.toBe(polyfill);
  });

  test("falls back to the polyfill when getBuiltinModule throws AND no global require exists", async () => {
    if (proc.process != null) {
      proc.process.getBuiltinModule = (() => {
        throw new Error("builtin access forbidden");
      }) as never;
    }
    // Ensure no global require to catch (so the require fallback also returns undefined → polyfill).
    delete (globalThis as { require?: unknown }).require;
    const { resolve, polyfill } = await freshResolve();
    expect(resolve()).toBe(polyfill);
  });

  test("uses a global require('node:util') when getBuiltinModule is unavailable", async () => {
    // Hide getBuiltinModule so the probe reaches the require fallback, then hand it a fake util module.
    const fakeFormat = ((_opts: object, ...args: unknown[]): string => `fake:${args.join(",")}`) as never;
    if (proc.process != null) {
      proc.process.getBuiltinModule = undefined as never;
    }
    vi.stubGlobal("require", (specifier: string) => {
      if (specifier === "node:util") {
        return { formatWithOptions: fakeFormat };
      }
      throw new Error(`unexpected require(${specifier})`);
    });
    const { resolve } = await freshResolve();
    const fmt = resolve() as (opts: object, ...a: unknown[]) => string;
    expect(fmt({}, "x", "y")).toBe("fake:x,y");
  });

  test("falls back to the polyfill when the global require throws", async () => {
    if (proc.process != null) {
      proc.process.getBuiltinModule = undefined as never;
    }
    vi.stubGlobal("require", () => {
      throw new Error("require failed");
    });
    const { resolve, polyfill } = await freshResolve();
    expect(resolve()).toBe(polyfill);
  });

  test("falls back to the polyfill when require resolves a util without formatWithOptions", async () => {
    if (proc.process != null) {
      proc.process.getBuiltinModule = undefined as never;
    }
    vi.stubGlobal("require", () => ({}));
    const { resolve, polyfill } = await freshResolve();
    expect(resolve()).toBe(polyfill);
  });

  test("browser/worker environments skip the native lookup entirely (window present)", async () => {
    vi.stubGlobal("window", {});
    const { resolve, polyfill } = await freshResolve();
    expect(resolve()).toBe(polyfill);
  });

  test("the probe result is memoized: a second resolveInspect returns the same function", async () => {
    vi.resetModules();
    const mod = await import("../src/render/inspect.js");
    const first = (mod.resolveInspect as unknown as () => unknown)();
    const second = (mod.resolveInspect as unknown as () => unknown)();
    expect(first).toBe(second);
  });
});
