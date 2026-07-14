import { createAsyncContextStore, createAsyncContextStoreFromInstance, resolveAsyncLocalStorage } from "../src/core/asyncContext.js";
import { TslogConfigError } from "../src/core/config.js";
import { DEFAULT_LOG_LEVEL_NAMES, logLevelName, resolveLogLevelId, validateCustomLevel } from "../src/core/levels.js";
import { createMaskingEngine, MaskingEngine } from "../src/core/masking.js";
import { attachMaskedArgs, defaultFormatter, errors, getMaskedArgs, json, resolveFormatter, runMiddleware, timestamp } from "../src/core/pipeline.js";
import { normalizeSettings, validateSettingsParam } from "../src/core/settings.js";
import { attachTransport, dispatchToTransports, disposeAll, flushAll, normalizeTransport } from "../src/core/transports.js";
import type { EnvironmentProvider } from "../src/env/environment.js";
import type { ILogObjMeta, IMeta, ISettings, LogContext, LogFormatter, TLogFormat, Transport } from "../src/interfaces.js";

// Runtime-agnostic core building blocks (pipeline stages, masking engine, transport registry, level
// resolver, async-context store, settings normalizer/validator). These exercise the tree-shakeable
// pieces DIRECTLY — with hand-built records, settings, and a fake EnvironmentProvider — so the paths
// the live Logger rarely walks (custom-formatter pipelines, censor functions, hostile settings) are
// pinned to real observable output.

const isNode = typeof process !== "undefined" && process.versions?.node != null && (process.versions as Record<string, string | undefined>).bun == null;

/** A minimal EnvironmentProvider stub implementing only the members the pipeline/masking stages call. */
function fakeProvider(overrides: Partial<EnvironmentProvider> = {}): EnvironmentProvider {
  const base = {
    isError: (value: unknown): value is Error => value instanceof Error,
    isBuffer: () => false,
    prettyFormatLine: (maskedArgs: unknown[]) => `PRETTY(${maskedArgs.map((a) => String(a)).join(",")})`,
    prettyFormatErrorObj: (error: Error) => `ERR:${error.message}`,
  };
  return { ...base, ...overrides } as unknown as EnvironmentProvider;
}

/** Build a real, fully-defaulted settings object and stamp a record with a `_logMeta` block. */
function settingsFor(overrides: Parameters<typeof normalizeSettings>[0] = { type: "json" }): ISettings<Record<string, unknown>> {
  return normalizeSettings(overrides) as ISettings<Record<string, unknown>>;
}

function recordWithMeta(fields: Record<string, unknown>, meta: Partial<IMeta> = {}): Record<string, unknown> & ILogObjMeta {
  const fullMeta: IMeta = {
    runtime: "node",
    date: new Date("2026-06-29T10:11:12.000Z"),
    logLevelId: 3,
    logLevelName: "INFO",
    ...meta,
  };
  return { ...fields, _logMeta: fullMeta } as unknown as Record<string, unknown> & ILogObjMeta;
}

