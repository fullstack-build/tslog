import type { IErrorObject, IStackFrame, LogContext, LogMiddleware } from "../../interfaces.js";

/**
 * Standard, runtime-agnostic value serializers for tslog (`tslog/serializers`).
 *
 * Each serializer is a pure `(value) => unknown` that normalizes a common shape — an `Error`, an HTTP
 * request, an HTTP response, or a user object — into a safe, log-friendly plain object. They never
 * mutate their input, redact obvious secrets, and have no import-time side effects, so they work the
 * same on Node, browsers, Deno, and Bun.
 *
 * Apply them per field with the {@link serialize} middleware helper:
 *
 * @example
 * import { Logger } from "tslog";
 * import { stdSerializers, serialize } from "tslog/serializers";
 *
 * const logger = new Logger();
 * logger.use(serialize({ err: stdSerializers.err, req: stdSerializers.req }));
 *
 * logger.error({ err: new Error("boom"), req }); // `err`/`req` are serialized in place
 */

/** A serializer: turns a raw value into a safe, log-friendly representation. */
export type Serializer = (value: unknown) => unknown;

/** The standard serializer map: one entry per well-known field name. */
export interface StdSerializers {
  /** Serializes an `Error` (following `.cause`) into a plain {@link IErrorObject}-shaped object. */
  err: Serializer;
  /** Serializes an HTTP request, redacting `authorization`/`cookie` headers. */
  req: Serializer;
  /** Serializes an HTTP response down to `statusCode`/`headers`. */
  res: Serializer;
  /** Serializes a user object, dropping obvious secret fields. */
  user: Serializer;
}

/** How deep to follow an `error.cause` chain before stopping (guards against pathological chains). */
const MAX_ERROR_CAUSE_DEPTH = 5;

/** Header names whose values are always redacted on a serialized request. */
const REDACTED_REQUEST_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

/** Field names dropped from a serialized user object. */
const USER_SECRET_KEYS = new Set([
  "password",
  "passwd",
  "pass",
  "secret",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "cookie",
  "sessionid",
  "session_id",
  "ssn",
  "creditcard",
  "credit_card",
  "cardnumber",
  "card_number",
  "cvv",
  "pin",
  "privatekey",
  "private_key",
]);

/** The placeholder written in place of a redacted value. */
const REDACTED = "[redacted]";

/** True for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for any native `Error` (handles cross-realm instances by walking the prototype name). */
function isError(value: unknown): value is Error {
  if (value instanceof Error) {
    return true;
  }
  if (!isPlainObject(value)) {
    return false;
  }
  // Error-like duck typing: a string message plus a string stack/name covers cross-realm and
  // serialized errors that lost their prototype.
  return (
    typeof (value as { message?: unknown }).message === "string" &&
    (typeof (value as { stack?: unknown }).stack === "string" || typeof (value as { name?: unknown }).name === "string")
  );
}

/**
 * Parse an error's `.stack` string into minimal, runtime-agnostic {@link IStackFrame}s. We intentionally
 * avoid the env-specific frame parser here so this module stays free of any runtime import: each
 * non-header stack line becomes a frame carrying the raw line under `method`.
 */
function parseStack(stack: unknown): IStackFrame[] {
  if (typeof stack !== "string" || stack.length === 0) {
    return [];
  }
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[A-Za-z.]*Error\b/.test(line))
    .map((line) => ({ method: line.replace(/^at\s+/, "") }));
}

/** Normalize a non-Error cause into an `Error` so the chain stays uniformly typed. */
function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  let message: string;
  try {
    message = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    message = String(value);
  }
  const error = new Error(message);
  if (isPlainObject(value)) {
    Object.assign(error, value);
  }
  return error;
}

/**
 * Convert an `Error` into a serializable {@link IErrorObject}, following `error.cause` up to
 * {@link MAX_ERROR_CAUSE_DEPTH} levels. A `seen` set short-circuits self-referential cause chains.
 */
function toErrorObject(error: Error, depth = 0, seen: Set<unknown> = new Set()): IErrorObject {
  seen.add(error);

  const errorObject: IErrorObject = {
    nativeError: error,
    name: error.name ?? "Error",
    message: error.message ?? "",
    stack: parseStack((error as { stack?: unknown }).stack),
  };

  if (depth >= MAX_ERROR_CAUSE_DEPTH) {
    return errorObject;
  }

  const causeValue = (error as { cause?: unknown }).cause;
  if (causeValue != null && !seen.has(causeValue)) {
    const normalizedCause = toError(causeValue);
    if (!seen.has(normalizedCause)) {
      errorObject.cause = toErrorObject(normalizedCause, depth + 1, seen);
    }
  }

  return errorObject;
}

/**
 * Redact sensitive headers from a (possibly `Headers`-instance, array, or plain) header bag, returning a
 * fresh plain object. Matching is case-insensitive; redacted values become {@link REDACTED}.
 */
