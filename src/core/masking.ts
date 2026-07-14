import type { ISettings } from "../interfaces.js";
import { urlToObject } from "../urlToObj.js";

/**
 * Runtime predicates the masking engine needs but must not import directly, so the core stays
 * runtime-agnostic. They are supplied by the active {@link import("../env/environment.js").EnvironmentProvider}.
 */
export interface MaskingPredicates {
  isError: (value: unknown) => value is Error;
  isBuffer: (value: unknown) => boolean;
}

/**
 * A single compiled path matcher (M2.3). `segments` is the dotted path split once into its parts;
 * a `"*"` segment matches any single path segment. {@link match} compares against a path described
 * by the live `segmentStack` so no per-node string is allocated during the recursive walk.
 */
interface CompiledPath {
  segments: string[];
}

interface MaskPathsCache {
  /** The exact `settings.mask.paths` array the cache was built from (identity-compared). */
  source: string[];
  /** A `join("|")` fingerprint so an in-place mutation of `source` still invalidates the cache. */
  signature: string;
  /** The compiled matchers, returned/used verbatim while the source is unchanged. */
  compiled: CompiledPath[];
}

/**
 * Per-invocation masking state threaded through the recursive walk. Bundled into one object so the
 * recursion signature stays small while carrying the key set, the escaped placeholder, the cycle
 * guard, the compiled path matchers, and the live dotted-path {@link segmentStack}.
 */
interface MaskContext {
  keySet: Set<string>;
  escapedPlaceholder: string;
  /**
   * Memoized masked clones: source object → its (possibly still-filling) masked clone. A repeat visit —
   * a shared reference, DAG, or cycle — returns the SAME masked clone, so a secret masked on the first
   * encounter can never leak through a second path to the same object.
   *
   * When path masking is active, completed clones are NOT reused across positions (path censoring is
   * position-dependent); the memo then only breaks true cycles via {@link inProgress}.
   */
  seen: WeakMap<object, unknown>;
  /**
   * Objects currently being filled on the recursion path. Only tracked when path masking is active:
   * a revisit of an in-progress object is a true cycle (return the in-progress clone), while a revisit
   * of a completed object is a shared reference at a DIFFERENT path position and must be re-processed
   * so `mask.paths` censors exactly the configured positions — never more, never less.
   */
  inProgress?: WeakSet<object>;
  /**
   * Clones created at a path-inert position (see {@link MaskingEngine.isPathInert}). Only tracked when
   * path masking is active. An inert clone revisited at an inert position CAN be reused — no path can
   * match in either subtree, so position no longer matters. Without this, every shared reference under
   * `mask.paths` re-walks its subtree, which is exponential on diamond-shaped object graphs.
   */
  inertClones?: WeakSet<object>;
  /** Pre-seeded guard objects from the legacy v4-compat `seen` parameter; these short-circuit to a shallow copy. */
  legacySeen?: WeakSet<object>;
  /** Compiled `mask.paths`; empty when path masking is disabled (skips all path bookkeeping). */
  paths: CompiledPath[];
  /** The longest compiled path's segment count; below that depth a path can still match (see isPathInert). */
  maxPathDepth: number;
  /** The mask regexes, normalized to global flags once per invocation (see toGlobalRegex). */
  regexes: RegExp[];
  /** The path segments from the current root down to the node being visited. Mutated in place. */
  segmentStack: string[];
  /**
   * Depth counter suspending path matching while inside `Map`/`Set` contents: Map entries are not
   * addressable path segments, so `mask.paths` neither descends into nor passes through them
   * (`mask.keys`/`mask.regex` still apply inside).
   */
  pathsSuspended: number;
}

interface MaskKeysCache {
  /** The exact `settings.mask.keys` array the cache was built from (identity-compared). */
  source: string[];
  caseInsensitive: boolean;
  /** Stringified, optionally lower-cased copy of {@link source}. Returned to callers verbatim. */
  normalized: (string | number)[];
  /** A `String(k).join("|")` fingerprint so an in-place mutation of `source` still invalidates the cache. */
  signature: string;
}

