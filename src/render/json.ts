import type { IErrorObject, ILogObjMeta, IMeta, ISettings } from "../interfaces.js";

/**
 * `render/json.ts` — the flat, fields-first JSON formatter (M2.1 / M2.2).
 *
 * The v4 JSON output was a near-1:1 `JSON.stringify(logObjWithMeta)`: positional args nested under
 * numeric keys, the message buried under `"0"`, the level only reachable inside `_meta`. v5 produces a
 * flat, observability-friendly shape with **configurable** top-level keys:
 *
 * ```jsonc
 * {
 *   "message": "user logged in",   // configurable via json.messageKey
 *   "level": "INFO",               // the level NAME, json.levelKey
 *   "levelId": 3,                  // the numeric id, json.levelIdKey (only when json.numericLevel)
 *   "time": "2026-06-29T10:11:12.000Z", // ISO timestamp from _meta.date, json.timeKey
 *   "userId": 42,                  // the user's own logged fields, spread at the top level
 *   "error": { ... },             // any logged Error(s), json.errorKey (cause chain followed)
 *   "_meta": {                     // runtime meta, key name from settings.meta.property
 *     "v": 5,                       // schema version (E8)
 *     "runtime": "Nodejs",
 *     "hostname": "host",
 *     "name": "api",
 *     "parentNames": ["root"],
 *     "logLevelId": 3,
 *     "logLevelName": "INFO",
 *     "path": { ... }
 *   }
 * }
 * ```
 *
 * Mapping rules (how the call site maps onto the top level):
 *  - **Bare string** `log.info("hi")` → `{ [messageKey]: "hi" }`. If positional args follow the string
 *    (`log.info("hi", a, b)`) the extra args are bucketed under {@link ISettings.argumentsArrayName}
 *    when set, otherwise under numeric keys `"1"`, `"2"`, … (the string keeps `messageKey`).
 *  - **Single object** `log.info({ userId: 42 })` → its keys are spread at the top level.
 *  - **Object + message** `log.info({ userId: 42 }, "hi")` (pino-style) → `{ [messageKey]: "hi",
 *    userId: 42 }`: the object's fields spread at the top level and the trailing string lands under
 *    `messageKey`.
 *  - **Positional** `log.info("a", "b")` with no leading object → `{ [messageKey]: "a", "1": "b" }`
 *    (or all under `argumentsArrayName` when set).
 *  - **Errors** anywhere in the args are collected under `errorKey` (a single Error → the object; two or
 *    more → an array), serialized as a JSON-safe {@link IErrorObject} with the `cause` chain preserved.
 *
 * The formatter is pure: it takes the already-built record (post mask → toLogObj → addMeta) plus the
 * resolved settings and returns either the flat object ({@link toFlatJsonObject}) or the JSON line
 * ({@link renderJson}). Circular references, `bigint`, and `undefined` are handled by
 * {@link jsonStringifyValue} (the same rules as `internal/jsonStringifyRecursive`, extended to honor
 * `json.stableKeyOrder`).
 */

/** Schema version embedded as `_meta.v` so downstream consumers can branch on the log shape (E8). */
export const JSON_SCHEMA_VERSION = 5 as const;

/** Internal marker key used by errors carried inside an {@link IErrorObject}; never emitted verbatim. */
const ERROR_NATIVE_KEY = "nativeError";

/** Left-pad a 0..99 integer to two digits ("7" → "07"); used by {@link toIsoString}. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Format a `Date` as an ISO-8601 UTC string, byte-identical to `Date#toISOString()` but ~3-4x faster.
 *
 * `toISOString` goes through a comparatively slow V8 path; on the JSON hot path (one timestamp per log, used
 * for both the top-level `time` key and `_meta.date`) that single call was the largest remaining cost. This
 * assembles the same `YYYY-MM-DDTHH:mm:ss.sssZ` string from the date's UTC components directly. Inputs are
 * always valid `Date`s built by the per-runtime `getMeta` provider, so no NaN/invalid-date guard is needed.
 */
