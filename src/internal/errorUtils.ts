import { buildStackTrace } from "../env/stackTrace.js";
import type { IErrorObject, IStackFrame } from "../interfaces.js";

type StackParser = (line: string) => IStackFrame | undefined;

export interface CollectCauseOptions {
  maxDepth?: number;
}

const DEFAULT_CAUSE_DEPTH = 5;

export function collectErrorCauses(error: unknown, options: CollectCauseOptions = {}): Error[] {
  const maxDepth = options.maxDepth ?? DEFAULT_CAUSE_DEPTH;
  const causes: Error[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current != null && depth < maxDepth) {
    const cause = safeGetCause(current);
    if (cause == null || visited.has(cause)) {
      break;
    }
    visited.add(cause);
    causes.push(toError(cause));
    current = cause;
    depth += 1;
  }

  return causes;
}

/**
 * Read a value's `cause` property without EVER throwing: `cause` is user-controlled and may be a
 * hostile getter/Proxy trap. Returns `undefined` on any failure so the pipeline degrades to
 * "no cause" instead of crashing the caller's `logger.error(...)`.
 */
export function safeGetCause(value: unknown): unknown {
  try {
    return (value as { cause?: unknown })?.cause;
  } catch {
    return undefined;
  }
}

/**
 * Read a string-valued own/inherited property (`name`/`message`) off an Error without throwing —
 * hostile getters may have been copied onto it from a user-supplied cause object. Non-string values
 * and throwing reads yield `fallback`.
 */
export function safeErrorString(error: Error, key: "name" | "message", fallback: string): string {
  try {
    const value = (error as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  const error = new Error(typeof value === "string" ? value : stringifyCause(value));
  if (typeof value === "object" && value != null) {
    copyOwnProperties(value, error);
  }
  return error;
}

/**
 * Stringify a non-Error `cause` value into an Error message without EVER throwing: a bare
 * `JSON.stringify` throws on circular references and BigInts, which would propagate out of
 * `logger.error(...)` into the application. Circular refs become `"[Circular]"`, BigInts are
 * stringified, and any remaining failure falls back to `String(value)`.
 */
function stringifyCause(value: unknown): string {
  try {
    // Ancestor-stack circular detection (à la json-stringify-safe): only a value that is its OWN
    // ancestor is a true cycle. A plain WeakSet would also mislabel shared sibling references
    // (e.g. { a: shared, b: shared }) as "[Circular]".
    const ancestors: object[] = [];
    const json = JSON.stringify(value, function (this: unknown, _key, val) {
      if (typeof val === "bigint") {
        return String(val);
      }
      if (val !== null && typeof val === "object") {
        // Pop back to the current holder, then check whether `val` is an ancestor of itself.
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
          ancestors.pop();
        }
        if (ancestors.includes(val)) {
          return "[Circular]";
        }
        ancestors.push(val);
      }
      return val;
    });
    // JSON.stringify returns undefined for e.g. a bare function/symbol — fall back to String(...).
    return json ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable cause]";
    }
  }
}

/**
 * Copy `value`'s own enumerable properties onto the normalized error, tolerating hostile inputs:
 * a throwing getter/Proxy trap skips that property, and `__proto__` is ignored so a poisoned cause
 * object cannot swap the error's prototype (a plain `Object.assign` would trigger the setter).
 */
function copyOwnProperties(value: object, target: Error): void {
  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch {
    return;
  }
  for (const key of keys) {
    if (key === "__proto__") {
      continue;
    }
    try {
      (target as unknown as Record<string, unknown>)[key] = (value as Record<string, unknown>)[key];
    } catch {
      // a throwing getter/trap on this property — skip it, keep the rest
    }
  }
}

export function toErrorObject(error: Error, parseLine: StackParser): IErrorObject {
  return {
    nativeError: error,
    name: safeErrorString(error, "name", "Error"),
    message: safeErrorString(error, "message", ""),
    stack: buildStackTrace(error, parseLine),
  };
}