/**
 * The masking engine (M1.5–M1.7, M2.3). Owns the recursive clone-and-mask pass that redacts the values of
 * configured keys (`mask.keys`), substrings matching `mask.regex`, and leaves whose dotted path
 * matches `mask.paths` (`*` = any one segment), plus the normalized mask-keys and compiled-paths caches.
 *
 * It is constructed with the *live* {@link ISettings} object (read on every call, never snapshotted, so
 * post-construction mutations of `mask.keys` / `mask.placeholder` take effect) and the runtime's
 * {@link MaskingPredicates}, keeping the core free of runtime imports.
 *
 * Behavior preserved from the v4 monolith: Error/Buffer pass-through, Date/URL cloning, the
 * `$`-escape fix for the placeholder, numeric mask-key normalization, and getter-only robustness
 * (a throwing getter yields `null` rather than aborting the mask). v5 improvements per contract:
 * a zero-clone fast path, a memoizing `WeakMap` cycle/shared-reference guard (a repeat visit returns
 * the same MASKED clone, never an unmasked copy), masking inside `Map`/`Set` contents, mask regexes
 * always applied globally, `Set.has` key matching, and a single placeholder `$`-escape per invocation.
 */
export class MaskingEngine<LogObj> {
  private maskKeysCache?: MaskKeysCache;
  private maskPathsCache?: MaskPathsCache;
  /** Per-source-RegExp cache of the global-flagged variant used for string masking. */
  private globalRegexCache = new WeakMap<RegExp, RegExp>();

  constructor(
    private readonly settings: ISettings<LogObj>,
    private readonly predicates: MaskingPredicates,
  ) {}

  /**
   * Normalize and mask every argument in `args`.
   *
   * Fast path (M1.5): when there are no mask keys AND no mask regexes AND no `mask.paths`, nothing can be
   * *masked*, so we skip the deep masking clone entirely. Only a shallow, per-argument check expands a
   * TOP-LEVEL `URL` argument into a plain object (`logger.info(url)` is the common case and a bare `URL`'s
   * own properties are non-enumerable) — the old deep normalization walk cost every log a full traversal
   * for a feature almost no log used. Nested URLs render fine without it: `JSON.stringify` emits the href
   * via `URL#toJSON`, and Node's `util.inspect` prints URLs natively in pretty mode.
   */
  public mask(args: unknown[]): unknown[] {
    const hasKeys = this.settings.mask.keys != null && this.settings.mask.keys.length > 0;
    const hasRegex = this.settings.mask.regex != null && this.settings.mask.regex.length > 0;
    const compiledPaths = this.getMaskPaths();
    const hasPaths = compiledPaths.length > 0;
    if (!hasKeys && !hasRegex && !hasPaths) {
      for (let i = 0; i < args.length; i++) {
        if (args[i] instanceof URL) {
          return args.map((arg) => (arg instanceof URL ? urlToObject(arg) : arg));
        }
      }
      return args;
    }

    const ctx = this.createContext(compiledPaths);
    // Each top-level argument is the root of its own path (`""` so its own children are "<key>").
    // Top-level URLs are expanded to plain objects BEFORE the walk (mirroring the fast path above), so
    // `mask.regex` still applies to their href/query strings; nested URLs pass through untouched on
    // both paths and serialize via `URL#toJSON` — one consistent representation regardless of config.
    return args?.map((arg) => this.recurse(arg instanceof URL ? urlToObject(arg) : arg, ctx));
  }

  /**
   * Return the normalized (stringified, lower-cased when case-insensitive) mask keys, cached by identity
   * and signature of `settings.mask.keys`. The same array reference is returned across calls while
   * the source is unchanged, so callers may rely on a stable result.
   */
  public getMaskKeys(): (string | number)[] {
    const maskKeys = this.settings.mask.keys ?? [];
    const signature = maskKeys.map(String).join("|");
    const caseInsensitive = this.settings.mask.caseInsensitive === true;

    if (this.maskKeysCache?.source === maskKeys && this.maskKeysCache.caseInsensitive === caseInsensitive && this.maskKeysCache.signature === signature) {
      return this.maskKeysCache.normalized;
    }

    // Property names returned by Object.getOwnPropertyNames are always strings, so normalize numeric mask
    // keys to strings to make them match. Lower-case them as well when matching case-insensitively.
    const normalized = caseInsensitive
      ? maskKeys.map((key) => (typeof key === "string" ? key.toLowerCase() : String(key).toLowerCase()))
      : maskKeys.map((key) => (typeof key === "string" ? key : String(key)));

    this.maskKeysCache = {
      source: maskKeys,
      caseInsensitive,
      normalized,
      signature,
    };
    return normalized;
  }