function toIsoString(date: Date): string {
  const ms = date.getUTCMilliseconds();
  const msStr = ms < 10 ? `00${ms}` : ms < 100 ? `0${ms}` : `${ms}`;
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}.${msStr}Z`;
}

/**
 * Build the flat, fields-first plain object for a finished log `record` (M2.1).
 *
 * `record` is the output of the core pipeline (`toLogObj` + `addMeta`): the user's fields plus the runtime
 * meta under `settings.meta.property`. This function never mutates `record`; it returns a fresh object with
 * the well-known keys promoted to the top level and the runtime meta re-nested with `v: {@link JSON_SCHEMA_VERSION}`.
 *
 * @param record - the finished log object (user fields + the `_meta` block).
 * @param settings - the live, resolved settings (drives `json.*` keys + `meta.property`).
 * @returns a new plain object ready for {@link jsonStringifyValue}.
 *
 * @example
 * const flat = toFlatJsonObject(record, logger.settings);
 * // { message: "hi", level: "INFO", levelId: 3, time: "…", _meta: { v: 5, … } }
 */
export function toFlatJsonObject<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): Record<string, unknown> {
  return buildFlat(record, settings).flat;
}

/**
 * Result of {@link buildFlat}: the flat object plus the awkwardness verdict {@link renderJson} uses to pick
 * the fast (native) vs. safe (replacer) serializer without a second tree walk. The verdict comes "for free"
 * from the stable-mode {@link deepSortKeys} pass we already pay for.
 */
interface BuildFlatResult {
  flat: Record<string, unknown>;
  /**
   * True once a value native `JSON.stringify` can't faithfully represent was seen (a `bigint`, an explicit
   * `undefined`, or a native `Error`). Circular references are NOT counted: deepSortKeys already replaced
   * them with `"[Circular]"`, so the sorted copy native stringify receives is cycle-free.
   */
  awkward: boolean;
  /** False when we did NOT (or could not) deep-scan for awkwardness, so the caller must scan the result. */
  scanned: boolean;
}

/**
 * Shared core for {@link toFlatJsonObject} and {@link renderJson}: build the flat object and, in stable mode,
 * report whether anything awkward was seen so the caller can pick the fast vs. safe serializer. In non-stable
 * mode (opt-in, not the hot path) we skip the inline scan (`scanned: false`) and let the caller fall back to
 * {@link containsAwkwardValue} on the finished object.
 */
function buildFlat<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): BuildFlatResult {
  const metaProperty = settings.meta.property;
  const json = settings.json;
  const meta = record[metaProperty] as unknown as IMeta | undefined;
  const stable = json.stableKeyOrder;
  const recordObj = record as Record<string, unknown>;
  const recordKeys = Object.keys(recordObj);
  // Awkwardness is tracked only when `stable` (we already deep-walk every value to sort it). Reused across
  // the whole build so one shared flag covers message + fields + meta.
  const awk: AwkFlag = { hit: false };
  // Compute the timestamp ISO string ONCE; reused for both the top-level `time` and `_meta.date` so we never
  // pay the (surprisingly costly) date formatting twice for one log. `toIsoString` is a fast hand-rolled
  // equivalent of `Date#toISOString`, byte-identical but ~3-4x cheaper.
  const dateIso = meta?.date instanceof Date ? toIsoString(meta.date) : undefined;

  // A lone logged Error (`logger.error(err)`) is spread by `toLogObj` directly onto the record, so the
  // record ITSELF satisfies the IErrorObject shape (its own nativeError/name/message/stack[/cause] keys).
  // Detect that whole-record case via the cheap `nativeError instanceof Error` check ON the record (no
  // allocation): if the record carries a native Error handle it is the spread-error case. We then confirm
  // the rest of the IErrorObject shape (name/stack) to avoid misreading a user field literally named
  // `nativeError`. Checking up-front keeps the per-key loop below from splitting the error's `cause` apart.
  const recordIsSpreadError = recordObj[ERROR_NATIVE_KEY] instanceof Error && typeof recordObj.name === "string" && Array.isArray(recordObj.stack);

  // Fast path: the overwhelmingly common shape is a record with NO leading native Error, whose only keys
  // (besides meta) are a bare message under "0" and/or a handful of plain user fields — no embedded
  // IErrorObject, no pino `{fields}, "message"` arrangement. Walk the record's keys ONCE: classify each as
  // the message, an embedded error, or a plain field, while detecting the two cases the fast path can't
  // handle (an embedded error, or the pino object-then-string pattern). When neither special case fires we
  // assemble `flat` inline below with no intermediate `userFields`/`errors` allocations and no second pass.
  const hasMessageKey = !recordIsSpreadError && Object.hasOwn(recordObj, json.messageKey);
  const hasZeroKey = !recordIsSpreadError && Object.hasOwn(recordObj, "0");
  let sawEmbeddedError = false;
  let pinoLeading = false;
  if (!recordIsSpreadError) {
    const leadingObject = recordObj["0"];
    pinoLeading =
      !hasMessageKey &&
      typeof leadingObject === "object" &&
      leadingObject !== null &&
      !Array.isArray(leadingObject) &&
      !(leadingObject instanceof Date) &&
      !isErrorObject(leadingObject) &&
      typeof recordObj["1"] === "string";
    if (!pinoLeading) {
      for (let i = 0; i < recordKeys.length; i++) {
        const key = recordKeys[i];
        if (key === metaProperty || key === json.messageKey || key === "0") {
          continue;
        }
        if (isErrorObject(recordObj[key])) {
          sawEmbeddedError = true;
          break;
        }
      }
    }
  }

  // Fast path: no spread error, no embedded error, no pino pattern. Build `flat` directly in documented
  // head-first order, copying plain user fields straight from the record (sorted + deep-sorted in stable
  // mode) without ever materializing `userFields`/`errors`.
  if (!recordIsSpreadError && !sawEmbeddedError && !pinoLeading) {
    // The message comes from messageKey if present, else the legacy "0" index key. `messageSourceKey` is the
    // record key that supplied it, so the field loop below can skip exactly that key (and meta).
    const messageSourceKey = hasMessageKey ? json.messageKey : hasZeroKey ? "0" : undefined;
    const flat: Record<string, unknown> = {};
    if (messageSourceKey !== undefined) {
      // The message is the only head value that can be user-supplied (and so possibly awkward); in stable
      // mode route it through deepSortKeys so nested objects sort AND awkwardness is observed in one pass.
      const message = recordObj[messageSourceKey];
      flat[json.messageKey] = stable ? deepSortKeys(message, awk) : message;
    }
    writeHead(flat, meta, json, dateIso);
    // User fields: every record key except meta and whichever key supplied the message. Collect them only if
    // any exist (the bare-message hot path has none, so we skip the array allocation + sort entirely).
    let fieldKeys: string[] | undefined;
    for (let i = 0; i < recordKeys.length; i++) {
      const key = recordKeys[i];
      if (key === metaProperty || key === messageSourceKey) {
        continue;
      }
      if (fieldKeys === undefined) {
        fieldKeys = [];
      }
      fieldKeys.push(key);
    }
    if (fieldKeys !== undefined) {
      if (stable) {
        fieldKeys.sort();
        for (let i = 0; i < fieldKeys.length; i++) {
          flat[fieldKeys[i]] = deepSortKeys(recordObj[fieldKeys[i]], awk);
        }
      } else {
        for (let i = 0; i < fieldKeys.length; i++) {
          flat[fieldKeys[i]] = recordObj[fieldKeys[i]];
        }
      }
    }
    writeMeta(flat, meta, metaProperty, stable, dateIso, awk);
    return { flat, awkward: awk.hit, scanned: stable };
  }

  // Slow path: spread-error, embedded error, or pino object-then-string. Materialize the split as before.
  const userFields: Record<string, unknown> = {};
  const errors: IErrorObject[] = [];

  // Split the user's fields from the runtime meta. We rebuild rather than spread-and-delete so the
  // original record stays untouched (transports may receive it as-is).
  if (!recordIsSpreadError) {
    for (let i = 0; i < recordKeys.length; i++) {
      const key = recordKeys[i];
      if (key === metaProperty) {
        continue;
      }
      const value = recordObj[key];
      if (isErrorObject(value)) {
        errors.push(value);
      } else {
        userFields[key] = value;
      }
    }
  } else {
    // Whole record is one spread error: gather its own (non-meta) fields into a single IErrorObject.
    errors.push(stripMeta(record, metaProperty) as unknown as IErrorObject);
  }

  // pino-style `log.info({ fields }, "message")` (M2.1): a leading plain object followed by a string.
  // `toLogObj` buckets these as `{ "0": {fields}, "1": "message" }`. Recognize that exact pattern and
  // spread the object's fields at the top level while promoting the trailing string to messageKey — so the
  // idiomatic pino call shape produces `{ message: "...", ...fields }` rather than nesting the object as the
  // message. Only triggers when "0" is a plain (non-array/error/date) object and "1" is a string; any other
  // arrangement (string-first, object-only, object+object, 3+ args) falls through to the legacy lifting below.
  if (pinoLeading) {
    const leadingObject = userFields["0"] as Record<string, unknown>;
    delete userFields["0"];
    const promotedMessage = userFields["1"];
    delete userFields["1"];
    // Spread the leading object's fields to the top level (they win over nothing yet; user data only).
    for (const [k, v] of Object.entries(leadingObject)) {
      if (!Object.hasOwn(userFields, k)) {
        userFields[k] = v;
      }
    }
    userFields[json.messageKey] = promotedMessage;
  }

  // Lift the message: a value already stored under the configured messageKey wins; otherwise the legacy
  // index key "0" (a bare-string-first call lands there in toLogObj) is promoted to messageKey.
  let hasMessage = false;
  let message: unknown;
  if (Object.hasOwn(userFields, json.messageKey)) {
    hasMessage = true;
    message = userFields[json.messageKey];
    delete userFields[json.messageKey];
  } else if (Object.hasOwn(userFields, "0")) {
    hasMessage = true;
    message = userFields["0"];
    delete userFields["0"];
  }

  // Build in the documented head-first order: message, level, levelId, time, then the user's fields,
  // then error, then the re-nested runtime meta. This object's own insertion order IS the stable order
  // (the stableKeyOrder pass below only re-sorts the user's fields and any nested user objects).
  const flat: Record<string, unknown> = {};
  if (hasMessage) {
    flat[json.messageKey] = message;
  }
  writeHead(flat, meta, json, dateIso);

  // The user's fields: in stable mode, emit them (recursively) in sorted key order so two calls with the
  // same fields in a different insertion order produce byte-identical lines.
  const fieldKeys = stable ? Object.keys(userFields).sort() : Object.keys(userFields);
  for (const key of fieldKeys) {
    flat[key] = stable ? deepSortKeys(userFields[key]) : userFields[key];
  }

  if (errors.length > 0) {
    const serializedErrors = stable ? errors.map((error) => deepSortKeys(error)) : errors;
    flat[json.errorKey] = serializedErrors.length === 1 ? serializedErrors[0] : serializedErrors;
  }

  writeMeta(flat, meta, metaProperty, stable, dateIso);

  // The slow path always carries a native Error (the whole point of taking it), so it is awkward by
  // definition. Mark it unscanned so renderJson runs the safe serializer without a redundant inline flag.
  return { flat, awkward: true, scanned: false };
}

