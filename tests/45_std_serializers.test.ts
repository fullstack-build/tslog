import { Logger } from "../src/index.js";
import { err, req, res, serialize, stdSerializers, user } from "../src/subpaths/serializers/std.js";

// Tests for the standard serializers subpath (`tslog/serializers`): err/req/res/user value
// serializers plus the `serialize(map)` middleware helper.

describe("stdSerializers.err", () => {
  test("serializes an Error into an IErrorObject shape", () => {
    const error = new Error("boom");
    const out = err(error) as Record<string, unknown>;

    expect(out.name).toBe("Error");
    expect(out.message).toBe("boom");
    expect(out.nativeError).toBe(error);
    expect(Array.isArray(out.stack)).toBe(true);
  });

  test("follows the .cause chain", () => {
    const root = new Error("root cause");
    const wrapped = new Error("outer", { cause: root });
    const out = err(wrapped) as Record<string, unknown>;

    expect(out.message).toBe("outer");
    const cause = out.cause as Record<string, unknown>;
    expect(cause).toBeDefined();
    expect(cause.message).toBe("root cause");
    expect(cause.nativeError).toBe(root);
  });

  test("normalizes a non-Error cause", () => {
    const wrapped = new Error("outer", { cause: "string cause" });
    const out = err(wrapped) as Record<string, unknown>;
    const cause = out.cause as Record<string, unknown>;

    expect(cause.message).toBe("string cause");
    expect(cause.nativeError).toBeInstanceOf(Error);
  });

  test("does not loop on a self-referential cause", () => {
    const error = new Error("self") as Error & { cause?: unknown };
    error.cause = error;
    const out = err(error) as Record<string, unknown>;

    expect(out.message).toBe("self");
    // The cause is `error` itself, already seen -> no nested cause emitted.
    expect(out.cause).toBeUndefined();
  });

  test("passes through a non-Error value unchanged", () => {
    expect(err("not an error")).toBe("not an error");
    expect(err(42)).toBe(42);
  });

  test("stack frames carry the trimmed source line and drop the header", () => {
    const error = new Error("frames");
    error.stack = "Error: frames\n    at fnA (/a.js:1:1)\n    at fnB (/b.js:2:2)";
    const out = err(error) as Record<string, unknown>;
    const stack = out.stack as { method?: string }[];

    expect(stack).toEqual([{ method: "fnA (/a.js:1:1)" }, { method: "fnB (/b.js:2:2)" }]);
  });

  test("serializes a duck-typed error-like (not an Error instance) via its native handle", () => {
    // A cross-realm / prototype-lost error still duck-types as an error (string message + string
    // stack or name), so err() normalizes it into an IErrorObject instead of passing it through.
    const errorLike = { message: "duck", name: "DuckError", stack: "DuckError: duck\n    at f (/a.js:1:1)" };
    const out = err(errorLike) as Record<string, unknown>;

    expect(out.name).toBe("DuckError");
    expect(out.message).toBe("duck");
    // toError wraps the error-like into a real Error and copies its fields, so nativeError is an Error.
    expect(out.nativeError).toBeInstanceOf(Error);
    expect(out.stack).toEqual([{ method: "f (/a.js:1:1)" }]);
  });

  test("duck-types an error-like carrying only a string stack (no name)", () => {
    // isError accepts `message` + a string `stack` even without a string `name`.
    const errorLike = { message: "m", stack: "Error: m\n    at g (/b.js:2:2)" };
    const out = err(errorLike) as Record<string, unknown>;
    expect(out.message).toBe("m");
    expect(out.nativeError).toBeInstanceOf(Error);
  });

  test("duck-types an error-like carrying only a string name (no stack)", () => {
    // The other half of isError's OR: a string message + a string name, with no stack property.
    // toError wraps it into a fresh Error (which captures its own stack), copying the name field over.
    const errorLike = { message: "m2", name: "NoStackError" };
    const out = err(errorLike) as Record<string, unknown>;
    expect(out.name).toBe("NoStackError");
    expect(out.message).toBe("m2");
    expect(out.nativeError).toBeInstanceOf(Error);
  });

  test("a non-string stack yields no frames", () => {
    const numeric = new Error("num");
    (numeric as { stack?: unknown }).stack = 123;
    expect((err(numeric) as Record<string, unknown>).stack).toEqual([]);

    const empty = new Error("empty");
    empty.stack = "";
    expect((err(empty) as Record<string, unknown>).stack).toEqual([]);
  });

  test("defaults name to 'Error' and message to '' when the Error carries them as undefined", () => {
    const mangled = Object.create(Error.prototype) as Error;
    Object.defineProperty(mangled, "name", { value: undefined, configurable: true });
    Object.defineProperty(mangled, "message", { value: undefined, configurable: true });
    Object.defineProperty(mangled, "stack", { value: "boom stack", configurable: true });

    const out = err(mangled) as Record<string, unknown>;
    expect(out.name).toBe("Error");
    expect(out.message).toBe("");
  });

  test("normalizes a bigint cause (JSON.stringify would throw) via the String fallback", () => {
    const wrapped = new Error("outer", { cause: 10n });
    const cause = (err(wrapped) as Record<string, unknown>).cause as Record<string, unknown>;
    // JSON.stringify(10n) throws, so toError falls back to String(value) => "10".
    expect(cause.message).toBe("10");
    expect(cause.nativeError).toBeInstanceOf(Error);
  });

  test("copies a plain-object cause's own fields onto the normalized cause Error", () => {
    const wrapped = new Error("outer", { cause: { code: "E_X", detail: "extra" } });
    const cause = (err(wrapped) as Record<string, unknown>).cause as Record<string, unknown>;
    // toError(objectCause) JSON-stringifies for the message and Object.assigns the fields onto the Error.
    expect(cause.message).toBe(JSON.stringify({ code: "E_X", detail: "extra" }));
    const native = cause.nativeError as Record<string, unknown>;
    expect(native.code).toBe("E_X");
    expect(native.detail).toBe("extra");
  });

  test("stops following the cause chain at MAX_ERROR_CAUSE_DEPTH (5 levels)", () => {
    let deepest = new Error("d6");
    for (let i = 5; i >= 1; i--) {
      deepest = new Error(`d${i}`, { cause: deepest });
    }
    let node = err(deepest) as Record<string, unknown>;
    let depth = 0;
    while (node.cause != null) {
      node = node.cause as Record<string, unknown>;
      depth++;
    }
    // The chain is followed 5 deep, then the 6th level's cause is dropped by the depth guard.
    expect(depth).toBe(5);
  });
});