  /**
   * Recursively clone `source`, masking the values of any property whose (optionally lower-cased) name is
   * in `keys`, applying `mask.regex` to string values, and censoring any leaf whose dotted path matches
   * `settings.mask.paths`.
   *
   * Mirrors the v4 monolith signature so existing tests can call it directly; `keys` may be the raw,
   * already-normalized array from {@link getMaskKeys}. The cycle guard is a `WeakSet` (callers that pass a
   * legacy `seen` array are honored for source compatibility — its current members seed the guard).
   */
  public recursiveCloneAndMaskValuesOfKeys<T>(source: T, keys: (number | string)[], seen?: unknown[] | WeakSet<object>): T {
    const paths = this.getMaskPaths();
    const ctx: MaskContext = {
      keySet: this.buildKeySet(keys),
      escapedPlaceholder: this.escapePlaceholder(),
      seen: new WeakMap<object, unknown>(),
      inProgress: paths.length > 0 ? new WeakSet<object>() : undefined,
      inertClones: paths.length > 0 ? new WeakSet<object>() : undefined,
      legacySeen: this.toLegacySeen(seen),
      paths,
      maxPathDepth: maxSegments(paths),
      regexes: this.normalizedRegexes(),
      segmentStack: [],
      pathsSuspended: 0,
    };
    return this.recurse(source, ctx);
  }

  /** Build the lookup `Set` for O(1) `has` checks. Keys are already stringified/lower-cased by {@link getMaskKeys}. */
  private buildKeySet(keys: (number | string)[]): Set<string> {
    const set = new Set<string>();
    for (const key of keys) {
      set.add(typeof key === "string" ? key : String(key));
    }
    return set;
  }

  /**
   * Normalize the legacy v4-compat `seen` parameter into a `WeakSet` of pre-visited objects. Members
   * short-circuit to a shallow copy on encounter (the historical contract for caller-seeded guards);
   * the engine's own cycle/shared-reference handling uses the memoizing `MaskContext.seen` map instead.
   */
  private toLegacySeen(seen?: unknown[] | WeakSet<object>): WeakSet<object> | undefined {
    if (seen instanceof WeakSet) {
      return seen;
    }
    if (!Array.isArray(seen) || seen.length === 0) {
      return undefined;
    }
    const guard = new WeakSet<object>();
    for (const entry of seen) {
      if (entry !== null && typeof entry === "object") {
        guard.add(entry as object);
      }
    }
    return guard;
  }

  /**
   * Escape every `$` in the placeholder so a placeholder like `"$1"`, `"$&"`, etc. is inserted literally by
   * `String.replace` instead of being interpreted as a substitution pattern (which could leak the secret).
   * A nullish placeholder is treated as an empty replacement. Computed once per mask invocation.
   */
  private escapePlaceholder(): string {
    return (this.settings.mask.placeholder || "").replace(/\$/g, "$$$$");
  }

  /** Assemble a fresh {@link MaskContext} for a top-level {@link mask} pass. */
  private createContext(compiledPaths: CompiledPath[]): MaskContext {
    const maskKeys = this.getMaskKeys();
    return {
      keySet: this.buildKeySet(maskKeys),
      escapedPlaceholder: this.escapePlaceholder(),
      seen: new WeakMap<object, unknown>(),
      inProgress: compiledPaths.length > 0 ? new WeakSet<object>() : undefined,
      inertClones: compiledPaths.length > 0 ? new WeakSet<object>() : undefined,
      paths: compiledPaths,
      maxPathDepth: maxSegments(compiledPaths),
      regexes: this.normalizedRegexes(),
      segmentStack: [],
      pathsSuspended: 0,
    };
  }

  /** The mask regexes normalized to global matching, computed once per mask invocation. */
  private normalizedRegexes(): RegExp[] {
    const regexes = this.settings.mask.regex ?? [];
    if (regexes.length === 0) {
      return regexes;
    }
    return regexes.map((regEx) => this.toGlobalRegex(regEx));
  }

  /**
   * Whether the current position is "path-inert": no `mask.paths` pattern can match anywhere at or below
   * it. Matching requires the segment stack length to EQUAL a compiled path's length, so once the stack
   * is at least as deep as the longest path — or while inside Map/Set contents (pathsSuspended) — path
   * censoring can no longer occur and clones become position-independent (safe to memo-reuse).
   */
  private isPathInert(ctx: MaskContext): boolean {
    return ctx.pathsSuspended > 0 || ctx.segmentStack.length >= ctx.maxPathDepth;
  }

