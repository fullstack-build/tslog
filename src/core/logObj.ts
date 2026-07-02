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
 * Builds the final log object from the (already masked) call arguments.
 *
 * - Every Error argument is replaced by its serializable {@link IErrorObject} form.
 * - When `argumentsArrayName` is set, all args are stored under that single key.
 * - Otherwise, a lone object/array/primitive argument is merged into the cloned default LogObj
 *   (objects spread directly; a non-mergeable single value is keyed under `"0"`), while multiple
 *   args are spread index-keyed (`0`, `1`, …). The cloned default LogObj always wins on key
 *   collisions, matching the monolith's `{ ...args[0], ...clonedLogObj }` ordering.
 */
export function toLogObj<LogObj>(args: unknown[], argumentsArrayName: string | undefined, deps: LogObjDeps, clonedLogObj: LogObj = {} as LogObj): LogObj {
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
  return clonedLogObj;
}