/**
 * Write the head-first level/levelId/time keys onto `flat` from `meta` (shared by both paths). `dateIso` is
 * the pre-computed `meta.date.toISOString()` (computed once per log and reused for `_meta.date`), so we never
 * call the relatively expensive `toISOString` twice for the same timestamp.
 */
function writeHead<LogObj>(flat: Record<string, unknown>, meta: IMeta | undefined, json: ISettings<LogObj>["json"], dateIso: string | undefined): void {
  if (meta == null) {
    return;
  }
  flat[json.levelKey] = meta.logLevelName;
  if (json.numericLevel) {
    flat[json.levelIdKey] = meta.logLevelId;
  }
  flat[json.timeKey] = dateIso !== undefined ? dateIso : meta.date;
}

/**
 * Re-nest the runtime meta under `metaProperty` with the schema version first, building the `_meta` body in
 * a single pass (no intermediate plain-object copy). In stable mode the non-`v` keys are emitted in sorted
 * order; `v` stays first regardless. Resolving each value reads through the lazy `path` getter only if
 * `path` is an own key — capture-off records never have it, so it is never forced.
 */
function writeMeta(
  flat: Record<string, unknown>,
  meta: IMeta | undefined,
  metaProperty: string,
  stable: boolean,
  dateIso: string | undefined,
  awk?: AwkFlag,
): void {
  if (meta == null) {
    return;
  }
  const metaObj = meta as unknown as Record<string, unknown>;
  const body: Record<string, unknown> = { v: JSON_SCHEMA_VERSION };
  const keys = stable ? Object.keys(metaObj).sort() : Object.keys(metaObj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    // Emit the timestamp as the already-computed ISO string instead of the Date object: byte-identical
    // output, but native `JSON.stringify` writes a plain string instead of paying the Date `toJSON` dispatch.
    if (key === "date" && dateIso !== undefined) {
      body.date = dateIso;
      continue;
    }
    body[key] = stable ? deepSortKeys(metaObj[key], awk) : metaObj[key];
  }
  flat[metaProperty] = body;
}