  /**
   * Return the compiled {@link CompiledPath} matchers for `settings.mask.paths`, cached by identity and
   * signature of the source array (mirrors the mask-keys cache so an in-place mutation still invalidates).
   * Empty/omitted paths yield an empty array, preserving the normalize-only fast path.
   */
  public getMaskPaths(): CompiledPath[] {
    /* v8 ignore next -- normalized settings always provide the mask group with a paths array; the fallbacks guard direct engine construction */
    const paths = this.settings.mask?.paths ?? [];
    if (paths.length === 0) {
      return [];
    }
    const signature = paths.join("|");
    if (this.maskPathsCache?.source === paths && this.maskPathsCache.signature === signature) {
      return this.maskPathsCache.compiled;
    }

    const compiled: CompiledPath[] = [];
    for (const path of paths) {
      // A path is split once into its dotted segments; empty strings produce no usable matcher.
      if (typeof path !== "string" || path.length === 0) {
        continue;
      }
      compiled.push({ segments: path.split(".") });
    }

    this.maskPathsCache = { source: paths, signature, compiled };
    return compiled;
  }

  /**
   * True when the current {@link MaskContext.segmentStack} (the dotted path to the node being visited)
   * matches at least one compiled path. A `"*"` segment matches any single segment; matching requires
   * the same number of segments (each compiled path targets a leaf at a fixed depth).
   */
  private matchesPath(ctx: MaskContext): boolean {
    // Inside Map/Set contents there are no addressable path segments — never match there.
    if (ctx.pathsSuspended > 0) {
      return false;
    }
    const stack = ctx.segmentStack;
    for (const compiled of ctx.paths) {
      const segments = compiled.segments;
      if (segments.length !== stack.length) {
        continue;
      }
      let matched = true;
      for (let i = 0; i < segments.length; i++) {
        const pattern = segments[i];
        if (pattern !== "*" && pattern !== stack[i]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve the replacement for a path-matched value per `settings.mask.censor`:
   * a function result, the `"hash"` correlation token, a literal string, or the mask placeholder when
   * censor is omitted. `"remove"` is handled by the caller (the property is dropped) and never reaches here.
   */
  private censorValue(value: unknown, ctx: MaskContext): unknown {
    const censor = this.settings.mask?.censor;
    if (typeof censor === "function") {
      return censor(value, ctx.segmentStack.join("."));
    }
    if (censor === "hash") {
      return this.hashToken(value);
    }
    if (typeof censor === "string") {
      return censor;
    }
    return this.settings.mask.placeholder;
  }

  /**
   * Build the SHORT, stable, **non-cryptographic** correlation token for a matched value (M4.3):
   * `"[<label>:xxxxxxxx]"` where `xxxxxxxx` is the FNV-1a hash of the stringified value, hex-encoded and
   * zero-padded to 8 chars. Same input → same token (correlate occurrences without exposing the secret);
   * different inputs almost always differ. Fully synchronous and zero-dep — no Web Crypto on the hot path.
   * The label is `settings.mask.hashLabel` (default `"hash"`). For correlation only; never rely on it for security.
   */
  private hashToken(value: unknown): string {
    const label = this.settings.mask.hashLabel || "hash";
    return `[${label}:${fnv1aHex(stringifyForHash(value))}]`;
  }

  private recurse<T>(source: T, ctx: MaskContext): T {
    if (source !== null && typeof source === "object") {
      if (ctx.legacySeen?.has(source)) {
        return { ...(source as object) } as T;
      }
      // A repeat visit returns the SAME masked clone. The clone is registered in `seen` BEFORE its
      // contents are filled, so a cycle resolves to the in-progress clone instead of leaking an
      // unmasked copy of the original. With path masking active, a completed clone was masked for a
      // specific path position, so it is reused only when position cannot matter: true cycles
      // (in-progress ancestors) and inert-to-inert revisits (no path can match in either subtree —
      // without this, shared references under mask.paths re-walk exponentially on diamond graphs).
      const memoized = ctx.seen.get(source);
      if (memoized !== undefined) {
        if (ctx.inProgress == null || ctx.inProgress.has(source)) {
          return memoized as T;
        }
        if (typeof memoized === "object" && memoized !== null && ctx.inertClones?.has(memoized) && this.isPathInert(ctx)) {
          return memoized as T;
        }
      }
    }

    if (this.predicates.isError(source) || this.predicates.isBuffer(source)) {
      return source as T;
    } else if (source instanceof Map) {
      // Mask INSIDE the Map: a key matching `mask.keys` (string, or number/bigint — normalized the
      // same way getMaskKeys stringifies numeric mask keys) redacts its value like an object property
      // would, and keys/values are recursed so nested secrets and `mask.regex` apply.
      // `mask.paths` neither descends into nor passes through Map/Set contents (pathsSuspended).
      const maskedMap = new Map<unknown, unknown>();
      ctx.seen.set(source, maskedMap);
      // Map contents are never path-censored, so the clone is position-independent by construction.
      ctx.inertClones?.add(maskedMap);
      ctx.inProgress?.add(source);
      ctx.pathsSuspended++;
      try {
        const caseInsensitive = this.settings.mask.caseInsensitive === true;
        for (const [key, value] of source) {
          const lookupKey =
            typeof key === "string"
              ? caseInsensitive
                ? key.toLowerCase()
                : key
              : typeof key === "number" || typeof key === "bigint"
                ? String(key)
                : undefined;
          if (lookupKey != null && ctx.keySet.has(lookupKey)) {
            maskedMap.set(key, this.settings.mask.censor === "hash" ? this.hashToken(value) : this.settings.mask.placeholder);
          } else {
            maskedMap.set(this.recurse(key, ctx), this.recurse(value, ctx));
          }
        }
      } finally {
        ctx.pathsSuspended--;
        ctx.inProgress?.delete(source);
      }
      return maskedMap as T;
    } else if (source instanceof Set) {
      const maskedSet = new Set<unknown>();
      ctx.seen.set(source, maskedSet);
      // Set contents are never path-censored, so the clone is position-independent by construction.
      ctx.inertClones?.add(maskedSet);
      ctx.inProgress?.add(source);
      ctx.pathsSuspended++;
      try {
        for (const item of source) {
          maskedSet.add(this.recurse(item, ctx));
        }
      } finally {
        ctx.pathsSuspended--;
        ctx.inProgress?.delete(source);
      }
      return maskedSet as T;
    } else if (Array.isArray(source)) {
      // `new Array(length)` + indexed assignment preserves holes in sparse arrays (like Array#map).
      const maskedArray: unknown[] = new Array(source.length);
      ctx.seen.set(source, maskedArray);
      if (ctx.inertClones != null && this.isPathInert(ctx)) {
        ctx.inertClones.add(maskedArray);
      }
      ctx.inProgress?.add(source);
      const hasPaths = ctx.paths.length > 0;
      try {
        for (let index = 0; index < source.length; index++) {
          if (!(index in source)) {
            continue;
          }
          const item = source[index];
          if (!hasPaths) {
            maskedArray[index] = this.recurse(item, ctx);
            continue;
          }
          // Array elements are addressable path segments too, so `*` (and explicit indices) can match them.
          ctx.segmentStack.push(String(index));
          try {
            maskedArray[index] = this.matchesPath(ctx) ? this.censorValue(item, ctx) : this.recurse(item, ctx);
          } finally {
            ctx.segmentStack.pop();
          }
        }
      } finally {
        ctx.inProgress?.delete(source);
      }
      return maskedArray as unknown as T;
    } else if (source instanceof Date) {
      return new Date(source.getTime()) as T;
    } else if (source instanceof URL) {
      // Nested URLs pass through untouched (immutable enough; own enumerable props are empty anyway):
      // JSON serializes them via `URL#toJSON`, pretty via inspect — identical to the no-mask path.
      return source as T;
    } else if (source !== null && typeof source === "object") {
      const caseInsensitive = this.settings.mask.caseInsensitive === true;
      const hasPaths = ctx.paths.length > 0;
      const removeOnPath = this.settings.mask.censor === "remove";
      const baseObject = Object.create(Object.getPrototypeOf(source));
      ctx.seen.set(source, baseObject);
      if (ctx.inertClones != null && this.isPathInert(ctx)) {
        ctx.inertClones.add(baseObject);
      }
      ctx.inProgress?.add(source);
      try {
        return Object.getOwnPropertyNames(source).reduce((o, prop) => {
          const lookupKey = !caseInsensitive ? (prop as string) : typeof prop === "string" ? prop.toLowerCase() : String(prop).toLowerCase();
          if (ctx.keySet.has(lookupKey)) {
            // A key match normally redacts with the placeholder. When `censor` is `"hash"` (M4.3), key masking
            // emits the stable correlation token instead (so `mask.keys` and `mask.paths` behave alike for
            // hashing); every other censor value keeps the legacy placeholder behavior for key masking.
            if (this.settings.mask.censor === "hash") {
              let matchedValue: unknown;
              try {
                matchedValue = (source as Record<string, unknown>)[prop];
              } catch {
                matchedValue = undefined;
              }
              o[prop] = this.hashToken(matchedValue);
            } else {
              o[prop] = this.settings.mask.placeholder;
            }
            return o;
          }

          if (hasPaths) {
            ctx.segmentStack.push(prop);
            try {
              if (this.matchesPath(ctx)) {
                // `"remove"` drops the property entirely; any other censor replaces the whole value.
                if (!removeOnPath) {
                  let matchedValue: unknown;
                  try {
                    matchedValue = (source as Record<string, unknown>)[prop];
                  } catch {
                    // A throwing getter still gets censored (the censor sees `undefined`), never crashes.
                    matchedValue = undefined;
                  }
                  o[prop] = this.censorValue(matchedValue, ctx);
                }
                return o;
              }
              o[prop] = this.recurseProperty(source, prop, ctx);
            } finally {
              ctx.segmentStack.pop();
            }
            return o;
          }

          o[prop] = this.recurseProperty(source, prop, ctx);
          return o;
        }, baseObject) as T;
      } finally {
        ctx.inProgress?.delete(source);
      }
    } else {
      if (typeof source === "string") {
        let modifiedSource: string = source;
        for (const regEx of ctx.regexes) {
          modifiedSource = modifiedSource.replace(regEx, ctx.escapedPlaceholder);
        }
        return modifiedSource as unknown as T;
      }
      return source;
    }
  }

  /**
   * Return a variant of `regEx` guaranteed to match globally. `String.replace` with a non-global regex
   * replaces only the FIRST occurrence — silently leaking every later secret in the same string — and a
   * sticky (`y`) regex masks nothing unless it matches at index 0. Normalized variants are cached per
   * source RegExp, so live mutations of `mask.regex` still take effect and the hot path stays a lookup.
   */
  private toGlobalRegex(regEx: RegExp): RegExp {
    if (regEx.global && !regEx.sticky) {
      return regEx;
    }
    let normalized = this.globalRegexCache.get(regEx);
    if (normalized == null) {
      normalized = new RegExp(regEx.source, `${regEx.flags.replace(/[gy]/g, "")}g`);
      this.globalRegexCache.set(regEx, normalized);
    }
    return normalized;
  }

  /** Read and recurse into a single own property, treating a throwing getter/trap as `null` (v4 behavior). */
  private recurseProperty(source: object, prop: string, ctx: MaskContext): unknown {
    try {
      return this.recurse((source as Record<string, unknown>)[prop], ctx);
    } catch {
      return null;
    }
  }
}

/** The longest compiled path's segment count — the depth horizon below which paths can no longer match. */
function maxSegments(paths: CompiledPath[]): number {
  let max = 0;
  for (const compiled of paths) {
    if (compiled.segments.length > max) {
      max = compiled.segments.length;
    }
  }
  return max;
}

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * Stringify an arbitrary matched value into the stable input for {@link fnv1aHex}. Primitives map to their
 * `String(...)` form (with `null`/`undefined` distinguished); objects use a circular-safe `JSON.stringify`
 * and fall back to `String(...)` if that throws. Deterministic so the same logical value always hashes the
 * same way (correlation), without depending on object identity.
 */
function stringifyForHash(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  const type = typeof value;
  if (type === "string") {
    return value as string;
  }
  if (type === "number" || type === "boolean" || type === "bigint") {
    return String(value);
  }
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, val) => {
      if (val !== null && typeof val === "object") {
        if (seen.has(val as object)) {
          return "[Circular]";
        }
        seen.add(val as object);
      }
      return typeof val === "bigint" ? String(val) : val;
    });
    // `JSON.stringify` returns undefined for e.g. a bare function/symbol — fall back to String(...).
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Compute the FNV-1a 32-bit hash of `input` and return it as a zero-padded 8-char lowercase hex string.
 * Synchronous, allocation-light, and non-cryptographic — used only to build a stable correlation token.
 */
function fnv1aHex(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by the FNV prime in 32-bit space via shift-adds (keeps everything an unsigned 32-bit int).
    hash = Math.imul(hash, FNV_PRIME);
  }
  // `>>> 0` coerces to an unsigned 32-bit value before hex-encoding.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Factory mirror of `new MaskingEngine(settings, predicates)`, for entry points that prefer a function
 * over `new`. Keeps the module free of any top-level side effects.
 */
export function createMaskingEngine<LogObj>(settings: ISettings<LogObj>, predicates: MaskingPredicates): MaskingEngine<LogObj> {
  return new MaskingEngine(settings, predicates);
}
