import type { IErrorObject, IStackFrame } from "../interfaces.js";
import { safeErrorString, safeGetCause, toError } from "../internal/errorUtils.js";

/**
 * Runtime-agnostic dependencies the log-object builders need. The monolith reached for the
 * module-level `runtime` singleton (`runtime.isError`, `runtime.isBuffer`, `runtime.getErrorTrace`);
 * extracting those reads into explicit parameters keeps this module free of any environment import
 * so it works identically on Node, browsers, Deno, and Bun.
 */
export interface LogObjDeps {
  /** Recognizes native errors (incl. cross-realm and Error-like objects). Mirrors `runtime.isError`. */
  isError: (value: unknown) => value is Error;
  /** Recognizes Node Buffers (always `false` where Buffer is unavailable). Mirrors `runtime.isBuffer`. */
  isBuffer: (value: unknown) => boolean;
  /** Parses an error into stack frames. Mirrors `runtime.getErrorTrace`. */
  getErrorTrace: (error: Error) => IStackFrame[];
  /** Maximum depth to follow the `error.cause` chain before stopping. */
  maxErrorCauseDepth: number;
}

/** True for any non-null object or array. */
export function isObjectOrArray(value: unknown): value is object | unknown[] {
  return typeof value === "object" && value !== null;
}

/** True for plain (non-array) non-null objects. */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && !Array.isArray(value) && value !== null;
}

/** Returns a one-level copy of an array or object, preserving its container kind. */
export function shallowCopy<T>(source: T): T {
  if (Array.isArray(source)) {
    return [...source] as unknown as T;
  } else {
    return { ...source } as unknown as T;
  }
}

/**
 * Clones an error by re-instantiating its constructor and copying every own property across.
 * Used so masking/cloning never mutates the caller's original error instance.
 */
export function cloneError<T extends Error>(error: T): T {
  const cloned = new (error.constructor as { new (): T })();

  Object.getOwnPropertyNames(error).forEach((key) => {
    (cloned as Record<string, unknown>)[key] = (error as Record<string, unknown>)[key];
  });

  return cloned;
}

/**
 * Deeply clones a value while executing any zero-purpose field that is a function (e.g. a `requestId`
 * generator on the default LogObj), so every log gets a freshly evaluated value. Arrays and Dates are
 * cloned; objects are rebuilt preserving prototype and property descriptors; primitives pass through.
 * Circular references are short-circuited with a shallow copy via a `seen` list.
 */
export function recursiveCloneAndExecuteFunctions<T>(source: T, seen: (object | Array<unknown>)[] = []): T {
  if (isObjectOrArray(source) && seen.includes(source)) {
    return shallowCopy(source);
  }

  if (isObjectOrArray(source)) {
    seen.push(source);
  }

  if (Array.isArray(source)) {
    return source.map((item) => recursiveCloneAndExecuteFunctions(item, seen)) as unknown as T;
  } else if (source instanceof Date) {
    return new Date(source.getTime()) as unknown as T;
  } else if (isObject(source)) {
    return Object.getOwnPropertyNames(source).reduce(
      (o, prop) => {
        const descriptor = Object.getOwnPropertyDescriptor(source, prop);
        if (descriptor) {
          Object.defineProperty(o, prop, descriptor);
          const value = (source as Record<string, unknown>)[prop];
          o[prop] = typeof value === "function" ? value() : recursiveCloneAndExecuteFunctions(value, seen);
        }
        return o;
      },
      Object.create(Object.getPrototypeOf(source)),
    ) as T;
  } else {
    return source;
  }
}

/**
 * Converts a native error into a serializable {@link IErrorObject}, following the `error.cause` chain
 * up to `deps.maxErrorCauseDepth` levels. Non-Error causes are normalized via {@link toError}, and a
 * `seen` set prevents infinite loops on self-referential cause chains.
 */
export function toErrorObject(error: Error, deps: LogObjDeps, depth = 0, seen: Set<Error> = new Set()): IErrorObject {
  if (!seen.has(error)) {
    seen.add(error);
  }

  const errorObject: IErrorObject = {
    nativeError: error,
    name: safeErrorString(error, "name", "Error"),
    message: safeErrorString(error, "message", ""),
    stack: deps.getErrorTrace(error),
  };

  if (depth >= deps.maxErrorCauseDepth) {
    return errorObject;
  }

  const causeValue = safeGetCause(error);
  if (causeValue != null) {
    const normalizedCause = toError(causeValue);
    if (!seen.has(normalizedCause)) {
      errorObject.cause = toErrorObject(normalizedCause, deps, depth + 1, seen);
    }
  }

  return errorObject;
}