/* ------------------------------------------------------------------------------------------------ */
/* pipeline.ts                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

describe("pipeline: getMaskedArgs", () => {
  test("returns the attached array verbatim when args were attached", () => {
    const record = recordWithMeta({ "0": "hi" });
    attachMaskedArgs(record, ["hi", { n: 1 }]);
    expect(getMaskedArgs(record, "_logMeta")).toEqual(["hi", { n: 1 }]);
  });

  test("reconstructs args from the record's own non-meta fields when nothing was attached", () => {
    // A transport that formats a record it built itself (no attached args) — the pretty/errors stages
    // must still recover a usable args array from the enumerable, non-meta fields.
    const record = recordWithMeta({ "0": "alpha", "1": "beta", extra: 42 });
    expect(getMaskedArgs(record, "_logMeta")).toEqual(["alpha", "beta", 42]);
  });

  test("the meta property is excluded from the reconstructed args", () => {
    const record = recordWithMeta({ msg: "only" });
    const args = getMaskedArgs(record, "_logMeta");
    expect(args).toEqual(["only"]);
    expect(args).not.toContainEqual(expect.objectContaining({ runtime: "node" }));
  });
});

describe("pipeline: timestamp stage", () => {
  test("prefixes the inner stage output with the record's ISO date", () => {
    const settings = settingsFor();
    const stage = timestamp<Record<string, unknown>>(() => "BODY");
    const record = recordWithMeta({}, { date: new Date("2026-06-29T10:11:12.000Z") });
    expect(stage(record, settings)).toBe("2026-06-29T10:11:12.000Z BODY");
  });

  test("emits only the body when the record has no Date meta", () => {
    const settings = settingsFor();
    const stage = timestamp<Record<string, unknown>>(() => "BODY");
    // meta.date is not a Date -> iso is "" -> body only.
    const record = { _logMeta: { date: "not-a-date" } } as unknown as Record<string, unknown> & ILogObjMeta;
    expect(stage(record, settings)).toBe("BODY");
  });

  test("composes over the json stage to produce a leading timestamp", () => {
    const settings = settingsFor();
    const stage = timestamp<Record<string, unknown>>(json<Record<string, unknown>>());
    const record = recordWithMeta({ message: "hi" });
    const out = stage(record, settings);
    expect(out.startsWith("2026-06-29T10:11:12.000Z {")).toBe(true);
    expect(out).toContain('"message":"hi"');
  });
});

describe("pipeline: errors stage", () => {
  test("appends a rendered error block after the inner body", () => {
    const provider = fakeProvider();
    const settings = settingsFor();
    const record = recordWithMeta({ "0": new Error("kaboom") });
    attachMaskedArgs(record, [new Error("kaboom")]);
    const stage = errors<Record<string, unknown>>(() => "context", provider);
    expect(stage(record, settings)).toBe("context\nERR:kaboom");
  });

  test("joins multiple rendered errors with a newline", () => {
    const provider = fakeProvider();
    const settings = settingsFor();
    const record = recordWithMeta({});
    attachMaskedArgs(record, [new Error("one"), "not-an-error", new Error("two")]);
    const stage = errors<Record<string, unknown>>(() => "ctx", provider);
    expect(stage(record, settings)).toBe("ctx\nERR:one\nERR:two");
  });

  test("returns just the error block when the inner body is empty", () => {
    const provider = fakeProvider();
    const settings = settingsFor();
    const record = recordWithMeta({});
    attachMaskedArgs(record, [new Error("solo")]);
    const stage = errors<Record<string, unknown>>(() => "", provider);
    expect(stage(record, settings)).toBe("ERR:solo");
  });

  test("returns the body unchanged when no argument is an error", () => {
    const provider = fakeProvider();
    const settings = settingsFor();
    const record = recordWithMeta({});
    attachMaskedArgs(record, ["plain", 1, { a: 2 }]);
    const stage = errors<Record<string, unknown>>(() => "body-only", provider);
    expect(stage(record, settings)).toBe("body-only");
  });
});

describe("pipeline: runMiddleware", () => {
  const baseCtx = (): LogContext<Record<string, unknown>> =>
    ({ logObj: {}, logLevelId: 3, logLevelName: "INFO", args: [], meta: {} }) as unknown as LogContext<Record<string, unknown>>;

  test("runs the chain in order and threads each returned context to the next", () => {
    const order: string[] = [];
    const a = (ctx: LogContext<Record<string, unknown>>): LogContext<Record<string, unknown>> => {
      order.push("a");
      return { ...ctx, logLevelName: "A" } as LogContext<Record<string, unknown>>;
    };
    const b = (ctx: LogContext<Record<string, unknown>>): LogContext<Record<string, unknown>> => {
      order.push(`b(${ctx.logLevelName})`);
      return ctx;
    };
    const result = runMiddleware(baseCtx(), [a, b]);
    expect(order).toEqual(["a", "b(A)"]);
    expect(result?.logLevelName).toBe("A");
  });

  test("a middleware returning null drops the log (returns null, later middleware not run)", () => {
    let laterRan = false;
    const result = runMiddleware(baseCtx(), [() => null, () => void (laterRan = true)]);
    expect(result).toBeNull();
    expect(laterRan).toBe(false);
  });

  test("a middleware returning false also drops the log", () => {
    expect(runMiddleware(baseCtx(), [() => false])).toBeNull();
  });

  test("a middleware returning undefined keeps the passed-in context", () => {
    const ctx = baseCtx();
    const result = runMiddleware(ctx, [() => undefined]);
    expect(result).toBe(ctx);
  });

  test("an empty chain returns the initial context unchanged", () => {
    const ctx = baseCtx();
    expect(runMiddleware(ctx, [])).toBe(ctx);
  });
});

describe("pipeline: resolveFormatter / defaultFormatter", () => {
  test("a custom function formatter is returned as-is and drives the output", () => {
    const provider = fakeProvider();
    const jsonLine: LogFormatter<Record<string, unknown>> = () => "INJECTED-JSON";
    const custom: LogFormatter<Record<string, unknown>> = (record) => `CUSTOM:${(record as Record<string, unknown>).message}`;
    const resolved = resolveFormatter(custom, provider, jsonLine);
    expect(resolved).toBe(custom);
    const settings = settingsFor();
    expect(resolved(recordWithMeta({ message: "x" }), settings)).toBe("CUSTOM:x");
  });

  test('"json" resolves to the INJECTED json line function (not the built-in stage)', () => {
    const provider = fakeProvider();
    const jsonLine: LogFormatter<Record<string, unknown>> = () => "INJECTED-JSON";
    const resolved = resolveFormatter("json", provider, jsonLine);
    expect(resolved).toBe(jsonLine);
    expect(resolved(recordWithMeta({}), settingsFor())).toBe("INJECTED-JSON");
  });

  test('"pretty" resolves to the provider-bound pretty stage', () => {
    const provider = fakeProvider();
    const jsonLine: LogFormatter<Record<string, unknown>> = () => "INJECTED-JSON";
    const resolved = resolveFormatter("pretty", provider, jsonLine);
    const record = recordWithMeta({ "0": "hey" });
    attachMaskedArgs(record, ["hey"]);
    expect(resolved(record, settingsFor())).toBe("PRETTY(hey)");
  });

  test("defaultFormatter maps type:json to the injected json line", () => {
    const provider = fakeProvider();
    const jsonLine: LogFormatter<Record<string, unknown>> = () => "INJECTED-JSON";
    const fmt = defaultFormatter(settingsFor({ type: "json" }), provider, jsonLine);
    expect(fmt(recordWithMeta({}), settingsFor({ type: "json" }))).toBe("INJECTED-JSON");
  });

  test("defaultFormatter maps a non-json type (pretty/hidden) to the pretty stage", () => {
    const provider = fakeProvider();
    const jsonLine: LogFormatter<Record<string, unknown>> = () => "INJECTED-JSON";
    const settings = settingsFor({ type: "hidden" });
    const fmt = defaultFormatter(settings, provider, jsonLine);
    const record = recordWithMeta({ "0": "pretty-path" });
    attachMaskedArgs(record, ["pretty-path"]);
    expect(fmt(record, settings)).toBe("PRETTY(pretty-path)");
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* masking.ts                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

function maskEngine(mask: NonNullable<Parameters<typeof normalizeSettings>[0]>["mask"], isBuffer = false): MaskingEngine<Record<string, unknown>> {
  const settings = normalizeSettings({ type: "hidden", mask });
  return createMaskingEngine(settings as ISettings<Record<string, unknown>>, {
    isError: (v: unknown): v is Error => v instanceof Error,
    isBuffer: () => isBuffer,
  });
}

describe("masking: regex masking edge cases", () => {
  test("a non-global regex is normalized to global so EVERY occurrence is masked", () => {
    const engine = maskEngine({ regex: [/secret/] });
    const [out] = engine.mask(["secret here and secret there"]);
    expect(out).toBe("[***] here and [***] there");
  });

  test("a sticky regex is normalized to global (would otherwise mask nothing past index 0)", () => {
    const engine = maskEngine({ regex: [/\d+/y] });
    const [out] = engine.mask(["id=42 and code=99"]);
    expect(out).toBe("id=[***] and code=[***]");
  });

  test("an already-global regex is reused unchanged", () => {
    const engine = maskEngine({ regex: [/x/g] });
    const [out] = engine.mask(["xxx"]);
    expect(out).toBe("[***][***][***]");
  });

  test("a placeholder containing $ substitution patterns is inserted literally", () => {
    const engine = maskEngine({ regex: [/secret/g], placeholder: "$&$1" });
    const [out] = engine.mask(["a secret b"]);
    expect(out).toBe("a $&$1 b");
  });
});

describe("masking: path masking with * segments", () => {
  test("a * segment matches any single key at that depth", () => {
    const engine = maskEngine({ paths: ["user.*.token"] });
    const [out] = engine.mask([{ user: { a: { token: "t1" }, b: { token: "t2" } } }]);
    const user = (out as Record<string, Record<string, Record<string, unknown>>>).user;
    expect(user.a.token).toBe("[***]");
    expect(user.b.token).toBe("[***]");
  });

  test("array indices are addressable path segments (explicit index and *)", () => {
    const engine = maskEngine({ paths: ["items.0", "flags.*"] });
    const [out] = engine.mask([{ items: ["hide-me", "keep"], flags: [true, false] }]);
    const rec = out as Record<string, unknown[]>;
    expect(rec.items[0]).toBe("[***]");
    expect(rec.items[1]).toBe("keep");
    expect(rec.flags).toEqual(["[***]", "[***]"]);
  });

  test("a path length mismatch does not match", () => {
    const engine = maskEngine({ paths: ["a.b.c"] });
    const [out] = engine.mask([{ a: { b: "shallow" } }]);
    expect((out as Record<string, Record<string, unknown>>).a.b).toBe("shallow");
  });
});

describe("masking: censor variants", () => {
  test("a censor function receives the value and its dotted path", () => {
    const calls: { value: unknown; path: string }[] = [];
    const engine = maskEngine({
      paths: ["creds.password"],
      censor: (value, path) => {
        calls.push({ value, path });
        return `redacted@${path}`;
      },
    });
    const [out] = engine.mask([{ creds: { password: "hunter2" } }]);
    expect((out as Record<string, Record<string, unknown>>).creds.password).toBe("redacted@creds.password");
    expect(calls).toEqual([{ value: "hunter2", path: "creds.password" }]);
  });

  test('censor "remove" drops a path-matched property entirely', () => {
    const engine = maskEngine({ paths: ["session.secret"], censor: "remove" });
    const [out] = engine.mask([{ session: { secret: "s", keep: "k" } }]);
    const session = (out as Record<string, Record<string, unknown>>).session;
    expect("secret" in session).toBe(false);
    expect(session.keep).toBe("k");
  });

  test("a literal string censor replaces the whole matched value", () => {
    const engine = maskEngine({ paths: ["a.b"], censor: "CENSORED" });
    const [out] = engine.mask([{ a: { b: { deep: "gone" } } }]);
    expect((out as Record<string, Record<string, unknown>>).a.b).toBe("CENSORED");
  });

  test('censor "hash" emits a stable correlation token for a path match', () => {
    const engine = maskEngine({ paths: ["u.token"], censor: "hash" });
    const [first] = engine.mask([{ u: { token: "same-value" } }]);
    const [second] = engine.mask([{ u: { token: "same-value" } }]);
    const [different] = engine.mask([{ u: { token: "other-value" } }]);
    const t1 = (first as Record<string, Record<string, unknown>>).u.token as string;
    const t2 = (second as Record<string, Record<string, unknown>>).u.token as string;
    const t3 = (different as Record<string, Record<string, unknown>>).u.token as string;
    expect(t1).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
    expect(t1).toBe(t2);
    expect(t1).not.toBe(t3);
  });

  test('censor "hash" applies to KEY masking too and honors a custom hashLabel', () => {
    const engine = maskEngine({ keys: ["password"], censor: "hash", hashLabel: "pii" });
    const [out] = engine.mask([{ password: "abc", user: "alice" }]);
    expect((out as Record<string, unknown>).password).toMatch(/^\[pii:[0-9a-f]{8}\]$/);
    expect((out as Record<string, unknown>).user).toBe("alice");
  });
});

describe("masking: caseInsensitive keys", () => {
  test("a case-insensitive key masks regardless of the property casing", () => {
    const engine = maskEngine({ keys: ["APIKEY"], caseInsensitive: true });
    const [out] = engine.mask([{ apiKey: "a", ApiKey: "b", other: "c" }]);
    const rec = out as Record<string, unknown>;
    expect(rec.apiKey).toBe("[***]");
    expect(rec.ApiKey).toBe("[***]");
    expect(rec.other).toBe("c");
  });

  test("a case-insensitive key masks a matching Map entry by string key", () => {
    const engine = maskEngine({ keys: ["secret"], caseInsensitive: true });
    const map = new Map<unknown, unknown>([
      ["SECRET", "hide"],
      ["keep", "ok"],
    ]);
    const [out] = engine.mask([map]);
    const masked = out as Map<unknown, unknown>;
    expect(masked.get("SECRET")).toBe("[***]");
    expect(masked.get("keep")).toBe("ok");
  });
});

describe("masking: numeric mask keys", () => {
  test("a numeric mask key matches the stringified property name", () => {
    const engine = maskEngine({ keys: [42] });
    const [out] = engine.mask([{ 42: "secret", 7: "ok" }]);
    const rec = out as Record<string, unknown>;
    expect(rec["42"]).toBe("[***]");
    expect(rec["7"]).toBe("ok");
  });

  test("a numeric mask key masks a numeric Map key", () => {
    const engine = maskEngine({ keys: [1] });
    const map = new Map<unknown, unknown>([
      [1, "hide"],
      [2, "keep"],
    ]);
    const [out] = engine.mask([map]);
    const masked = out as Map<unknown, unknown>;
    expect(masked.get(1)).toBe("[***]");
    expect(masked.get(2)).toBe("keep");
  });

  test("a bigint Map key normalizes to a string for matching", () => {
    const engine = maskEngine({ keys: [5] });
    const map = new Map<unknown, unknown>([[5n, "hide"]]);
    const [out] = engine.mask([map]);
    expect((out as Map<unknown, unknown>).get(5n)).toBe("[***]");
  });

  test("a non-string, non-numeric Map key is never treated as a mask key (recursed instead)", () => {
    const engine = maskEngine({ keys: ["secret"] });
    const objKey = { id: "k" };
    const map = new Map<unknown, unknown>([[objKey, { secret: "leak" }]]);
    const [out] = engine.mask([map]);
    const masked = out as Map<unknown, unknown>;
    // The object key is recursed (a fresh clone) and its value's nested secret is masked.
    const clonedValue = [...masked.values()][0] as Record<string, unknown>;
    expect(clonedValue.secret).toBe("[***]");
  });
});

describe("masking: Buffer / Error / URL / Date pass-through", () => {
  test("an Error value passes through untouched (its message is not masked)", () => {
    const engine = maskEngine({ regex: [/secret/g] });
    const err = new Error("secret message");
    const [out] = engine.mask([err]);
    expect(out).toBe(err);
    expect((out as Error).message).toBe("secret message");
  });

  test("a Buffer-like value (per predicate) passes through untouched", () => {
    const engine = maskEngine({ keys: ["x"] }, true);
    const buf = { fakeBuffer: true } as unknown;
    const [out] = engine.mask([buf]);
    expect(out).toBe(buf);
  });

  test("a Date is cloned to an equal but distinct instance", () => {
    const engine = maskEngine({ keys: ["x"] });
    const d = new Date("2020-01-01T00:00:00.000Z");
    const [out] = engine.mask([{ when: d }]);
    const cloned = (out as Record<string, unknown>).when as Date;
    expect(cloned).toBeInstanceOf(Date);
    expect(cloned).not.toBe(d);
    expect(cloned.getTime()).toBe(d.getTime());
  });

  test("a top-level URL is expanded to a plain object so mask.regex can reach its href", () => {
    const engine = maskEngine({ regex: [/token=[^&]+/g] });
    const [out] = engine.mask([new URL("https://api.test/x?token=abc123&keep=1")]);
    const rec = out as Record<string, unknown>;
    expect(String(rec.href)).toContain("[***]");
    expect(String(rec.href)).toContain("keep=1");
  });

  test("a nested URL passes through untouched under masking", () => {
    const engine = maskEngine({ keys: ["secret"] });
    const url = new URL("https://api.test/path");
    const [out] = engine.mask([{ endpoint: url, secret: "s" }]);
    const rec = out as Record<string, unknown>;
    expect(rec.endpoint).toBe(url);
    expect(rec.secret).toBe("[***]");
  });
});

describe("masking: structural robustness", () => {
  test("a circular structure is masked without throwing and the secret is masked on every path", () => {
    const engine = maskEngine({ keys: ["password"] });
    const node: Record<string, unknown> = { password: "p", label: "n" };
    node.self = node;
    const [out] = engine.mask([node]);
    const rec = out as Record<string, unknown>;
    expect(rec.password).toBe("[***]");
    // the cycle resolves to the same masked clone (also masked)
    expect((rec.self as Record<string, unknown>).password).toBe("[***]");
  });

  test("a shared reference under path masking is censored at exactly the configured position", () => {
    const engine = maskEngine({ paths: ["a.secret"] });
    const shared = { secret: "s", note: "keep" };
    const [out] = engine.mask([{ a: shared, b: shared }]);
    const rec = out as Record<string, Record<string, unknown>>;
    expect(rec.a.secret).toBe("[***]"); // matches a.secret
    expect(rec.b.secret).toBe("s"); // b.secret is NOT configured -> untouched
  });

  test("a throwing getter is censored (sees undefined) rather than crashing the mask", () => {
    const engine = maskEngine({ paths: ["obj.boom"], censor: (value) => `saw:${String(value)}` });
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "boom", {
      enumerable: true,
      get() {
        throw new Error("nope");
      },
    });
    const [out] = engine.mask([{ obj }]);
    expect((out as Record<string, Record<string, unknown>>).obj.boom).toBe("saw:undefined");
  });

  test("a throwing getter under key masking (censor:hash) hashes undefined, never throws", () => {
    const engine = maskEngine({ keys: ["boom"], censor: "hash" });
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "boom", {
      enumerable: true,
      get() {
        throw new Error("nope");
      },
    });
    let out: unknown;
    expect(() => {
      [out] = engine.mask([obj]);
    }).not.toThrow();
    expect((out as Record<string, unknown>).boom).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
  });

  test("a throwing getter during recursion (no path/no key match) degrades to null", () => {
    const engine = maskEngine({ keys: ["unrelated"] });
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "explode", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const [out] = engine.mask([obj]);
    expect((out as Record<string, unknown>).explode).toBeNull();
  });

  test("sparse array holes are preserved by the masking clone", () => {
    const engine = maskEngine({ keys: ["x"] });
    const sparse: unknown[] = [];
    sparse[2] = "present";
    const [out] = engine.mask([sparse]);
    const masked = out as unknown[];
    expect(masked.length).toBe(3);
    expect(0 in masked).toBe(false);
    expect(masked[2]).toBe("present");
  });

  test("a Set's contents are recursed (nested secrets masked) and remain a Set", () => {
    const engine = maskEngine({ keys: ["secret"] });
    const set = new Set([{ secret: "s" }, "plain"]);
    const [out] = engine.mask([set]);
    const masked = out as Set<unknown>;
    expect(masked).toBeInstanceOf(Set);
    const entries = [...masked];
    expect((entries[0] as Record<string, unknown>).secret).toBe("[***]");
    expect(entries[1]).toBe("plain");
  });
});

describe("masking: getMaskKeys / recursiveCloneAndMaskValuesOfKeys / legacy seen", () => {
  test("getMaskKeys stringifies and lower-cases keys when case-insensitive, and caches by identity", () => {
    const settings = normalizeSettings({ type: "hidden", mask: { keys: ["Aa", 7], caseInsensitive: true } });
    const engine = createMaskingEngine(settings as ISettings<Record<string, unknown>>, {
      isError: (v: unknown): v is Error => v instanceof Error,
      isBuffer: () => false,
    });
    const first = engine.getMaskKeys();
    expect(first).toEqual(["aa", "7"]);
    // same reference returned while source is unchanged (cache hit)
    expect(engine.getMaskKeys()).toBe(first);
  });

  test("recursiveCloneAndMaskValuesOfKeys short-circuits a pre-seeded legacy seen object to a shallow copy", () => {
    const settings = normalizeSettings({ type: "hidden", mask: { keys: ["secret"] } });
    const engine = createMaskingEngine(settings as ISettings<Record<string, unknown>>, {
      isError: (v: unknown): v is Error => v instanceof Error,
      isBuffer: () => false,
    });
    const guarded = { secret: "seeded", nested: { secret: "deep" } };
    // `guarded` sits INSIDE the input tree; seeding it into the legacy seen array short-circuits it to
    // a shallow, UNMASKED copy while the unseeded sibling key is still masked normally.
    const out = engine.recursiveCloneAndMaskValuesOfKeys({ secret: "top", child: guarded }, ["secret"], [guarded]) as Record<string, unknown>;
    expect(out.secret).toBe("[***]");
    const child = out.child as Record<string, unknown>;
    expect(child).not.toBe(guarded); // a copy, not the original
    expect(child.secret).toBe("seeded"); // NOT masked — the seed short-circuited masking
    // shallow: nested references are carried over by identity, their contents untouched
    expect(child.nested).toBe(guarded.nested);
    expect((child.nested as Record<string, unknown>).secret).toBe("deep");
  });

  test("recursiveCloneAndMaskValuesOfKeys accepts a WeakSet legacy seen and shallow-copies its members", () => {
    const settings = normalizeSettings({ type: "hidden", mask: { keys: ["secret"] } });
    const engine = createMaskingEngine(settings as ISettings<Record<string, unknown>>, {
      isError: (v: unknown): v is Error => v instanceof Error,
      isBuffer: () => false,
    });
    const guarded = { secret: "seeded" };
    const seen = new WeakSet<object>([guarded]);
    const out = engine.recursiveCloneAndMaskValuesOfKeys({ child: guarded }, ["secret"], seen) as Record<string, unknown>;
    // `guarded` was seeded -> shallow-copied, so its `secret` is NOT masked.
    const child = out.child as Record<string, unknown>;
    expect(child.secret).toBe("seeded");
    expect(child).not.toBe(guarded);
  });

  test("recursiveCloneAndMaskValuesOfKeys ignores an empty/non-object legacy seen list", () => {
    const settings = normalizeSettings({ type: "hidden", mask: { keys: ["secret"] } });
    const engine = createMaskingEngine(settings as ISettings<Record<string, unknown>>, {
      isError: (v: unknown): v is Error => v instanceof Error,
      isBuffer: () => false,
    });
    // an array with only non-object members -> toLegacySeen returns undefined
    const out = engine.recursiveCloneAndMaskValuesOfKeys({ secret: "x" }, ["secret"], [null, 1, "str"]) as Record<string, unknown>;
    expect(out.secret).toBe("[***]");
  });
});

describe("masking: hash stringify branches", () => {
  test("hash tokens follow the stringify contract: colliding serializations share a token, distinct ones differ", () => {
    const engine = maskEngine({ paths: ["v"], censor: "hash" });
    const tokenFor = (value: unknown): string => {
      const [out] = engine.mask([{ v: value }]);
      return (out as Record<string, unknown>).v as string;
    };
    // Non-string primitives hash via their String(...) form, so each pairs with the equivalent string
    // BY DESIGN (the correlation contract hashes serializations, not types):
    expect(tokenFor(null)).toBe(tokenFor("null"));
    expect(tokenFor(undefined)).toBe(tokenFor("undefined"));
    expect(tokenFor(42)).toBe(tokenFor("42"));
    expect(tokenFor(true)).toBe(tokenFor("true"));
    expect(tokenFor(9007199254740993n)).toBe(tokenFor("9007199254740993"));
    // Objects hash via circular-safe JSON; a cycle serializes its self-reference as "[Circular]".
    expect(tokenFor({ a: 1 })).toBe(tokenFor('{"a":1}'));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(tokenFor(circular)).toBe(tokenFor('{"self":"[Circular]"}'));
    // Genuinely distinct serializations produce distinct, well-formed tokens.
    const distinct = [tokenFor(null), tokenFor(undefined), tokenFor(42), tokenFor(true), tokenFor({ a: 1 }), tokenFor(circular)];
    for (const token of distinct) {
      expect(token).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
    }
    expect(new Set(distinct).size).toBe(distinct.length);
  });

  test("a bare function value hashes via the String(...) fallback", () => {
    const engine = maskEngine({ keys: ["fn"], censor: "hash" });
    const [out] = engine.mask([{ fn: () => 1 }]);
    expect((out as Record<string, unknown>).fn).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
  });

  test("a value whose toJSON throws falls back to String(...) without crashing the hash", () => {
    const engine = maskEngine({ keys: ["obj"], censor: "hash" });
    const hostile = {
      toJSON() {
        throw new Error("no serialize");
      },
    };
    let out: unknown;
    expect(() => {
      [out] = engine.mask([{ obj: hostile }]);
    }).not.toThrow();
    expect((out as Record<string, unknown>).obj).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
  });
});

describe("masking: inert-clone reuse on diamond graphs under path masking", () => {
  test("a shared object PAST the max path depth is masked correctly and reused (no exponential re-walk)", () => {
    // paths:["p.q"] -> maxPathDepth 2. The shared subtree sits under `holder` (depth 1) as `left`/`right`
    // (its own children are at depth 2, and the shared object itself is registered at depth 2 = inert).
    // `p.q` never matches this subtree, so it is a pure inert-position shared reference: the clone is
    // registered in inertClones and reused on the second visit while still masking its key-matched leaf.
    const engine = maskEngine({ keys: ["secret"], paths: ["p.q"] });
    const shared: Record<string, unknown> = { secret: "s", note: "n" };
    const input = { holder: { left: shared, right: shared } };
    const [out] = engine.mask([input]);
    const holder = (out as Record<string, Record<string, Record<string, unknown>>>).holder;
    // both references resolve to the SAME masked clone (inert-clone memo reuse), with the secret masked
    expect(holder.left).toBe(holder.right);
    expect(holder.left.secret).toBe("[***]");
    expect(holder.left.note).toBe("n");
  });

  test("a shared array PAST the max path depth is masked and reused", () => {
    const engine = maskEngine({ keys: ["secret"], paths: ["p.q"] });
    const sharedArr: unknown[] = [{ secret: "x" }, "keep"];
    const input = { holder: { a: sharedArr, b: sharedArr } };
    const [out] = engine.mask([input]);
    const holder = (out as Record<string, Record<string, unknown[]>>).holder;
    expect(holder.a).toBe(holder.b);
    expect((holder.a[0] as Record<string, unknown>).secret).toBe("[***]");
    expect(holder.a[1]).toBe("keep");
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* transports.ts                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

describe("transports: normalizeTransport", () => {
  test("wraps a bare function so its (possibly async) result reaches write()", async () => {
    const seen: unknown[] = [];
    const transport = normalizeTransport<Record<string, unknown>>(async (record) => {
      seen.push(record);
    });
    const record = recordWithMeta({ m: 1 });
    const result = transport.write(record, "line");
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(seen).toEqual([record]);
  });

  test("returns a full Transport object unchanged", () => {
    const full: Transport<Record<string, unknown>> = { name: "keep", write: () => undefined };
    expect(normalizeTransport(full)).toBe(full);
  });
});

describe("transports: dispatchToTransports gating and format sharing", () => {
  test("returns immediately with an empty transport list (formatResolver never called)", () => {
    let called = 0;
    dispatchToTransports<Record<string, unknown>>([], recordWithMeta({}), 3, "json", () => {
      called++;
      return "";
    });
    expect(called).toBe(0);
  });

  test("skips a transport whose minLevel is above the log level", () => {
    const written: string[] = [];
    const transport: Transport<Record<string, unknown>> = {
      minLevel: "ERROR",
      format: "json",
      write: (_r, line) => void written.push(line),
    };
    dispatchToTransports([transport], recordWithMeta({}), 3 /* INFO */, "json", () => "LINE");
    expect(written).toEqual([]);
  });

  test("an unknown/unresolvable string minLevel makes the transport receive everything", () => {
    const written: string[] = [];
    const transport: Transport<Record<string, unknown>> = {
      // "BOGUS" resolves to undefined -> NEGATIVE_INFINITY -> the transport is never gated out.
      minLevel: "BOGUS" as never,
      write: (_r, line) => void written.push(line),
    };
    dispatchToTransports([transport], recordWithMeta({}), 0 /* SILLY */, "json", () => "L");
    expect(written).toEqual(["L"]);
  });

  test("resolves a custom-level minLevel via the customLevels map", () => {
    const written: string[] = [];
    const transport: Transport<Record<string, unknown>> = {
      minLevel: "AUDIT",
      write: (_r, line) => void written.push(line),
    };
    // AUDIT=7; a level-6 log is below it -> skipped; a level-7 log passes.
    dispatchToTransports([transport], recordWithMeta({}), 6, "json", () => "L", { AUDIT: 7 });
    expect(written).toEqual([]);
    dispatchToTransports([transport], recordWithMeta({}), 7, "json", () => "L", { AUDIT: 7 });
    expect(written).toEqual(["L"]);
  });

  test("computes each distinct format at most once and shares it across transports", () => {
    let customResolutions = 0;
    const customFmt: LogFormatter<Record<string, unknown>> = () => {
      customResolutions++;
      return "CUSTOM-LINE";
    };
    const resolved: TLogFormat<Record<string, unknown>>[] = [];
    const resolver = (record: Record<string, unknown> & ILogObjMeta, format: TLogFormat<Record<string, unknown>>): string => {
      resolved.push(format);
      return typeof format === "function" ? format(record, settingsFor()) : `F(${format})`;
    };
    const linesA: string[] = [];
    const linesB: string[] = [];
    const transports: Transport<Record<string, unknown>>[] = [
      { format: "json", write: (_r, l) => void linesA.push(l) },
      { format: "json", write: (_r, l) => void linesB.push(l) },
      { format: "pretty", write: (_r, l) => void linesA.push(l) },
      { format: customFmt, write: (_r, l) => void linesA.push(l) },
      { format: customFmt, write: (_r, l) => void linesB.push(l) },
    ];
    dispatchToTransports(transports, recordWithMeta({}), 3, "json", resolver);
    // Each distinct format resolved exactly once (custom formatters by identity) — despite 5 transports.
    expect(resolved.filter((f) => f === "json")).toHaveLength(1);
    expect(resolved.filter((f) => f === "pretty")).toHaveLength(1);
    expect(resolved.filter((f) => f === customFmt)).toHaveLength(1);
    expect(customResolutions).toBe(1);
    // Every transport received the line of ITS declared format, including both sharing the custom fn.
    expect(linesA).toEqual(["F(json)", "F(pretty)", "CUSTOM-LINE"]);
    expect(linesB).toEqual(["F(json)", "CUSTOM-LINE"]);
  });

  test("a throwing formatter is isolated: the record is still delivered, the line degrades to empty", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const delivered: { record: unknown; line: string }[] = [];
      const transport: Transport<Record<string, unknown>> = {
        name: "bad-format",
        format: () => {
          throw new Error("format blew up");
        },
        write: (record, line) => void delivered.push({ record, line }),
      };
      const record = recordWithMeta({ m: "x" });
      expect(() =>
        dispatchToTransports([transport], record, 3, "json", (_r, format) => {
          if (typeof format === "function") {
            return format(record, {} as never);
          }
          return "unused";
        }),
      ).not.toThrow();
      expect(delivered).toHaveLength(1);
      expect(delivered[0].record).toBe(record);
      expect(delivered[0].line).toBe("");
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("uses the defaultFormat for a transport that declares no format", () => {
    const seen: string[] = [];
    const transport: Transport<Record<string, unknown>> = { write: (_r, l) => void seen.push(l) };
    dispatchToTransports([transport], recordWithMeta({}), 3, "pretty", (_r, format) => `default:${String(format)}`);
    expect(seen).toEqual(["default:pretty"]);
  });

  test("a transport whose write() throws synchronously is isolated, its siblings still deliver", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const delivered: string[] = [];
      const thrower: Transport<Record<string, unknown>> = {
        name: "sync-write-throw",
        format: "json",
        write: () => {
          throw new Error("write blew up");
        },
      };
      const healthy: Transport<Record<string, unknown>> = { format: "json", write: (_r, l) => void delivered.push(l) };
      expect(() => dispatchToTransports([thrower, healthy], recordWithMeta({}), 3, "json", () => "LINE")).not.toThrow();
      expect(delivered).toEqual(["LINE"]);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("transports: attachTransport detach idempotence", () => {
  test("detach removes exactly that transport and is a no-op when called twice", () => {
    const list: Transport<Record<string, unknown>>[] = [];
    const detach = attachTransport(list, { name: "t", write: () => undefined });
    expect(list).toHaveLength(1);
    detach();
    expect(list).toHaveLength(0);
    // calling again is a safe no-op even though the list is now empty
    expect(() => detach()).not.toThrow();
    expect(list).toHaveLength(0);
  });

  test("detaching after the list was mutated (index -1) is safe", () => {
    const list: Transport<Record<string, unknown>>[] = [];
    const detach = attachTransport(list, { name: "t", write: () => undefined });
    list.length = 0; // someone else cleared the list
    expect(() => detach()).not.toThrow();
  });
});

describe("transports: flushAll / disposeAll isolation", () => {
  test("flushAll returns immediately for an empty list", async () => {
    await expect(flushAll([])).resolves.toBeUndefined();
  });

  test("flushAll awaits flush() and (when asked) asyncDispose across transports; one failure never aborts the rest", async () => {
    const state = { flushedA: 0, disposedA: 0, flushedB: 0 };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const a: Transport<Record<string, unknown>> = {
        name: "a",
        write: () => undefined,
        flush: async () => {
          state.flushedA++;
        },
        [Symbol.asyncDispose]: async () => {
          state.disposedA++;
        },
      };
      const b: Transport<Record<string, unknown>> = {
        name: "b",
        write: () => undefined,
        flush: async () => {
          state.flushedB++;
          throw new Error("flush b failed");
        },
      };
      await flushAll([a, b], true);
      expect(state.flushedA).toBe(1);
      expect(state.flushedB).toBe(1);
      expect(state.disposedA).toBe(1);
      expect(errorSpy).toHaveBeenCalled(); // b's failure was reported, not thrown
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("flushAll awaits an in-flight async write before its flush resolves", async () => {
    const order: string[] = [];
    let releaseWrite!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const transport = normalizeTransport<Record<string, unknown>>(async () => {
      await gate;
      order.push("write-done");
    });
    // dispatch starts the async write, which blocks on the manually-controlled gate (no wall clock)
    dispatchToTransports([transport], recordWithMeta({}), 3, "json", () => "line");
    const flush = flushAll([transport]).then(() => order.push("flush-done"));
    // pre-flush state: the write is genuinely in flight and flush has not resolved past it
    expect(order).toEqual([]);
    releaseWrite();
    await flush;
    expect(order).toEqual(["write-done", "flush-done"]);
  });

  test("flushAll isolates a synchronously-throwing flush()", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const transport: Transport<Record<string, unknown>> = {
        name: "sync-throw",
        write: () => undefined,
        flush: () => {
          throw new Error("sync flush throw");
        },
      };
      await expect(flushAll([transport])).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("disposeAll returns immediately for an empty list and disposes each transport otherwise", async () => {
    await expect(disposeAll([])).resolves.toBeUndefined();
    let disposed = 0;
    const transport: Transport<Record<string, unknown>> = {
      write: () => undefined,
      [Symbol.asyncDispose]: async () => {
        disposed++;
      },
    };
    // a transport without a disposer is simply skipped
    const noDisposer: Transport<Record<string, unknown>> = { write: () => undefined };
    await disposeAll([transport, noDisposer]);
    expect(disposed).toBe(1);
  });

  test("a transport error is reported without a name label when the transport is anonymous", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const transport: Transport<Record<string, unknown>> = {
        write: () => undefined,
        flush: async () => {
          throw new Error("anon flush fail");
        },
      };
      await flushAll([transport]);
      expect(errorSpy).toHaveBeenCalled();
      const msg = String(errorSpy.mock.calls[0][0]);
      expect(msg).toContain("attached transport threw");
      expect(msg).not.toContain('""'); // no empty name quotes
    } finally {
      errorSpy.mockRestore();
    }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* levels.ts                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

describe("levels: resolveLogLevelId", () => {
  test("returns undefined for a nullish level", () => {
    expect(resolveLogLevelId(undefined)).toBeUndefined();
  });

  test("passes a numeric level through unchanged (including out-of-range and fractional)", () => {
    expect(resolveLogLevelId(3)).toBe(3);
    expect(resolveLogLevelId(99)).toBe(99);
    expect(resolveLogLevelId(3.5)).toBe(3.5);
  });

  test("resolves a canonical name case-insensitively", () => {
    expect(resolveLogLevelId("WARN")).toBe(4);
    expect(resolveLogLevelId("warn")).toBe(4);
    expect(resolveLogLevelId("Fatal")).toBe(6);
  });

  test("resolves a custom level by exact key, by upper-case, and by a case-differing scan", () => {
    expect(resolveLogLevelId("audit", { audit: 8 })).toBe(8);
    expect(resolveLogLevelId("AUDIT", { audit: 8 })).toBe(8);
    // exact and upper-case both miss ("Audit"), so the case-insensitive scan resolves it
    expect(resolveLogLevelId("Audit", { audit: 8 })).toBe(8);
  });

  test("a custom map that does not contain the name falls back to the default table", () => {
    expect(resolveLogLevelId("INFO", { audit: 8 })).toBe(3);
  });

  test("an unknown name with a custom map still returns undefined", () => {
    expect(resolveLogLevelId("UNKNOWN", { audit: 8 })).toBeUndefined();
  });

  test("a custom key whose value is not a number is ignored", () => {
    expect(resolveLogLevelId("weird", { weird: "x" as unknown as number })).toBeUndefined();
  });
});

describe("levels: validateCustomLevel", () => {
  test("rejects a non-string / empty name", () => {
    expect(() => validateCustomLevel(123 as unknown as string, 8)).toThrow(TypeError);
    expect(() => validateCustomLevel("", 8)).toThrow(/non-empty string/);
  });

  test("rejects a non-finite id", () => {
    expect(() => validateCustomLevel("AUDIT", Number.NaN)).toThrow(/finite number/);
    expect(() => validateCustomLevel("AUDIT", Infinity)).toThrow(/finite number/);
    expect(() => validateCustomLevel("AUDIT", "8" as unknown as number)).toThrow(/finite number/);
  });

  test("rejects a name colliding with a canonical level (case-insensitively)", () => {
    expect(() => validateCustomLevel("info", 9)).toThrow(/canonical level name/);
    expect(() => validateCustomLevel("FATAL", 9)).toThrow(/canonical level name/);
  });

  test("rejects a name colliding with a reserved logger member", () => {
    expect(() => validateCustomLevel("log", 8)).toThrow(/logger member/);
    expect(() => validateCustomLevel("Flush", 8)).toThrow(/logger member/);
  });

  test("rejects a name that differs only by case from an already-registered custom level", () => {
    expect(() => validateCustomLevel("Audit", 8, { audit: 7 })).toThrow(/differs only by case/);
  });

  test("accepts a valid, non-colliding custom level (including fractional ids)", () => {
    expect(() => validateCustomLevel("NOTICE", 3.5)).not.toThrow();
    expect(() => validateCustomLevel("AUDIT", 8, { NOTICE: 3.5 })).not.toThrow();
  });
});

describe("levels: logLevelName", () => {
  test("maps a default id to its canonical name", () => {
    expect(logLevelName(0)).toBe("SILLY");
    expect(logLevelName(6)).toBe("FATAL");
  });

  test("returns undefined for a non-default id", () => {
    expect(logLevelName(99)).toBeUndefined();
    expect(logLevelName(3.5)).toBeUndefined();
  });

  test("the default level name table exposes all seven canonical names", () => {
    expect(Object.values(DEFAULT_LOG_LEVEL_NAMES)).toEqual(["SILLY", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* asyncContext.ts                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

describe("asyncContext: createAsyncContextStore", () => {
  test("returns the no-op store when no AsyncLocalStorage constructor resolves", () => {
    // Pass an explicit `null` (not `undefined`, which would trigger the resolveAsyncLocalStorage()
    // default and pick up the real ALS on Node) to force the ctor == null no-op branch.
    const store = createAsyncContextStore(null as unknown as undefined);
    expect(store.enabled).toBe(false);
    // the no-op store still runs the function but never propagates context
    expect(store.run({ requestId: "x" }, () => store.getStore())).toBeUndefined();
    expect(store.getStore()).toBeUndefined();
  });

  test("returns the no-op store when the supplied constructor throws on instantiation", () => {
    class Broken {
      constructor() {
        throw new Error("cannot construct");
      }
    }
    const store = createAsyncContextStore(Broken as unknown as new <T>() => { run: never; getStore: never });
    expect(store.enabled).toBe(false);
    expect(store.run({ a: 1 }, () => "ran")).toBe("ran");
  });

  test("an ALS-backed store propagates and nests, inheriting parent fields", () => {
    // Use a tiny synchronous ALS-shaped stand-in so the wrapper's merge logic is exercised runtime-agnostically.
    let current: Record<string, unknown> | undefined;
    class FakeALS<T> {
      run<R>(store: T, fn: () => R): R {
        const previous = current;
        current = store as unknown as Record<string, unknown>;
        try {
          return fn();
        } finally {
          current = previous;
        }
      }
      getStore(): T | undefined {
        return current as unknown as T | undefined;
      }
    }
    const store = createAsyncContextStore(FakeALS as unknown as new <T>() => { run: FakeALS<T>["run"]; getStore: FakeALS<T>["getStore"] });
    expect(store.enabled).toBe(true);
    const outerInput = { requestId: "outer", region: "eu" };
    const innerInput = { requestId: "inner" };
    const captured = store.run(outerInput, () => {
      const outer = store.getStore();
      const inner = store.run(innerInput, () => store.getStore());
      return { outer, inner };
    });
    expect(captured.outer).toEqual({ requestId: "outer", region: "eu" });
    // nested run inherits region and overrides requestId — on a MERGED copy, not the caller's object
    expect(captured.inner).toEqual({ requestId: "inner", region: "eu" });
    expect(captured.inner).not.toBe(innerInput);
    // neither caller-owned context object was mutated by the merge
    expect(outerInput).toEqual({ requestId: "outer", region: "eu" });
    expect(innerInput).toEqual({ requestId: "inner" });
  });
});

describe("asyncContext: createAsyncContextStoreFromInstance", () => {
  test("degrades to no-op for an instance missing run/getStore", () => {
    const store = createAsyncContextStoreFromInstance({ run: 5 as unknown, getStore: () => undefined } as { run: unknown; getStore: unknown });
    expect(store.enabled).toBe(false);
  });

  test("degrades to no-op when reading run/getStore throws", () => {
    const hostile = {
      get run(): unknown {
        throw new Error("hostile accessor");
      },
      getStore: () => undefined,
    };
    const store = createAsyncContextStoreFromInstance(hostile as unknown as { run: unknown; getStore: unknown });
    expect(store.enabled).toBe(false);
    expect(store.run({ a: 1 }, () => "ok")).toBe("ok");
  });

  test("wraps a well-formed instance and merges nested contexts", () => {
    let current: Record<string, unknown> | undefined;
    const instance = {
      run(store: Record<string, unknown>, fn: () => unknown): unknown {
        const previous = current;
        current = store;
        try {
          return fn();
        } finally {
          current = previous;
        }
      },
      getStore(): Record<string, unknown> | undefined {
        return current;
      },
    };
    const store = createAsyncContextStoreFromInstance(instance);
    expect(store.enabled).toBe(true);
    const seen = store.run({ a: 1 }, () => store.run({ b: 2 }, () => store.getStore()));
    expect(seen).toEqual({ a: 1, b: 2 });
  });
});

describe("asyncContext: resolveAsyncLocalStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns a global AsyncLocalStorage constructor when present", () => {
    class GlobalALS {}
    vi.stubGlobal("AsyncLocalStorage", GlobalALS);
    expect(resolveAsyncLocalStorage()).toBe(GlobalALS as never);
  });

  test.runIf(isNode)("resolves the node:async_hooks builtin on Node", () => {
    // On Node with no global AsyncLocalStorage, the process.getBuiltinModule probe supplies it.
    const ctor = resolveAsyncLocalStorage();
    expect(typeof ctor).toBe("function");
  });

  test("returns undefined when there is no global and getBuiltinModule throws", () => {
    // Force the global probe to miss, then make the builtin probe throw -> caught -> undefined.
    vi.stubGlobal("AsyncLocalStorage", undefined);
    const realProcess = (globalThis as { process?: Record<string, unknown> }).process;
    vi.stubGlobal("process", {
      ...realProcess,
      getBuiltinModule: () => {
        throw new Error("builtin access forbidden");
      },
    });
    expect(resolveAsyncLocalStorage()).toBeUndefined();
  });

  test("returns undefined when getBuiltinModule yields a module without AsyncLocalStorage", () => {
    vi.stubGlobal("AsyncLocalStorage", undefined);
    const realProcess = (globalThis as { process?: Record<string, unknown> }).process;
    vi.stubGlobal("process", {
      ...realProcess,
      getBuiltinModule: () => ({}),
    });
    expect(resolveAsyncLocalStorage()).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* settings.ts                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

describe("settings: strictConfig throws typed errors", () => {
  test("an unknown minLevel throws UNKNOWN_MIN_LEVEL", () => {
    try {
      validateSettingsParam({ strictConfig: true, minLevel: "LOUD" as never });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TslogConfigError);
      expect((error as TslogConfigError).code).toBe("UNKNOWN_MIN_LEVEL");
      expect((error as TslogConfigError).setting).toBe("minLevel");
    }
  });

  test("a numeric out-of-range minLevel throws MIN_LEVEL_OUT_OF_RANGE", () => {
    try {
      validateSettingsParam({ strictConfig: true, minLevel: 9 });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("MIN_LEVEL_OUT_OF_RANGE");
    }
  });

  test("a custom level is a valid minLevel target (no throw)", () => {
    expect(() => validateSettingsParam({ strictConfig: true, minLevel: "AUDIT" as never, customLevels: { AUDIT: 8 } })).not.toThrow();
  });

  test("a malformed contextStorage throws INVALID_CONTEXT_STORAGE", () => {
    try {
      validateSettingsParam({ strictConfig: true, contextStorage: { run: 1 } as never });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("INVALID_CONTEXT_STORAGE");
    }
  });

  test("a contextStorage whose run accessor throws is treated as malformed", () => {
    const hostile = {
      get run(): unknown {
        throw new Error("boom");
      },
      getStore: () => undefined,
    };
    try {
      validateSettingsParam({ strictConfig: true, contextStorage: hostile as never });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("INVALID_CONTEXT_STORAGE");
    }
  });

  test("a non-function clock throws INVALID_CLOCK", () => {
    try {
      validateSettingsParam({ strictConfig: true, clock: 123 as never });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("INVALID_CLOCK");
    }
  });

  test("an invalid json.time throws INVALID_JSON_TIME", () => {
    try {
      validateSettingsParam({ strictConfig: true, json: { time: "nanoseconds" as never } });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("INVALID_JSON_TIME");
    }
  });

  test("a valid json.time value (false / epoch / function) does not throw", () => {
    expect(() => validateSettingsParam({ strictConfig: true, json: { time: false } })).not.toThrow();
    expect(() => validateSettingsParam({ strictConfig: true, json: { time: "epoch" } })).not.toThrow();
    expect(() => validateSettingsParam({ strictConfig: true, json: { time: () => 1 } })).not.toThrow();
  });

  test("a stale v4 flat key throws V4_FLAT_KEY with a migration hint", () => {
    try {
      validateSettingsParam({ strictConfig: true, maskValuesOfKeys: ["password"] } as never);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("V4_FLAT_KEY");
      expect((error as TslogConfigError).suggestion).toContain("mask.keys");
    }
  });

  test("an unknown top-level key throws UNKNOWN_SETTING with a did-you-mean suggestion", () => {
    try {
      validateSettingsParam({ strictConfig: true, minLevle: 3 } as never);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("UNKNOWN_SETTING");
      expect((error as TslogConfigError).message).toContain("minLevel");
    }
  });

  test("an unknown key with no near match suggests removal", () => {
    try {
      validateSettingsParam({ strictConfig: true, zzzzzzzz: 1 } as never);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).suggestion).toContain("not a tslog setting");
    }
  });

  test("a pure-casing top-level typo suggests the correctly-cased key", () => {
    try {
      validateSettingsParam({ strictConfig: true, Mask: { keys: [] } } as never);
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).message).toContain('did you mean "mask"');
    }
  });

  test("a group value whose Object.keys throws is skipped without crashing", () => {
    // `json` is a Proxy: it reads fine as an object, but enumerating its keys throws.
    const hostileGroup = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("no group keys");
        },
      },
    );
    expect(() => validateSettingsParam({ strictConfig: true, json: hostileGroup as never })).not.toThrow();
  });

  test("an unknown NESTED group key throws UNKNOWN_SETTING with a group-scoped suggestion", () => {
    try {
      validateSettingsParam({ strictConfig: true, json: { messagKey: "m" } as never });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).setting).toBe("json.messagKey");
      expect((error as TslogConfigError).message).toContain("json.messageKey");
    }
  });

  test("an unknown pretty.template placeholder throws UNKNOWN_PRETTY_PLACEHOLDER", () => {
    try {
      validateSettingsParam({ strictConfig: true, pretty: { template: "{{loglevelname}}" } });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as TslogConfigError).code).toBe("UNKNOWN_PRETTY_PLACEHOLDER");
    }
  });

  test("null settings is a no-op", () => {
    expect(() => validateSettingsParam(undefined)).not.toThrow();
  });
});

describe("settings: warn-only mode (non-strict) emits diagnostics without throwing", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDisable = process.env.TSLOG_DISABLE_WARNINGS;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
    delete process.env.TSLOG_DISABLE_WARNINGS;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDisable === undefined) delete process.env.TSLOG_DISABLE_WARNINGS;
    else process.env.TSLOG_DISABLE_WARNINGS = originalDisable;
    vi.restoreAllMocks();
  });

  test("an unknown key warns (does not throw) in development", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => validateSettingsParam({ minLevle: 3 } as never)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain("minLevel");
  });

  test("the whole validation pass is skipped in production when not strict", () => {
    process.env.NODE_ENV = "production";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    validateSettingsParam({ minLevle: 3 } as never);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("TSLOG_DISABLE_WARNINGS silences the warn path", () => {
    process.env.TSLOG_DISABLE_WARNINGS = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    validateSettingsParam({ minLevle: 3 } as never);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("a primitive (non-object) contextStorage is malformed but cannot be WeakSet-deduped — still warns once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A string contextStorage: `!= null` is true, `.run`/`.getStore` are undefined -> malformed; the
    // dedup WeakSet.add(primitive) throws and is swallowed, so the warning still fires.
    expect(() => validateSettingsParam({ contextStorage: "not-an-instance" as never })).not.toThrow();
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("AsyncLocalStorage"))).toBe(true);
  });

  test("a hostile settings object with a throwing ownKeys trap skips key checks without crashing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hostile = new Proxy(
      { minLevel: 3 },
      {
        ownKeys() {
          throw new Error("no ownKeys");
        },
      },
    );
    expect(() => validateSettingsParam(hostile as never)).not.toThrow();
    // minLevel:3 is valid, and the unreadable key list is skipped -> no unknown-key warning at all.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("a group value whose getter throws is skipped without crashing the key check", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hostile = new Proxy({} as Record<string, unknown>, {
      // Report only the group key so top-level enumeration succeeds but READING `json` throws.
      ownKeys() {
        return ["json"];
      },
      getOwnPropertyDescriptor() {
        return { configurable: true, enumerable: true, value: undefined };
      },
      get(_target, prop) {
        if (prop === "json") {
          throw new Error("no json read");
        }
        return undefined;
      },
    });
    expect(() => validateSettingsParam(hostile as never)).not.toThrow();
  });
});

