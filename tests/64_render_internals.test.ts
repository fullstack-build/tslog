import { Logger } from "../src/index.node.js";
import type { ILogObjMeta } from "../src/interfaces.js";
import { __linePlanActive, renderJson, renderJsonUnplanned, toFlatJsonObject } from "../src/render/json.js";
import { styleTokenToAnsi } from "../src/render/styles.js";

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
  // pair, unknown token → undefined (never throws).
  test("returns the palette's [open, close] pair for a known token", () => {
    expect(styleTokenToAnsi("red")).toEqual([31, 39]);
    expect(styleTokenToAnsi("bold")).toEqual([1, 22]);
    expect(styleTokenToAnsi("bgWhiteBright")).toEqual([107, 49]);
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
  // writeHead and writeMeta: no level/time head keys and no _logMeta block are emitted, but the
  // message and user fields still render.
  test("a record without a _logMeta block still renders message + fields (no head, no _logMeta)", () => {
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
    // _logMeta.date is also the raw passthrough value (writeMeta only swaps in the ISO string for a Date).
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
  });

  test("a circular structure collapses to [Circular] under stableKeyOrder", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const record = logger.info("cycle", { cyclic }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toContain('"self":"[Circular]"');
    expect(line).toContain('"name":"root"');
  });
});

describe("render/json: stableKeyOrder awkward-value fast/safe serializer choice (renderJsonUnplanned)", () => {
  // In stable mode buildFlat deep-walks every value and reports `awkward`. A bigint/undefined/native
  // Error flips it, forcing the safe replacer path in renderJsonUnplanned; a clean record stays on
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
    // The safe replacer drops the raw Error handle entirely (native stringify would instead have kept
    // an empty `"boom":{}`), so `detail` serializes as {} with the key gone — proof the awkward scan
    // flipped the record onto the safe path, without throwing and with the rest of the line intact.
    expect(JSON.parse(line).detail).toEqual({});
    expect(JSON.parse(line).message).toBe("wrapped");
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
  // Records whose positional args include Errors take the buildFlat error slow path: the errors bucket
  // under errorKey (an array when there are several) while the other fields stay top-level.
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
    expect(line.indexOf('"a":1')).toBeLessThan(line.indexOf('"z":9'));
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

  test("a record with no _logMeta block bails the planned line (meta == null)", () => {
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
    // A record with an unknown non-`path` meta key makes buildLinePlan return null (retry later, NOT
    // the permanent `false` verdict), so nothing is cached and a later clean record still plans.
    let addExtra = true;
    const logger = hidden({
      middleware: [
        (ctx): typeof ctx => {
          if (addExtra) {
            (ctx.meta as Record<string, unknown>).correlationId = "abc";
          }
          return ctx;
        },
      ],
    });
    const dirty = logger.info("has extra meta") as AnyRecord;
    expect(((dirty as Record<string, unknown>)._logMeta as Record<string, unknown>).correlationId).toBe("abc");
    expect(renderJson(dirty, logger.settings)).toBe(renderJsonUnplanned(dirty, logger.settings));
    expect(__linePlanActive(logger.settings)).toBe(false);
    // Stop polluting the meta: the next clean record builds and caches a real plan, proving the
    // dirty record produced no poisoned "never plannable" cache entry.
    addExtra = false;
    const clean = logger.info("clean again") as AnyRecord;
    expect(renderJson(clean, logger.settings)).toBe(renderJsonUnplanned(clean, logger.settings));
    expect(__linePlanActive(logger.settings)).toBe(true);
  });

  test("an embedded IErrorObject field bails the planned line (isErrorObject in the field loop)", () => {
    // A message + a trailing positional Error → toLogObj lifts the Error to a top-level field that the
    // planned line's field loop classifies via isErrorObject and then bails on (errorKey nesting needed).
    const logger = hidden();
    const record = logger.info("with embedded", new Error("embedded")) as AnyRecord;
    const line = renderJson(record, logger.settings);
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