describe("stdSerializers.req", () => {
  test("redacts authorization and cookie headers (plain object)", () => {
    const out = req({
      method: "POST",
      url: "/login",
      headers: { authorization: "Bearer secret", Cookie: "sid=abc", "content-type": "application/json" },
      socket: { remoteAddress: "10.0.0.1" },
    }) as Record<string, unknown>;

    expect(out.method).toBe("POST");
    expect(out.url).toBe("/login");
    expect(out.remoteAddress).toBe("10.0.0.1");
    const headers = out.headers as Record<string, unknown>;
    expect(headers.authorization).toBe("[redacted]");
    expect(headers.Cookie).toBe("[redacted]");
    expect(headers["content-type"]).toBe("application/json");
  });

  test("redacts headers from a web Headers instance", () => {
    const headers = new Headers();
    headers.set("authorization", "Bearer x");
    headers.set("x-trace", "t-1");
    const out = req({ method: "GET", url: "/", headers }) as Record<string, unknown>;
    const serialized = out.headers as Record<string, unknown>;

    expect(serialized.authorization).toBe("[redacted]");
    expect(serialized["x-trace"]).toBe("t-1");
  });

  test("falls back to originalUrl and ip", () => {
    const out = req({ method: "GET", originalUrl: "/orig", ip: "1.2.3.4" }) as Record<string, unknown>;
    expect(out.url).toBe("/orig");
    expect(out.remoteAddress).toBe("1.2.3.4");
  });

  test("falls all the way back to path for the url (Koa ctx shape)", () => {
    const out = req({ method: "GET", path: "/koa" }) as Record<string, unknown>;
    expect(out.url).toBe("/koa");
  });

  test("redacts headers supplied as an array of [name, value] pairs", () => {
    const out = req({
      method: "GET",
      url: "/",
      headers: [["authorization", "Bearer secret"], ["x-ok", "1"], ["only-one-element"]],
    }) as Record<string, unknown>;
    const headers = out.headers as Record<string, unknown>;
    expect(headers.authorization).toBe("[redacted]");
    expect(headers["x-ok"]).toBe("1");
    // A malformed pair (< 2 elements) is skipped, not emitted.
    expect(headers["only-one-element"]).toBeUndefined();
  });

  test("drops the headers key when the header bag is neither object, array, nor iterable", () => {
    const out = req({ method: "GET", url: "/", headers: 42 }) as Record<string, unknown>;
    expect(Object.hasOwn(out, "headers")).toBe(false);
    expect(out.method).toBe("GET");
  });

  test("passes through a non-object value unchanged", () => {
    expect(req(null)).toBe(null);
  });
});