describe("settings: normalizeSettings resolution", () => {
  test("resolves a string minLevel by name to its numeric id", () => {
    expect(normalizeSettings({ type: "hidden", minLevel: "WARN" }).minLevel).toBe(4);
  });

  test("resolves a string minLevel against a custom level registered in the same config", () => {
    const settings = normalizeSettings({ type: "hidden", minLevel: "NOTICE", customLevels: { NOTICE: 3.5 } });
    expect(settings.minLevel).toBe(3.5);
    expect(settings.customLevels).toEqual({ NOTICE: 3.5 });
  });

  test("an unresolved minLevel defaults to 0", () => {
    expect(normalizeSettings({ type: "hidden" }).minLevel).toBe(0);
  });

  test("resolveType honors pretty.enabled when type is unset", () => {
    expect(normalizeSettings({ pretty: { enabled: true } }).type).toBe("pretty");
    expect(normalizeSettings({ pretty: { enabled: false } }).type).toBe("json");
  });

  test("an explicit type overrides pretty.enabled", () => {
    expect(normalizeSettings({ type: "json", pretty: { enabled: true } }).type).toBe("json");
  });

  test("explicit meta.property and meta.attachContext override their defaults", () => {
    const settings = normalizeSettings({ type: "hidden", meta: { property: "$m", attachContext: false } });
    expect(settings.meta.property).toBe("$m");
    expect(settings.meta.attachContext).toBe(false);
  });

  test("stack.capture defaults by type: off for json, auto for pretty/hidden", () => {
    expect(normalizeSettings({ type: "json" }).stack.capture).toBe("off");
    expect(normalizeSettings({ type: "pretty" }).stack.capture).toBe("auto");
    expect(normalizeSettings({ type: "hidden" }).stack.capture).toBe("auto");
  });

  test("an explicit stack.capture wins over the type default", () => {
    expect(normalizeSettings({ type: "json", stack: { capture: "full" } }).stack.capture).toBe("full");
  });

  test("array/object inputs are cloned so the logger settings cannot be mutated by reference", () => {
    const keys = ["password"];
    const settings = normalizeSettings({ type: "hidden", mask: { keys } });
    keys.push("token");
    expect(settings.mask.keys).toEqual(["password"]);
  });

  test("bindings are shallow-copied when provided and undefined otherwise", () => {
    const bindings = { service: "api" };
    const withBindings = normalizeSettings({ type: "hidden", bindings });
    expect(withBindings.bindings).toEqual({ service: "api" });
    expect(withBindings.bindings).not.toBe(bindings);
    expect(normalizeSettings({ type: "hidden" }).bindings).toBeUndefined();
  });

  test("json.time:false is preserved (not defaulted back to iso)", () => {
    expect(normalizeSettings({ type: "json", json: { time: false } }).json.time).toBe(false);
    expect(normalizeSettings({ type: "json" }).json.time).toBe("iso");
  });

  test("a bare transport function in attachedTransports is normalized into a Transport", () => {
    const settings = normalizeSettings({ type: "hidden", attachedTransports: [() => undefined] });
    expect(typeof settings.attachedTransports[0].write).toBe("function");
  });

  test("contextStorage and clock are passed through by reference", () => {
    const clock = (): Date => new Date(0);
    const contextStorage = { run: () => undefined, getStore: () => undefined } as never;
    const settings = normalizeSettings({ type: "hidden", clock, contextStorage });
    expect(settings.clock).toBe(clock);
    expect(settings.contextStorage).toBe(contextStorage);
  });
});

describe("settings: resolveStyle honors FORCE_COLOR / NO_COLOR env when style is unset", () => {
  const originalForce = process.env.FORCE_COLOR;
  const originalNo = process.env.NO_COLOR;

  afterEach(() => {
    if (originalForce === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForce;
    if (originalNo === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNo;
  });

  test("FORCE_COLOR forces styling on", () => {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    expect(normalizeSettings({ type: "pretty" }).pretty.style).toBe(true);
  });

  test("NO_COLOR forces styling off", () => {
    delete process.env.FORCE_COLOR;
    process.env.NO_COLOR = "1";
    expect(normalizeSettings({ type: "pretty" }).pretty.style).toBe(false);
  });

  test("an explicit pretty.style wins over both env hints", () => {
    process.env.FORCE_COLOR = "1";
    process.env.NO_COLOR = "1";
    expect(normalizeSettings({ type: "pretty", pretty: { style: false } }).pretty.style).toBe(false);
    expect(normalizeSettings({ type: "pretty", pretty: { style: true } }).pretty.style).toBe(true);
  });
});