/**
 * Render a finished log `record` to a single JSON line (M2.2): `toFlatJsonObject` followed by a
 * circular-/bigint-safe stringify that honors `json.stableKeyOrder`.
 *
 * @param record - the finished log object (user fields + the `_meta` block).
 * @param settings - the live, resolved settings.
 * @returns the JSON string a transport writes (no trailing newline).
 *
 * @example
 * const line = renderJson(record, logger.settings);
 * // '{"message":"hi","level":"INFO","levelId":3,"time":"…","_meta":{"v":5,…}}'
 */
export function renderJson<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): string {
  const { flat, awkward, scanned } = buildFlat(record, settings);
  // In stable mode the build already deep-walked every value and reported `awkward`, so we can pick the
  // serializer with zero extra work: clean → native `JSON.stringify` (fast), awkward → safe replacer.
  // When we did NOT inline-scan (non-stable mode, or the error slow path), defer to `jsonStringifyValue`
  // which runs its own `containsAwkwardValue` check.
  if (scanned) {
    return awkward ? jsonStringifySafe(flat) : JSON.stringify(flat);
  }
  return jsonStringifyValue(flat);
}

/**
 * Circular-safe, `bigint`/`undefined`-aware JSON serializer (extends `internal/jsonStringifyRecursive`).
 *
 * Key ordering is *not* this function's concern — {@link toFlatJsonObject} already emits the well-known
 * keys head-first and (when `json.stableKeyOrder` is on) sorts the user's fields and the `_meta` body.
 * This function only guarantees JSON-safety of the values:
 *
 * - Circular references are replaced with `"[Circular]"`.
 * - `bigint` is stringified (JSON has no bigint).
 * - `undefined` becomes `"[undefined]"` (matches the v4 replacer so explicit `undefined` fields survive).
 * - `Error` instances (e.g. an {@link IErrorObject}'s `nativeError`) are stripped to `undefined` so they
 *   do not serialize as an empty `{}`; the error's serializable `stack`/`name`/`message` are kept.
 *
 * @param value - the value to serialize (typically the flat object from {@link toFlatJsonObject}).
 * @returns the JSON string.
 *
 * @example
 * jsonStringifyValue({ a: 10n, b: undefined }); // '{"a":"10","b":"[undefined]"}'
 */