function redactHeaders(headers: unknown): Record<string, unknown> | undefined {
  if (headers == null) {
    return undefined;
  }

  const entries: [string, unknown][] = [];

  // `Headers` (web fetch) and `Map` both expose forEach(value, key).
  if (typeof (headers as { forEach?: unknown }).forEach === "function" && !Array.isArray(headers)) {
    (headers as { forEach: (cb: (value: unknown, key: string) => void) => void }).forEach((value, key) => {
      entries.push([key, value]);
    });
  } else if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && entry.length >= 2) {
        entries.push([String(entry[0]), entry[1]]);
      }
    }
  } else if (isPlainObject(headers)) {
    for (const key of Object.keys(headers)) {
      entries.push([key, headers[key]]);
    }
  } else {
    return undefined;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    out[key] = REDACTED_REQUEST_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/** Pull the remote address from the common shapes used by Node `http`, Express, Koa, and fetch. */
function extractRemoteAddress(request: Record<string, unknown>): string | undefined {
  const direct = request.remoteAddress ?? request.ip;
  if (typeof direct === "string") {
    return direct;
  }
  const socket = request.socket ?? request.connection;
  if (isPlainObject(socket) && typeof socket.remoteAddress === "string") {
    return socket.remoteAddress;
  }
  return undefined;
}

/**
 * Serialize an `Error` (following `.cause`) into a plain {@link IErrorObject}. Non-Error values pass
 * through unchanged so the serializer is safe to apply to a field that may hold something else.
 */
export const err: Serializer = (value: unknown): unknown => {
  if (!isError(value)) {
    return value;
  }
  return toErrorObject(value instanceof Error ? value : toError(value));
};

/**
 * Serialize an HTTP request into `{ method, url, headers, remoteAddress }`, redacting the
 * `authorization`/`cookie` family of headers. Supports Node `http.IncomingMessage`, Express/Koa request
 * objects, and the web `Request`. Non-object values pass through unchanged.
 */
export const req: Serializer = (value: unknown): unknown => {
  if (!isPlainObject(value)) {
    return value;
  }

  const method = value.method;
  const url = value.url ?? value.originalUrl ?? value.path;
  const headers = redactHeaders(value.headers);
  const remoteAddress = extractRemoteAddress(value);

  const out: Record<string, unknown> = {};
  if (typeof method === "string") {
    out.method = method;
  }
  if (typeof url === "string") {
    out.url = url;
  }
  if (headers !== undefined) {
    out.headers = headers;
  }
  if (remoteAddress !== undefined) {
    out.remoteAddress = remoteAddress;
  }
  return out;
};

/**
 * Serialize an HTTP response into `{ statusCode, headers }`. Supports Node `http.ServerResponse`
 * (`statusCode`/`getHeaders()`), web `Response` (`status`/`headers`), and plain objects. Non-object
 * values pass through unchanged.
 */
export const res: Serializer = (value: unknown): unknown => {
  if (!isPlainObject(value)) {
    return value;
  }

  const statusCode = value.statusCode ?? value.status;

  let rawHeaders: unknown = value.headers;
  if (rawHeaders == null && typeof (value as { getHeaders?: unknown }).getHeaders === "function") {
    rawHeaders = (value as { getHeaders: () => unknown }).getHeaders();
  }
  const headers = redactHeaders(rawHeaders);

  const out: Record<string, unknown> = {};
  if (typeof statusCode === "number") {
    out.statusCode = statusCode;
  }
  if (headers !== undefined) {
    out.headers = headers;
  }
  return out;
};

/**
 * Serialize a user object: keep `id` and the remaining safe fields, but drop obvious secrets
 * (passwords, tokens, api keys, session ids, PII like `ssn`/card numbers). Matching is
 * case-insensitive. Non-object values pass through unchanged.
 */
export const user: Serializer = (value: unknown): unknown => {
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (USER_SECRET_KEYS.has(key.toLowerCase())) {
      continue;
    }
    out[key] = value[key];
  }
  return out;
};

/** The standard serializer map (`{ err, req, res, user }`). */
export const stdSerializers: StdSerializers = { err, req, res, user };

/**
 * Build a {@link LogMiddleware} that applies a `{ field: serializer }` map to every log call. For each
 * logged argument that is a plain object, any key present in `map` whose value is non-`undefined` is
 * replaced (in a shallow copy — the original argument is never mutated) by `serializer(value)`. Fields
 * not present on an argument, and arguments that are not plain objects, are left untouched.
 *
 * @example
 * logger.use(serialize(stdSerializers));               // apply all standard serializers
 * logger.use(serialize({ err: stdSerializers.err }));  // just the error serializer
 */
export function serialize<LogObj>(map: Record<string, Serializer>): LogMiddleware<LogObj> {
  const fields = Object.keys(map);
  return (context: LogContext<LogObj>): LogContext<LogObj> => {
    if (fields.length === 0) {
      return context;
    }
    context.args = context.args.map((arg) => {
      if (!isPlainObject(arg)) {
        return arg;
      }
      let copy: Record<string, unknown> | undefined;
      for (const field of fields) {
        if (Object.hasOwn(arg, field) && arg[field] !== undefined) {
          if (copy === undefined) {
            copy = { ...arg };
          }
          copy[field] = map[field](arg[field]);
        }
      }
      return copy ?? arg;
    });
    return context;
  };
}
