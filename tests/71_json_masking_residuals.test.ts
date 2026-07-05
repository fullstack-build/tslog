import { BOUND_FIELDS_HINT } from "../src/core/logObj.js";
import { MaskingEngine } from "../src/core/masking.js";
import { Logger } from "../src/index.node.js";
import type { ILogObjMeta } from "../src/interfaces.js";
import { renderJson, renderJsonUnplanned } from "../src/render/json.js";

// Residual-branch coverage for the flat JSON renderer (src/render/json.ts) and the masking engine
// (src/core/masking.ts). Every test here pins a specific observable behavior on a line an earlier pass
// left short; the broader contract for both modules is covered by tests/26, tests/52, tests/56, and
// tests/64. All cases are runtime-agnostic (no node: builtins beyond URL/Buffer, both present under Bun).

type AnyRecord = Record<string, unknown> & ILogObjMeta;

const FIXED = new Date("2026-01-02T03:04:05.678Z");

/** A hidden logger builds the full record (mask → logObj → meta) without printing; fixed clock for stable output. */
function hidden(settings: ConstructorParameters<typeof Logger<AnyRecord>>[0] = {}): Logger<AnyRecord> {
  return new Logger<AnyRecord>({ type: "hidden", stack: { capture: "off" }, clock: () => FIXED, ...settings });
}

/** Minimal runtime predicates for constructing a MaskingEngine directly (mirrors the node environment provider). */
const maskPredicates = {
  isError: (value: unknown): value is Error => value instanceof Error,
  isBuffer: (value: unknown): boolean => typeof Buffer !== "undefined" && Buffer.isBuffer(value),
};

// ---------------------------------------------------------------------------------------------
// src/render/json.ts
// ---------------------------------------------------------------------------------------------

describe("render/json: spread-error bound-field collisions (buildFlat slow path)", () => {
  // A lone logged Error takes the spread-error path: the error's own fields become the errorKey payload
  // and any BOUND_FIELDS_HINT fields are re-emitted as top-level user fields. The collision guard
  // (`__proto__` / the meta property / a key already present) must SKIP such a bound field instead of
  // assigning it (a `__proto__` assignment would hit the prototype setter; `_meta` would corrupt the
  // meta block). Bindings validation strips reserved keys before construction, so this pins the
  // renderer's own defense by attaching the hint directly to a genuine spread-error record.
  test("bound fields named __proto__ / the meta property are skipped; legit fields still emit", () => {
    const logger = hidden();
    const record = logger.error(new Error("boom")) as AnyRecord;
    // Own `__proto__` key (via JSON.parse) + a meta-property collision + one real field.
    const boundFields = JSON.parse('{"__proto__": {"polluted": true}, "region": "eu"}') as Record<string, unknown>;
    boundFields[logger.settings.meta.property] = "collision";
    (record as Record<symbol, unknown>)[BOUND_FIELDS_HINT] = boundFields;

    const line = renderJson(record, logger.settings);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    // The error's own message is intact under errorKey.
    expect((parsed.error as Record<string, unknown>).message).toBe("boom");
    // The non-colliding bound field lands at the top level…
    expect(parsed.region).toBe("eu");
    // …while __proto__ and the meta-property collision were skipped (no pollution, meta uncorrupted).
    expect(line).not.toContain("polluted");
    expect((parsed._meta as Record<string, unknown>).v).toBe(5);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // The object path agrees byte-for-byte.
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });
});

describe("render/json: stableKeyOrder awkward-vs-clean serializer choice (renderJsonUnplanned)", () => {
  // In stable mode buildFlat deep-walks every value and reports `awkward` (scanned=true), so
  // renderJsonUnplanned picks the serializer with no extra scan: clean → native `JSON.stringify`,
  // awkward → the safe replacer. Both arms are pinned here on the FAST path (a single logged object,
  // where deepSortKeys runs with the awk flag) so the scanned=true branch is genuinely exercised.
  test("a clean single-object record serializes via native JSON.stringify under stableKeyOrder", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info({ z: 1, a: { d: 4, c: 3 }, list: [1, 2, 3] }) as AnyRecord;
    const line = renderJsonUnplanned(record, logger.settings);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.z).toBe(1);
    expect(line).toContain('"a":{"c":3,"d":4}');
    expect(line).toContain('"list":[1,2,3]');
    // No safe-path markers appear (nothing awkward was present).
    expect(line).not.toContain("[undefined]");
    expect(line).not.toContain("[Circular]");
  });

  test("a single-object record with a bigint takes the safe replacer branch under stableKeyOrder", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    // A single logged object keeps the fast path (scanned=true); the bigint flips awkward=true, so
    // renderJsonUnplanned routes through jsonStringifySafe (the awkward arm of the scanned branch).
    const record = logger.info({ amount: 42n }) as AnyRecord;
    const line = renderJsonUnplanned(record, logger.settings);
    expect(line).toContain('"amount":"42"');
    expect(line).toBe(renderJson(record, logger.settings));
  });
});