export function jsonStringifyValue(value: unknown): string {
  // The replacer-driven path below is correct but slow: V8 invokes the replacer for EVERY key, which on a
  // typical log record costs several times a plain `JSON.stringify`. The vast majority of records contain
  // no `bigint`, no circular reference, and no explicit `undefined` field — for those a plain stringify is
  // both correct and much faster. `containsAwkwardValue` cheaply scans the (already small, already built)
  // flat object once; only when it finds a value the fast path can't represent faithfully do we pay for the
  // safe replacer path. This keeps the hot prod path on native stringify while preserving v5's exact output
  // (bigint → string, circular → "[Circular]", undefined → "[undefined]", native Error dropped) when needed.
  if (!containsAwkwardValue(value)) {
    return JSON.stringify(value);
  }
  return jsonStringifySafe(value);
}

/**
 * Cheaply decide whether `value` holds anything native `JSON.stringify` would mishandle for our contract:
 * a `bigint` (throws), an explicit `undefined` own-value (silently dropped, but v5 emits `"[undefined]"`),
 * a native `Error` (would serialize as `{}`), or a circular reference (throws). Walks own-enumerable keys
 * with a `WeakSet` cycle guard and bails out (returns true) the instant it finds one.
 */
function containsAwkwardValue(value: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (typeof value === "bigint" || value === undefined) {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (value instanceof Error) {
    return true;
  }
  if (seen.has(value)) {
    return true; // circular
  }
  if (value instanceof Date) {
    return false; // Date stringifies fine (toJSON)
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (containsAwkwardValue(value[i], seen)) {
        return true;
      }
    }
    return false;
  }
  for (const key of Object.keys(value)) {
    if (containsAwkwardValue((value as Record<string, unknown>)[key], seen)) {
      return true;
    }
  }
  return false;
}