describe("stdSerializers.res", () => {
  test("keeps statusCode and headers", () => {
    const out = res({ statusCode: 200, headers: { "set-cookie": "sid=abc", "x-rate": "10" } }) as Record<string, unknown>;
    expect(out.statusCode).toBe(200);
    const headers = out.headers as Record<string, unknown>;
    expect(headers["set-cookie"]).toBe("[redacted]");
    expect(headers["x-rate"]).toBe("10");
  });

  test("reads getHeaders() and `status` (Node/web shapes)", () => {
    const nodeRes = res({ statusCode: 404, getHeaders: () => ({ "content-type": "text/html" }) }) as Record<string, unknown>;
    expect(nodeRes.statusCode).toBe(404);
    expect((nodeRes.headers as Record<string, unknown>)["content-type"]).toBe("text/html");

    const webRes = res({ status: 201, headers: { etag: "abc" } }) as Record<string, unknown>;
    expect(webRes.statusCode).toBe(201);
  });

  test("passes through a non-object value unchanged", () => {
    expect(res(undefined)).toBe(undefined);
  });
});

describe("stdSerializers.user", () => {
  test("keeps id and safe fields, drops secrets", () => {
    const out = user({
      id: "u-1",
      name: "Ada",
      email: "ada@example.com",
      password: "hunter2",
      apiKey: "k-123",
      session_id: "s-1",
      ssn: "123-45-6789",
    }) as Record<string, unknown>;

    expect(out).toEqual({ id: "u-1", name: "Ada", email: "ada@example.com" });
  });

  test("matching is case-insensitive", () => {
    const out = user({ id: 1, Password: "x", TOKEN: "y", Role: "admin" }) as Record<string, unknown>;
    expect(out).toEqual({ id: 1, Role: "admin" });
  });

  test("passes through a non-object value unchanged", () => {
    expect(user(7)).toBe(7);
  });
});

describe("stdSerializers map", () => {
  test("exposes err/req/res/user", () => {
    expect(stdSerializers.err).toBe(err);
    expect(stdSerializers.req).toBe(req);
    expect(stdSerializers.res).toBe(res);
    expect(stdSerializers.user).toBe(user);
  });
});

describe("serialize(map) middleware", () => {
  test("applies serializers to matching fields without mutating the original argument", () => {
    const records: Record<string, unknown>[] = [];
    const logger = new Logger({ type: "hidden", argumentsArrayName: "args" });
    logger.use(serialize(stdSerializers));
    logger.attachTransport((record) => {
      records.push(record as unknown as Record<string, unknown>);
    });

    const original = {
      err: new Error("oops"),
      req: { method: "GET", url: "/", headers: { authorization: "Bearer top-secret" } },
      user: { id: 5, password: "nope" },
    };

    logger.info(original);

    // Original argument untouched.
    expect(original.err).toBeInstanceOf(Error);
    expect((original.req.headers as Record<string, unknown>).authorization).toBe("Bearer top-secret");
    expect(original.user.password).toBe("nope");

    const logged = (records[0].args as unknown[])[0] as Record<string, unknown>;
    expect((logged.err as Record<string, unknown>).message).toBe("oops");
    expect(((logged.req as Record<string, unknown>).headers as Record<string, unknown>).authorization).toBe("[redacted]");
    expect(logged.user).toEqual({ id: 5 });
  });

  test("leaves non-object args and unmatched fields untouched", () => {
    const records: Record<string, unknown>[] = [];
    const logger = new Logger({ type: "hidden", argumentsArrayName: "args" });
    logger.use(serialize({ err }));
    logger.attachTransport((record) => {
      records.push(record as unknown as Record<string, unknown>);
    });

    logger.info("plain string", { other: 1 });

    const args = records[0].args as unknown[];
    expect(args[0]).toBe("plain string");
    expect(args[1]).toEqual({ other: 1 });
  });

  test("an empty map is a no-op", () => {
    const records: Record<string, unknown>[] = [];
    const logger = new Logger({ type: "hidden", argumentsArrayName: "args" });
    logger.use(serialize({}));
    logger.attachTransport((record) => {
      records.push(record as unknown as Record<string, unknown>);
    });

    const payload = { err: new Error("kept") };
    logger.info(payload);
    expect((records[0].args as unknown[])[0]).toBe(payload);
  });

  test("a field set to undefined is skipped", () => {
    const records: Record<string, unknown>[] = [];
    const logger = new Logger({ type: "hidden", argumentsArrayName: "args" });
    logger.use(serialize(stdSerializers));
    logger.attachTransport((record) => {
      records.push(record as unknown as Record<string, unknown>);
    });

    logger.info({ err: undefined, keep: true });
    const logged = (records[0].args as unknown[])[0] as Record<string, unknown>;
    expect(logged.err).toBeUndefined();
    expect(logged.keep).toBe(true);
  });
});