describe("render/json: deepSortKeys awkward-flag leaves (stableKeyOrder)", () => {
  // Under stableKeyOrder the fast path routes every user field through deepSortKeys WITH the awk flag,
  // so awkwardness is observed in the sort pass. A bigint / explicit-undefined PRIMITIVE leaf sets the
  // flag at the scalar branch; a native Error (a non-plain object) sets it at the class-instance branch.
  // Each case logs a SINGLE object (the fast path) so deepSortKeys actually receives the awk flag.
  test("a bigint field (primitive leaf) flips the awkward flag and stringifies as a string", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info({ amount: 9007199254740993n }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toContain('"amount":"9007199254740993"');
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("an explicit-undefined field (primitive leaf) flips the awkward flag to [undefined]", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    const record = logger.info({ missing: undefined, kept: 1 }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(JSON.parse(line).missing).toBe("[undefined]");
    expect(JSON.parse(line).kept).toBe(1);
  });

  test("a native Error as a direct user field (non-plain leaf) flips the awkward flag", () => {
    const logger = hidden({ json: { stableKeyOrder: true } });
    // The Error is a class instance: deepSortKeys passes it through by reference but sets awk.hit,
    // so the safe replacer runs and drops the native handle without throwing.
    const record = logger.info({ err: new Error("direct error") }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect((JSON.parse(line)._meta as Record<string, unknown>).v).toBe(5);
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });
});

describe("render/json: line-plan residual bail-outs (renderPlannedLine / buildLinePlan)", () => {
  // The precompiled plan must fall back to the object path for uncovered shapes and stay byte-identical.
  // These force plan-builder / plan-validator arms an earlier pass left short.

  test("an extra per-record meta key on the FIRST planned render bails via buildLinePlan null", () => {
    // runInContext attaches a context field onto _meta. When the VERY FIRST render for these settings
    // carries that extra key, buildLinePlan hits an unknown non-`path` meta key and returns null → the
    // planned line bails for this record (line 679) without poisoning the cache.
    const logger = hidden();
    return logger.runInContext({ traceId: "trace-1" }, () => {
      const record = logger.info("in ctx") as AnyRecord;
      const line = renderJson(record, logger.settings);
      expect(line).toBe(renderJsonUnplanned(record, logger.settings));
      expect(line).toContain('"traceId":"trace-1"');
    });
  });

  test("stack capture on makes buildLinePlan return false via the `path` meta key", () => {
    // A `path` meta key (stack capture) is an unknown non-static key that permanently unplannable-marks
    // the logger: buildLinePlan returns false through the `key === "path" ? false : null` true arm.
    const logger = new Logger<AnyRecord>({ type: "hidden", stack: { capture: "full" }, clock: () => FIXED });
    const record = logger.info("with path", { a: 1 }) as AnyRecord;
    const line = renderJson(record, logger.settings);
    expect(line).toContain('"path":');
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
  });

  test("a plan-eligible record whose static meta value later changes bails plan validation", () => {
    // First render builds a plan from a clean record. A second record with the SAME meta key count but
    // a MUTATED static value (hostname) must fail the per-record static-value check (line 700) and fall
    // back to the object path — the plan's cached hostname no longer matches.
    const logger = hidden();
    const warm = logger.info("warm") as AnyRecord;
    renderJson(warm, logger.settings); // builds + caches a valid plan
    const next = logger.info("next") as AnyRecord;
    (next._meta as unknown as Record<string, unknown>).hostname = "changed-host";
    const line = renderJson(next, logger.settings);
    // Fallback output carries the mutated hostname and matches the object path exactly.
    expect(line).toContain('"hostname":"changed-host"');
    expect(line).toBe(renderJsonUnplanned(next, logger.settings));
  });

  test("buildLinePlan bails when meta is missing a required dynamic key (logLevelName)", () => {
    // A hand-built record whose _meta has date + logLevelId but NO logLevelName leaves sawLevelName at
    // 0, so buildLinePlan's `sawDate/sawLevelId/sawLevelName !== 1` guard returns false (line 608). The
    // object path then renders it (level name becomes the undefined marker), identical on both paths.
    const settings = hidden().settings;
    const record = {
      message: "partial meta",
      _meta: { runtime: "node", hostname: "h", date: FIXED, logLevelId: 3 },
    } as unknown as AnyRecord;
    const line = renderJson(record, settings);
    expect(line).toBe(renderJsonUnplanned(record, settings));
    // logLevelId is still emitted; the missing name degrades to the undefined marker, never a throw.
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.levelId).toBe(3);
  });

  test("a named error-valued field bails the ACTIVE planned line into errorKey nesting", () => {
    // Once the plan is warm, its per-field loop classifies each NON-integer field via isErrorObject.
    // A named field holding a real serialized IErrorObject makes it bail (the errorKey-nesting the plan
    // cannot emit is left to the object path). Positional errors bail earlier at the integer-key check,
    // so a genuine IErrorObject under a named key is transplanted onto a plan-eligible record here.
    const logger = hidden();
    // A real serialized IErrorObject, produced by the normal pipeline (positional error → key "1").
    const errorObject = (logger.info("seed", new Error("lifted")) as AnyRecord)["1"];
    // Warm the plan with a clean record so it is active, and reuse its meta for a plannable record.
    renderJson(logger.info("warm") as AnyRecord, logger.settings);
    const template = logger.info("template") as AnyRecord;
    // A plain field precedes the error field, so the plan's loop first passes the isErrorObject check
    // (the non-error continuation) on `ok` before bailing on `failure`.
    const record = {
      message: "with named error",
      ok: 1,
      failure: errorObject,
      _meta: template._meta,
    } as unknown as AnyRecord;

    const line = renderJson(record, logger.settings);
    // The plan bailed at the isErrorObject check and the object path nested the error under errorKey.
    expect(line).toBe(renderJsonUnplanned(record, logger.settings));
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect((parsed.error as Record<string, unknown>).message).toBe("lifted");
    expect(parsed.ok).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// src/core/masking.ts
// ---------------------------------------------------------------------------------------------

describe("masking: mask() URL fast path with mixed arguments", () => {
  // With NO mask config, a top-level URL arg triggers the fast-path map that expands URLs to plain
  // objects; the map's ternary must leave every NON-URL arg untouched (the `: arg` false side).
  test("a top-level URL is expanded while sibling non-URL args pass through unchanged", () => {
    const logger = hidden();
    const record = logger.info(new URL("https://example.com/path?q=1"), "plain-string", 42, { nested: true }) as AnyRecord;
    // The URL became a plain object (href present); the other positional args are verbatim.
    expect((record["0"] as Record<string, unknown>).href).toBe("https://example.com/path?q=1");
    expect(record["1"]).toBe("plain-string");
    expect(record["2"]).toBe(42);
    expect((record["3"] as Record<string, unknown>).nested).toBe(true);
  });
});

describe("masking: Map key match with hash vs. placeholder censor", () => {
  // A Map key matching mask.keys redacts its value. With censor:"hash" the value becomes the stable
  // correlation token (the hash true-arm); with the default censor it becomes the placeholder (the
  // false arm) — this pins the hash side that the placeholder tests do not.
  test("censor:'hash' redacts a matching Map key's value with a correlation token", () => {
    const logger = hidden({ mask: { keys: ["k"], censor: "hash" } });
    const map = new Map<string, unknown>([
      ["k", "secret-value"],
      ["plain", "visible"],
    ]);
    const record = logger.info({ m: map }) as AnyRecord;
    const masked = record.m as Map<string, unknown>;
    expect(masked.get("k")).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
    expect(masked.get("plain")).toBe("visible");
    // Same secret hashes the same whether inside a Map or a plain object (value-only correlation).
    const objRecord = logger.info({ k: "secret-value" }) as AnyRecord;
    expect(masked.get("k")).toBe(objRecord.k);
  });

  test("the default censor redacts a matching Map key's value with the placeholder", () => {
    // With no `censor` configured, a matching Map key falls to the placeholder arm (not the hash token).
    const logger = hidden({ mask: { keys: ["k"] } });
    const map = new Map<string, unknown>([
      ["k", "secret-value"],
      ["plain", "visible"],
    ]);
    const record = logger.info({ m: map }) as AnyRecord;
    const masked = record.m as Map<string, unknown>;
    expect(masked.get("k")).toBe("[***]");
    expect(masked.get("plain")).toBe("visible");
  });
});

describe("masking: Set traversal under active path masking", () => {
  // When mask.paths is configured the engine tracks inProgress/inertClones; a Set argument exercises
  // the Set branch's optional-chaining bookkeeping (inertClones?.add / inProgress?.add / ?.delete) on
  // the path-active side, while still recursing into its elements.
  test("a Set is cloned (not censored) and its object elements are still deep-masked", () => {
    const logger = hidden({ mask: { keys: ["password"], paths: ["outer.password"] } });
    const set = new Set<unknown>([1, "two", { password: "hunter2", plain: "ok" }]);
    const record = logger.info({ outer: { set } }) as AnyRecord;
    const maskedSet = (record.outer as Record<string, unknown>).set as Set<unknown>;
    expect(maskedSet).toBeInstanceOf(Set);
    const elements = [...maskedSet];
    expect(elements[0]).toBe(1);
    expect(elements[1]).toBe("two");
    // mask.keys still applies inside Set contents; the Set clone is distinct from the source.
    expect((elements[2] as Record<string, unknown>).password).toBe("[***]");
    expect((elements[2] as Record<string, unknown>).plain).toBe("ok");
    expect(maskedSet).not.toBe(set);
  });
});

describe("masking: hashing a value that contains a bigint (stringifyForHash replacer)", () => {
  // censor:"hash" on an object holding a bigint routes through stringifyForHash's circular-safe
  // JSON.stringify, whose replacer coerces bigint via String(val) (JSON has no bigint) — the bigint arm.
  test("an object with a bigint is hashed deterministically without throwing", () => {
    const logger = hidden({ mask: { keys: ["secret"], censor: "hash" } });
    let record: AnyRecord | undefined;
    expect(() => {
      record = logger.info({ secret: { big: 10n, count: 3 } }) as AnyRecord;
    }).not.toThrow();
    expect(record?.secret as string).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
    // Deterministic: the same bigint-bearing value hashes to the same token.
    const again = logger.info({ secret: { big: 10n, count: 3 } }) as AnyRecord;
    expect(record?.secret).toBe(again.secret);
    // A different bigint yields a different token.
    const other = logger.info({ secret: { big: 11n, count: 3 } }) as AnyRecord;
    expect(record?.secret).not.toBe(other.secret);
  });
});

describe("masking: MaskingEngine legacy recursiveCloneAndMaskValuesOfKeys API", () => {
  // The v4-compat public method is still exercised directly by callers that pass raw (possibly numeric)
  // keys. Constructing the engine directly pins the paths-active and paths-inactive context setup, the
  // numeric-key stringification in buildKeySet, and the getMaskPaths nullish/empty-path handling.
  test("with mask.paths active it builds the inProgress/inertClones guards and masks numeric keys", () => {
    const settings = hidden({ mask: { paths: ["a.b"] } }).settings;
    const engine = new MaskingEngine(settings as never, maskPredicates);
    // A numeric mask key is stringified in buildKeySet (the String(key) arm) to match string prop names.
    const out = engine.recursiveCloneAndMaskValuesOfKeys({ 42: "secret", other: "ok" }, [42]);
    expect((out as Record<string, unknown>)["42"]).toBe("[***]");
    expect((out as Record<string, unknown>).other).toBe("ok");
  });

  test("with no mask.paths the guards are left undefined (paths-inactive context)", () => {
    const settings = hidden({ mask: { keys: ["s"] } }).settings;
    const engine = new MaskingEngine(settings as never, maskPredicates);
    const out = engine.recursiveCloneAndMaskValuesOfKeys({ s: "secret", ok: 1 }, ["s"]);
    expect((out as Record<string, unknown>).s).toBe("[***]");
    expect((out as Record<string, unknown>).ok).toBe(1);
  });

  test("getMaskPaths returns [] when mask.paths is nullish", () => {
    const settings = hidden().settings;
    (settings.mask as Record<string, unknown>).paths = undefined;
    const engine = new MaskingEngine(settings as never, maskPredicates);
    expect(engine.getMaskPaths()).toEqual([]);
  });

  test("getMaskPaths skips empty-string / non-string path entries when compiling", () => {
    const settings = hidden({ mask: { paths: ["", "a.b"] } }).settings;
    // Smuggle a non-string entry alongside the empty string to hit the `typeof path !== "string"` arm.
    (settings.mask.paths as unknown[]).unshift(123 as never);
    const engine = new MaskingEngine(settings as never, maskPredicates);
    const compiled = engine.getMaskPaths();
    // Only the one usable dotted path compiles; "" and the numeric entry are skipped.
    expect(compiled).toHaveLength(1);
    expect(compiled[0].segments).toEqual(["a", "b"]);
  });
});
