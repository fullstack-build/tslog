import { getBoundFieldsHint, getSpreadShapeHint } from "../core/logObj.js";
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
 *  - **Bare string** `log.info("hi")` → `{ [messageKey]: "hi" }`.
 *  - **Message + object** `log.info("hi", { userId: 42 })` — a leading string with a SINGLE trailing
 *    plain object — spreads the object's fields at the top level, symmetric with the pino shape below.
 *  - With two or more trailing values (`log.info("hi", a, b)`) the extra args are bucketed under
 *    {@link ISettings.argumentsArrayName} when set, otherwise under numeric keys `"1"`, `"2"`, …
 *    (the string keeps `messageKey`).
 *  - **Single object** `log.info({ userId: 42 })` → its keys are spread at the top level.
 *  - **Object + message** `log.info({ userId: 42 }, "hi")` (pino-style) → `{ [messageKey]: "hi",
 *    userId: 42 }`: the object's fields spread at the top level and the trailing string lands under
 *    `messageKey`.
 *  - **Positional** `log.info("a", "b")` with no leading object → `{ [messageKey]: "a", "1": "b" }`
 *    (or all under `argumentsArrayName` when set).
 *  - **Errors** anywhere in the args are collected under `errorKey` (a single Error → the object; two or
 *    more → an array), serialized as a JSON-safe {@link IErrorObject} with the `cause` chain preserved.
 *  - **Reserved head keys**: user fields named like `levelKey`/`levelIdKey`/`timeKey` are dropped from
 *    the flat line — the canonical head values always win (the raw record keeps the field for transports).
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
  let messageFirst = false;
  if (!recordIsSpreadError) {
    // The two field-spreading call shapes — pino object-first (`{fields}, "msg"`) and the symmetric
    // message-first (`"msg", {fields}`) — are recognized via the SPREAD_SHAPE_HINT that toLogObj set
    // when the CALL was literally a string paired with a single PLAIN object. Sniffing the record's
    // shape alone would misfire on a single logged object with numeric keys.
    const spreadShape = hasMessageKey ? undefined : getSpreadShapeHint(recordObj);
    pinoLeading = spreadShape === "object-first" && typeof recordObj["0"] === "object" && recordObj["0"] !== null && !isErrorObject(recordObj["0"]);
    messageFirst = spreadShape === "message-first" && typeof recordObj["1"] === "object" && recordObj["1"] !== null && !isErrorObject(recordObj["1"]);
    if (!pinoLeading && !messageFirst) {
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

  // Fast path: no spread error, no embedded error, no pino/message-first pattern. Build `flat` directly
  // in documented head-first order, copying plain user fields straight from the record (sorted +
  // deep-sorted in stable mode) without ever materializing `userFields`/`errors`.
  if (!recordIsSpreadError && !sawEmbeddedError && !pinoLeading && !messageFirst) {
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
    // User fields: every record key except meta, whichever key supplied the message, and the reserved
    // head keys (level/levelId/time are canonical — a colliding user field must not corrupt them).
    // Collect them only if any exist (the bare-message hot path has none, so we skip the array
    // allocation + sort entirely).
    let fieldKeys: string[] | undefined;
    for (let i = 0; i < recordKeys.length; i++) {
      const key = recordKeys[i];
      // "__proto__" is skipped: a plain assignment would trigger the prototype setter instead of
      // creating an own key, so it could never be emitted faithfully — drop it on every path.
      if (key === metaProperty || key === messageSourceKey || key === "__proto__" || isReservedHeadKey(key, json)) {
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
    // Bound fields were carried aside for this shape (merging them into the error root would bury
    // them in the error payload) — emit them as regular top-level user fields instead.
    const boundFields = getBoundFieldsHint(recordObj);
    if (boundFields != null) {
      for (const key of Object.keys(boundFields)) {
        if (key === "__proto__" || key === metaProperty || Object.hasOwn(userFields, key)) {
          continue;
        }
        userFields[key] = boundFields[key];
      }
    }
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
    // "__proto__" and the meta property are never spread (an assignment would hit the prototype setter).
    for (const [k, v] of Object.entries(leadingObject)) {
      if (k !== "__proto__" && k !== metaProperty && !Object.hasOwn(userFields, k)) {
        userFields[k] = v;
      }
    }
    userFields[json.messageKey] = promotedMessage;
  }

  // Message-first `log.info("msg", { fields })`: promote the leading string to messageKey and spread the
  // trailing object's fields at the top level — symmetric with the pino object-first shape above.
  if (messageFirst) {
    const promotedMessage = userFields["0"];
    delete userFields["0"];
    const trailingObject = userFields["1"] as Record<string, unknown>;
    delete userFields["1"];
    for (const [k, v] of Object.entries(trailingObject)) {
      if (k !== "__proto__" && k !== metaProperty && !Object.hasOwn(userFields, k)) {
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
  // same fields in a different insertion order produce byte-identical lines. Reserved head keys are
  // skipped — the canonical level/levelId/time written by writeHead always win.
  const fieldKeys = stable ? Object.keys(userFields).sort() : Object.keys(userFields);
  for (const key of fieldKeys) {
    if (key === "__proto__" || isReservedHeadKey(key, json)) {
      continue;
    }
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
 * Whether `key` is one of the reserved head keys written by {@link writeHead}. User fields with these
 * names are dropped from the flat line (one uniform policy: canonical head values always win; the raw
 * record still carries the field for transports). `levelIdKey` is only reserved while `numericLevel`
 * actually emits it.
 */
function isReservedHeadKey<LogObj>(key: string, json: ISettings<LogObj>["json"]): boolean {
  return key === json.levelKey || key === json.timeKey || (json.numericLevel && key === json.levelIdKey);
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
  // Hot path: assemble the line from per-logger precompiled fragments (static `_meta`, per-level head)
  // so the content that never changes between calls is serialized once, not on every log. Falls back
  // to the object-building path for any shape the plan does not cover.
  if (!settings.json.stableKeyOrder) {
    const fastLine = renderPlannedLine(record, settings);
    if (fastLine !== undefined) {
      return fastLine;
    }
  }
  return renderJsonUnplanned(record, settings);
}

/**
 * The plan-free JSON rendering path: identical output to {@link renderJson}, without the precompiled
 * line-plan machinery. This is the renderer size-sensitive entries (`tslog/slim`) inject — importing it
 * lets a bundler tree-shake the whole plan compiler — and the fallback {@link renderJson} itself uses
 * for shapes the plan does not cover. Byte-identity between the two paths is pinned by the differential
 * suite (tests/56).
 */
export function renderJsonUnplanned<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): string {
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

/* ------------------------------------------------------------------------------------------------ */
/* Precompiled line plan                                                                             */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Per-logger precompiled JSON fragments. The static `_meta` block (v/runtime/hostname/name/…) and the
 * per-level head (`"level":"INFO","levelId":3`) never change between calls, yet the object-building
 * path re-copied and re-serialized them on every log — a large share of the per-line cost. The plan
 * serializes them ONCE; per call only the message, the user's fields, and the two timestamps are
 * stringified. Cached per resolved-settings object (sub-loggers get their own), revalidated cheaply on
 * every call so live settings mutations and per-record meta additions (async-context fields, stack
 * `path`) fall back to the full path instead of emitting stale fragments.
 */
interface JsonLinePlan {
  /** Snapshot of the json key config the fragments were built from; a mismatch rebuilds the plan. */
  messageKey: string;
  levelKey: string;
  levelIdKey: string;
  timeKey: string;
  numericLevel: boolean;
  metaProperty: string;
  /** `JSON.stringify(messageKey) + ":"`, precomputed. */
  messagePrefix: string;
  /** The static meta entries (key + expected value) validated by strict equality on every call. */
  staticEntries: { key: string; value: unknown }[];
  /** Expected number of own enumerable meta keys; extra keys (context fields, `path`) → fallback. */
  metaKeyCount: number;
  /**
   * The `_meta` fragment as segments faithful to the OBSERVED meta key order: literal pieces
   * interleaved with the three dynamic value slots. Per-level chunks concatenate the segments once,
   * leaving only the `date` slot open (it splits `metaBefore`/`metaAfter`).
   */
  metaSegments: (string | { dyn: "date" | "levelId" | "levelName" })[];
  /** Lazily built per-level chunks, keyed by `logLevelId|logLevelName`. */
  levelChunks: Map<string, { head: string; metaBefore: string; metaAfter: string }>;
}

/** Plans per resolved-settings object; `false` marks a logger whose meta shape can never be planned. */
const linePlanCache = new WeakMap<object, JsonLinePlan | false>();

/** Meta keys that are static per logger instance and JSON-serializable once at plan-build time. */
const STATIC_META_KEYS = new Set(["runtime", "runtimeVersion", "hostname", "browser", "name", "parentNames"]);

/** Array-index-like keys are hoisted first by JS object enumeration — the plan bails on them. */
const INTEGER_KEY = /^(?:0|[1-9]\d*)$/;

/** Cheap integer-like-key test: one charCode compare for the common non-digit-leading key. */
function isIntegerLikeKey(key: string): boolean {
  const first = key.charCodeAt(0);
  if (first < 48 || first > 57) {
    return false;
  }
  return INTEGER_KEY.test(key);
}

/** Whether a static meta value can be serialized once at plan-build time (JSON-stable primitives). */
function isPlanStaticValue(value: unknown): boolean {
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean" || value === null) {
    return true;
  }
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Build a plan from an eligible record's meta, or return `null`/`false` (false = never plannable). */
function buildLinePlan<LogObj>(meta: IMeta, settings: ISettings<LogObj>): JsonLinePlan | false | null {
  const json = settings.json;
  // A messageKey colliding with a head key (or the meta property) has bespoke overwrite semantics on
  // the object path — never plannable.
  if (
    json.messageKey === json.levelKey ||
    json.messageKey === json.timeKey ||
    (json.numericLevel && json.messageKey === json.levelIdKey) ||
    json.messageKey === settings.meta.property
  ) {
    return false;
  }

  const staticEntries: { key: string; value: unknown }[] = [];
  const metaSegments: (string | { dyn: "date" | "levelId" | "levelName" })[] = [];
  let literal = `,${JSON.stringify(settings.meta.property)}:{"v":${JSON_SCHEMA_VERSION}`;
  let sawDate = 0;
  let sawLevelId = 0;
  let sawLevelName = 0;
  let keyCount = 0;
  for (const key of Object.keys(meta as unknown as Record<string, unknown>)) {
    keyCount++;
    if (key === "date") {
      literal += `,"date":"`;
      metaSegments.push(literal, { dyn: "date" });
      literal = `"`;
      sawDate++;
      continue;
    }
    if (key === "logLevelId") {
      literal += `,"logLevelId":`;
      metaSegments.push(literal, { dyn: "levelId" });
      literal = "";
      sawLevelId++;
      continue;
    }
    if (key === "logLevelName") {
      literal += `,"logLevelName":`;
      metaSegments.push(literal, { dyn: "levelName" });
      literal = "";
      sawLevelName++;
      continue;
    }
    if (!STATIC_META_KEYS.has(key)) {
      // `path` (stack capture on) means every record of this logger is unplannable; any other unknown
      // key is record-specific (async-context fields) — retry on the next record.
      return key === "path" ? false : null;
    }
    const value = (meta as unknown as Record<string, unknown>)[key];
    if (!isPlanStaticValue(value)) {
      return false;
    }
    staticEntries.push({ key, value });
    literal += `,${JSON.stringify(key)}:${JSON.stringify(value)}`;
  }
  if (sawDate !== 1 || sawLevelId !== 1 || sawLevelName !== 1) {
    return false;
  }
  metaSegments.push(`${literal}}`);

  return {
    messageKey: json.messageKey,
    levelKey: json.levelKey,
    levelIdKey: json.levelIdKey,
    timeKey: json.timeKey,
    numericLevel: json.numericLevel,
    metaProperty: settings.meta.property,
    messagePrefix: `${JSON.stringify(json.messageKey)}:`,
    staticEntries,
    metaKeyCount: keyCount,
    metaSegments,
    levelChunks: new Map(),
  };
}

/** Whether the cached plan still matches the live settings (key renames rebuild the plan). */
function planMatchesSettings<LogObj>(plan: JsonLinePlan, settings: ISettings<LogObj>): boolean {
  const json = settings.json;
  return (
    plan.messageKey === json.messageKey &&
    plan.levelKey === json.levelKey &&
    plan.levelIdKey === json.levelIdKey &&
    plan.timeKey === json.timeKey &&
    plan.numericLevel === json.numericLevel &&
    plan.metaProperty === settings.meta.property
  );
}

/** Serialize one user field value; `undefined` means "skip this key" (functions/symbols, like native stringify). */
function stringifyFieldValue(value: unknown): string | undefined {
  if (value === undefined) {
    return '"[undefined]"';
  }
  return jsonStringifyValue(value) as string | undefined;
}

/**
 * TEST-ONLY probe: whether a usable line plan is currently cached for these resolved settings. The
 * differential suite uses it to assert the planned path actually fired (a silent fallback would make
 * the byte-identity tests vacuous).
 */
export function __linePlanActive(settings: object): boolean {
  const plan = linePlanCache.get(settings);
  return plan !== undefined && plan !== false;
}

/**
 * Render the flat line directly from the precompiled plan. Returns `undefined` for any record shape
 * the plan does not cover (embedded/spread errors, integer-like field keys, extra meta keys,
 * missing/invalid meta) — the caller then takes the object-building path, which handles everything.
 */
function renderPlannedLine<LogObj>(record: LogObj & ILogObjMeta, settings: ISettings<LogObj>): string | undefined {
  const metaProperty = settings.meta.property;
  const meta = record[metaProperty] as unknown as IMeta | undefined;
  if (meta == null || !(meta.date instanceof Date)) {
    return undefined;
  }

  let plan = linePlanCache.get(settings as unknown as object);
  if (plan === false) {
    return undefined;
  }
  if (plan === undefined || !planMatchesSettings(plan, settings)) {
    const built = buildLinePlan(meta, settings);
    if (built === null) {
      return undefined;
    }
    linePlanCache.set(settings as unknown as object, built);
    if (built === false) {
      return undefined;
    }
    plan = built;
  }

  // Validate this record's meta against the plan without allocating: same key count (extra keys =
  // context fields → fallback) and identical static values (hostname/name/… unchanged).
  let metaKeyCount = 0;
  for (const _key in meta as unknown as Record<string, unknown>) {
    metaKeyCount++;
  }
  if (metaKeyCount !== plan.metaKeyCount) {
    return undefined;
  }
  for (let i = 0; i < plan.staticEntries.length; i++) {
    const entry = plan.staticEntries[i];
    if ((meta as unknown as Record<string, unknown>)[entry.key] !== entry.value) {
      return undefined;
    }
  }

  const recordObj = record as Record<string, unknown>;
  // A spread lone Error satisfies the IErrorObject shape on the record itself → slow path.
  if (recordObj[ERROR_NATIVE_KEY] instanceof Error) {
    return undefined;
  }

  // Classify the record's keys, mirroring buildFlat's rules. The two field-spreading call shapes are
  // recognized via the SPREAD_SHAPE_HINT toLogObj set (plain-object + string pairs only) and emitted
  // inline below in the same order the object path produces.
  const json = settings.json;
  const hasMessageKey = Object.hasOwn(recordObj, json.messageKey);
  let messageSourceKey = hasMessageKey ? json.messageKey : Object.hasOwn(recordObj, "0") ? "0" : undefined;
  let messageValue = messageSourceKey !== undefined ? recordObj[messageSourceKey] : undefined;
  let spreadSource: Record<string, unknown> | undefined;
  const spreadShape = hasMessageKey ? undefined : getSpreadShapeHint(recordObj);
  if (spreadShape !== undefined) {
    const leading = recordObj["0"];
    const trailing = recordObj["1"];
    if (spreadShape === "object-first" && typeof leading === "object" && leading !== null) {
      messageValue = trailing;
      spreadSource = leading as Record<string, unknown>;
    } else if (spreadShape === "message-first" && typeof trailing === "object" && trailing !== null) {
      messageValue = leading;
      spreadSource = trailing as Record<string, unknown>;
    }
  }
  const spreading = spreadSource !== undefined;
  if (spreading) {
    messageSourceKey = json.messageKey;
  }

  const levelId = meta.logLevelId;
  const levelName = meta.logLevelName;
  const chunkKey = `${levelId}|${levelName}`;
  let chunk = plan.levelChunks.get(chunkKey);
  if (chunk === undefined) {
    const head =
      `${JSON.stringify(plan.levelKey)}:${JSON.stringify(levelName)}` +
      `${plan.numericLevel ? `,${JSON.stringify(plan.levelIdKey)}:${JSON.stringify(levelId)}` : ""},${JSON.stringify(plan.timeKey)}:"`;
    // Concatenate the meta segments once per level, leaving the `date` slot as the before/after split.
    let metaBefore = "";
    let metaAfter = "";
    let pastDate = false;
    for (const segment of plan.metaSegments) {
      const piece =
        typeof segment === "string"
          ? segment
          : segment.dyn === "levelId"
            ? JSON.stringify(levelId)
            : segment.dyn === "levelName"
              ? JSON.stringify(levelName)
              : undefined;
      if (piece === undefined) {
        pastDate = true;
        continue;
      }
      if (pastDate) {
        metaAfter += piece;
      } else {
        metaBefore += piece;
      }
    }
    chunk = { head, metaBefore, metaAfter };
    plan.levelChunks.set(chunkKey, chunk);
  }

  const iso = toIsoString(meta.date);
  let line = "{";
  if (messageSourceKey !== undefined) {
    const messageJson = stringifyFieldValue(messageValue);
    if (messageJson !== undefined) {
      line += `${plan.messagePrefix}${messageJson},`;
    }
  }
  line += `${chunk.head}${iso}"`;

  // User fields: everything except meta, the message source (and the two positional keys consumed by a
  // spread shape), "__proto__", and the reserved head keys. Integer-like keys would be hoisted first by
  // the object path's JS enumeration order, and an embedded serialized error would need errorKey
  // nesting — both → slow path.
  const recordKeys = Object.keys(recordObj);
  for (let i = 0; i < recordKeys.length; i++) {
    const key = recordKeys[i];
    if (key === metaProperty || key === messageSourceKey || key === "__proto__" || isReservedHeadKey(key, json)) {
      continue;
    }
    if (spreading && (key === "0" || key === "1")) {
      continue;
    }
    if (isIntegerLikeKey(key)) {
      return undefined;
    }
    const value = recordObj[key];
    if (isErrorObject(value)) {
      return undefined;
    }
    const valueJson = stringifyFieldValue(value);
    if (valueJson === undefined) {
      continue;
    }
    line += `,${JSON.stringify(key)}:${valueJson}`;
  }

  // The spread shape's fields, in the same order and with the same collision rules as the
  // object-building path: existing record fields win, the promoted message wins over a field named
  // like the message key, and integer-like keys bail (hoisting divergence).
  if (spreadSource !== undefined) {
    for (const key of Object.keys(spreadSource)) {
      if (key === json.messageKey || key === "__proto__" || key === metaProperty || isReservedHeadKey(key, json)) {
        continue;
      }
      if (Object.hasOwn(recordObj, key) && key !== "0" && key !== "1") {
        continue;
      }
      if (isIntegerLikeKey(key)) {
        return undefined;
      }
      const valueJson = stringifyFieldValue(spreadSource[key]);
      if (valueJson === undefined) {
        continue;
      }
      line += `,${JSON.stringify(key)}:${valueJson}`;
    }
  }

  return `${line + chunk.metaBefore + iso + chunk.metaAfter}}`;
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
function containsAwkwardValue(value: unknown, ancestors: WeakSet<object> = new WeakSet()): boolean {
  if (typeof value === "bigint" || value === undefined) {
    return true;
  }
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (value instanceof Error) {
    return true;
  }
  // Ancestor-chain detection: only a value that contains ITSELF is a true cycle. A node is removed
  // from the set once its subtree is done, so a shared sibling reference (the same object reachable
  // twice through different fields) is NOT flagged and serializes in full on every path.
  if (ancestors.has(value)) {
    return true; // circular
  }
  if (value instanceof Date) {
    return false; // Date stringifies fine (toJSON)
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (containsAwkwardValue(value[i], ancestors)) {
        return true;
      }
    }
    ancestors.delete(value);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (containsAwkwardValue((value as Record<string, unknown>)[key], ancestors)) {
      return true;
    }
  }
  ancestors.delete(value);
  return false;
}

/** The robust serializer: handles bigint, circular refs, undefined, and native Error. Used only as a fallback. */
function jsonStringifySafe(value: unknown): string {
  // Ancestor-stack circular detection (mirrors containsAwkwardValue): pop back to the current holder,
  // then a value that is its own ancestor is a true cycle — shared sibling references serialize fully.
  const ancestors: object[] = [];
  const replacer = function (this: unknown, _key: string, val: unknown): unknown {
    if (typeof val === "bigint") {
      return `${val}`;
    }
    if (typeof val === "undefined") {
      return "[undefined]";
    }
    if (typeof val === "object" && val !== null) {
      // Drop native Error instances so they do not serialize as "{}". Carried alongside a serializable
      // stack/name/message on the IErrorObject, the native handle adds nothing JSON-safe.
      if (val instanceof Error) {
        return undefined;
      }
      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }
      if (ancestors.includes(val)) {
        return "[Circular]";
      }
      ancestors.push(val);
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
  // Ancestor-chain detection (delete on exit): shared sibling references sort/serialize fully; only
  // a true cycle collapses to "[Circular]".
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (!isPlainObject(value) && !Array.isArray(value)) {
    // Date passes through fine; a native Error would serialize as "{}" under native stringify, so flag it.
    if (awk !== undefined && value instanceof Error) {
      awk.hit = true;
    }
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const mapped = value.map((item) => deepSortKeys(item, awk, seen));
    seen.delete(value);
    return mapped;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = deepSortKeys((value as Record<string, unknown>)[key], awk, seen);
  }
  seen.delete(value);
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