/** The robust serializer: handles bigint, circular refs, undefined, and native Error. Used only as a fallback. */
function jsonStringifySafe(value: unknown): string {
  const seen = new WeakSet<object>();
  const replacer = function (this: unknown, _key: string, val: unknown): unknown {
    if (typeof val === "bigint") {
      return `${val}`;
    }
    if (typeof val === "undefined") {
      return "[undefined]";
    }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) {
        return "[Circular]";
      }
      seen.add(val);
      // Drop native Error instances so they do not serialize as "{}". Carried alongside a serializable
      // stack/name/message on the IErrorObject, the native handle adds nothing JSON-safe.
      if (val instanceof Error) {
        return undefined;
      }
    }
    return val;
  };
  return JSON.stringify(value, replacer);
}

/**
 * Mutable single-bit accumulator: set `hit` once any value the fast native `JSON.stringify` can't faithfully
 * represent (a `bigint`, an explicit `undefined`, or a native `Error`) is seen during the {@link deepSortKeys}
 * walk. Circular references are NOT flagged: deepSortKeys already neutralizes them into `"[Circular]"`, so the
 * sorted copy native stringify receives is cycle-free and serializes correctly without the safe path.
 */
interface AwkFlag {
  hit: boolean;
}

/**
 * Return a deep, key-sorted copy of a value so a `stableKeyOrder` line is byte-reproducible. Plain
 * objects get their keys sorted recursively; arrays keep order but their elements are sorted; everything
 * else (primitives, Date, Error, class instances) passes through by reference. A `seen` set short-circuits
 * circular structures (replacing them with `"[Circular]"`) so this never recurses forever.
 *
 * When an {@link AwkFlag} `awk` is supplied, the walk also records — at no extra traversal cost — whether it
 * encountered a `bigint`, an explicit `undefined`, or a native `Error`, letting {@link renderJson} skip the
 * separate {@link containsAwkwardValue} scan and pick native vs. safe stringify directly.
 */
function deepSortKeys(value: unknown, awk?: AwkFlag, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value !== "object" || value === null) {
    if (awk !== undefined && (typeof value === "bigint" || value === undefined)) {
      awk.hit = true;
    }
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => deepSortKeys(item, awk, seen));
  }
  if (!isPlainObject(value)) {
    // Date passes through fine; a native Error would serialize as "{}" under native stringify, so flag it.
    if (awk !== undefined && value instanceof Error) {
      awk.hit = true;
    }
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = deepSortKeys((value as Record<string, unknown>)[key], awk, seen);
  }
  return sorted;
}

/** True for a plain object literal (not an array, Date, Error, or other class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (value instanceof Date || value instanceof Error) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Heuristically recognize a serialized {@link IErrorObject} produced by `core/logObj.ts#toErrorObject`
 * (it carries a `nativeError` Error plus `name`/`message`/`stack`). Plain user objects never match.
 */
function isErrorObject(value: unknown): value is IErrorObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate[ERROR_NATIVE_KEY] instanceof Error && typeof candidate.name === "string" && Array.isArray(candidate.stack);
}

/** Return a shallow copy of `record` without its meta property — used to test the record's own shape. */
function stripMeta(record: object, metaProperty: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (key !== metaProperty) {
      out[key] = (record as Record<string, unknown>)[key];
    }
  }
  return out;
}