/**
 * Symbol-keyed marker set on a record whose CALL SHAPE was exactly one of the two field-spreading
 * forms: pino object-first (`log.info({fields}, "msg")`) or message-first (`log.info("msg", {fields})`),
 * with a genuinely PLAIN object. The JSON renderer spreads the object's fields at the top level only
 * when this hint is present — shape-sniffing the record alone cannot distinguish those calls from a
 * single logged object that happens to have numeric keys (`log.info({0: "a", 1: {…}})`).
 */
export const SPREAD_SHAPE_HINT: unique symbol = Symbol("tslog.logObj.spreadShape");

/** The two hinted spread shapes (see {@link SPREAD_SHAPE_HINT}). */
export type TSpreadShape = "message-first" | "object-first";

/** Read the spread-shape hint off a record, if the call shape set one. */
export function getSpreadShapeHint(record: object): TSpreadShape | undefined {
  return (record as Record<symbol, TSpreadShape | undefined>)[SPREAD_SHAPE_HINT];
}

/** True for a plain object literal (prototype is `Object.prototype` or `null`) — the only spreadable shape. */
function isPlainSpreadObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Builds the final log object from the (already masked) call arguments.
 *
 * - Every Error argument is replaced by its serializable {@link IErrorObject} form.
 * - When `argumentsArrayName` is set, all args are stored under that single key.
 * - Otherwise, a lone object/array/primitive argument is merged into the cloned default LogObj
 *   (objects spread directly; a non-mergeable single value is keyed under `"0"`), while multiple
 *   args are spread index-keyed (`0`, `1`, …). The cloned default LogObj always wins on key
 *   collisions, matching the monolith's `{ ...args[0], ...clonedLogObj }` ordering.
 * - A two-argument call pairing a string message with a single PLAIN object (either order) tags the
 *   record with {@link SPREAD_SHAPE_HINT} so the JSON renderer can spread the object's fields at the
 *   top level; Buffers, Maps, Sets, class instances and arrays keep their positional bucket so their
 *   own serialization semantics (`toJSON`, inspect) stay intact.
 */
export function toLogObj<LogObj>(args: unknown[], argumentsArrayName: string | undefined, deps: LogObjDeps, clonedLogObj: LogObj = {} as LogObj): LogObj {
  // Detect the spread shapes on the ORIGINAL args, before the Error mapping below turns a logged
  // Error into a plain serializable object that would wrongly qualify as spreadable fields.
  let spreadShape: TSpreadShape | undefined;
  if (argumentsArrayName == null && args.length === 2 && !deps.isError(args[0]) && !deps.isError(args[1])) {
    if (typeof args[0] === "string" && isPlainSpreadObject(args[1]) && deps.isBuffer(args[1]) !== true) {
      spreadShape = "message-first";
    } else if (isPlainSpreadObject(args[0]) && deps.isBuffer(args[0]) !== true && typeof args[1] === "string") {
      spreadShape = "object-first";
    }
  }
  args = args?.map((arg) => (deps.isError(arg) ? toErrorObject(arg as Error, deps) : arg));
  if (argumentsArrayName == null) {
    if (args.length === 1 && !Array.isArray(args[0]) && deps.isBuffer(args[0]) !== true && !(args[0] instanceof Date)) {
      clonedLogObj = typeof args[0] === "object" && args[0] != null ? { ...args[0], ...clonedLogObj } : { 0: args[0], ...clonedLogObj };
    } else {
      clonedLogObj = { ...clonedLogObj, ...args };
    }
  } else {
    clonedLogObj = {
      ...clonedLogObj,
      [argumentsArrayName]: args,
    };
  }
  if (spreadShape !== undefined) {
    // A plain symbol-keyed assignment: invisible to Object.keys/JSON/for..in, yet carried forward by
    // the `{ ...logObj }` spread that attaches `_meta` (spreads copy enumerable symbol keys) — no
    // per-call defineProperty cost, no explicit re-attach step.
    (clonedLogObj as Record<symbol, unknown>)[SPREAD_SHAPE_HINT] = spreadShape;
  }
  return clonedLogObj;
}
