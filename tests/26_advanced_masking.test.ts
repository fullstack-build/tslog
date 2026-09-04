import { runInNewContext } from "node:vm";
import { MaskingEngine } from "../src/core/masking.js";
import { Logger } from "../src/index.js";
import type { ILogObjMeta } from "../src/interfaces.js";
import { renderJson } from "../src/render/json.js";
import { getConsoleLogStripped, mockConsoleLog } from "./helper.js";

describe("Advanced masking", () => {
  test("masks keys in deeply nested structure (5+ levels)", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["secret"] } });
    const input = {
      a: {
        b: {
          c: {
            d: {
              e: {
                secret: "top-secret-value",
                visible: "ok",
              },
            },
          },
        },
      },
    };

    const logObj = logger.info(input);
    const nested = (logObj as Record<string, unknown>)?.a as Record<string, unknown>;
    const deep = (nested?.b as Record<string, unknown>)?.c as Record<string, unknown>;
    const deeper = (deep?.d as Record<string, unknown>)?.e as Record<string, unknown>;

    expect(deeper?.secret).toBe("[***]");
    expect(deeper?.visible).toBe("ok");
  });

  test("masks keys in circular structures without throwing", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const obj: Record<string, unknown> = { password: "secret123", name: "test" };
    obj.self = obj;

    expect(() => {
      const logObj = logger.info(obj);
      expect(logObj?.password).toBe("[***]");
      expect(logObj?.name).toBe("test");
    }).not.toThrow();
  });

  test("masking preserves Date instances", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["token"] } });
    const now = new Date();
    const input = { token: "abc", created: now };

    const logObj = logger.info(input);
    expect(logObj?.token).toBe("[***]");
    expect(logObj?.created).toBeInstanceOf(Date);
    expect((logObj?.created as Date).getTime()).toBe(now.getTime());
  });

  test("masking preserves Map and Set instances", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["apiKey"] } });
    const map = new Map([["a", 1]]);
    const set = new Set([1, 2, 3]);
    const input = { apiKey: "key123", data: { map, set } };

    const logObj = logger.info(input);
    expect(logObj?.apiKey).toBe("[***]");
    const data = logObj?.data as Record<string, unknown>;
    expect(data?.map).toBeInstanceOf(Map);
    expect(data?.set).toBeInstanceOf(Set);
  });

  test("masks keys within objects passed as multiple args", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const a = { user: "alice", password: "pass1" };
    const b = { user: "bob", password: "pass2" };

    const logObj = logger.info(a, b);
    expect((logObj?.["0"] as Record<string, unknown>)?.password).toBe("[***]");
    expect((logObj?.["1"] as Record<string, unknown>)?.password).toBe("[***]");
    expect((logObj?.["0"] as Record<string, unknown>)?.user).toBe("alice");
  });

  test("key masking and regex masking work simultaneously", () => {
    const logger = new Logger({
      type: "hidden",
      mask: {
        keys: ["password"],
        regex: [/\d{3}-\d{2}-\d{4}/],
      },
    });

    const input = {
      password: "secret",
      message: "SSN is 123-45-6789",
    };

    const logObj = logger.info(input);
    expect(logObj?.password).toBe("[***]");
    expect(logObj?.message).toBe("SSN is [***]");
  });

  test("case-insensitive masking matches regardless of key casing", () => {
    const logger = new Logger({
      type: "hidden",
      mask: {
        keys: ["password"],
        caseInsensitive: true,
      },
    });

    const input = { Password: "a", PASSWORD: "b", pAsSwOrD: "c", other: "visible" };
    const logObj = logger.info(input);

    expect(logObj?.Password).toBe("[***]");
    expect(logObj?.PASSWORD).toBe("[***]");
    expect(logObj?.pAsSwOrD).toBe("[***]");
    expect(logObj?.other).toBe("visible");
  });

  test("original input is not mutated after logging", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const input = { password: "original", nested: { password: "also-original" } };
    const inputSnapshot = JSON.parse(JSON.stringify(input));

    logger.info(input);

    expect(input.password).toBe(inputSnapshot.password);
    expect(input.nested.password).toBe(inputSnapshot.nested.password);
  });

  test("custom maskPlaceholder is used", () => {
    const logger = new Logger({
      type: "hidden",
      mask: {
        keys: ["secret"],
        placeholder: "<REDACTED>",
      },
    });

    const logObj = logger.info({ secret: "value" });
    expect(logObj?.secret).toBe("<REDACTED>");
  });
});

describe("Masking leak fixes (shared references, cycles, regex flags, Map/Set)", () => {
  test("masks a shared reference on every path, not just the first encounter", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const creds = { password: "hunter2", user: "alice" };

    const logObj = logger.info({ a: creds, b: creds });
    const a = logObj?.a as Record<string, unknown>;
    const b = logObj?.b as Record<string, unknown>;

    expect(a?.password).toBe("[***]");
    expect(b?.password).toBe("[***]");
    // Shared references resolve to the SAME masked clone (DAG identity preserved).
    expect(a).toBe(b);
    // The caller's object is never mutated.
    expect(creds.password).toBe("hunter2");
  });

  test("masks a shared reference across separate log arguments", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const creds = { password: "hunter2" };

    const logObj = logger.info(creds, creds);
    expect((logObj?.["0"] as Record<string, unknown>)?.password).toBe("[***]");
    expect((logObj?.["1"] as Record<string, unknown>)?.password).toBe("[***]");
  });

  test("masks secrets reachable through a circular reference and preserves the cycle", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const obj: Record<string, unknown> = { password: "secret123", name: "test" };
    obj.self = obj;

    const logObj = logger.info(obj);
    expect(logObj?.password).toBe("[***]");

    const self = logObj?.self as Record<string, unknown>;
    expect(self?.password).toBe("[***]");
    // The masked clone is cyclic like the source — the guard returns the clone, not an unmasked copy.
    expect(self?.self).toBe(self);
  });

  test("a non-global mask regex redacts every occurrence, not only the first", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [/\d{4}-\d{4}/] } });

    const logObj = logger.info("cards 1111-2222 and 3333-4444");
    expect(logObj?.["0"]).toBe("cards [***] and [***]");
  });

  test("a sticky-only mask regex is applied globally instead of masking nothing", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [/secret/y] } });

    const logObj = logger.info("one secret, two secret");
    expect(logObj?.["0"]).toBe("one [***], two [***]");
  });

  test("masks values of matching string keys inside a Map", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const map = new Map<string, unknown>([
      ["password", "hunter2"],
      ["user", "alice"],
    ]);

    const logObj = logger.info({ data: map });
    const data = logObj?.data as Map<string, unknown>;

    expect(data).toBeInstanceOf(Map);
    expect(data.get("password")).toBe("[***]");
    expect(data.get("user")).toBe("alice");
    // The caller's Map is never mutated.
    expect(map.get("password")).toBe("hunter2");
  });

  test("masks matching Map keys case-insensitively when configured", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"], caseInsensitive: true } });
    const map = new Map<string, unknown>([["PASSWORD", "hunter2"]]);

    const logObj = logger.info({ data: map });
    expect((logObj?.data as Map<string, unknown>).get("PASSWORD")).toBe("[***]");
  });

  test("masks nested objects inside Map values and Set elements", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password", "token"] } });
    const map = new Map<string, unknown>([["account", { password: "p1", plain: "ok" }]]);
    const set = new Set<unknown>([{ token: "t1", plain: "ok" }]);

    const logObj = logger.info({ map, set });

    const maskedAccount = (logObj?.map as Map<string, unknown>).get("account") as Record<string, unknown>;
    expect(maskedAccount?.password).toBe("[***]");
    expect(maskedAccount?.plain).toBe("ok");

    const [maskedElement] = [...(logObj?.set as Set<Record<string, unknown>>)];
    expect(maskedElement?.token).toBe("[***]");
    expect(maskedElement?.plain).toBe("ok");
  });

  test("mask regex applies to strings inside Map values and Set elements", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [/secret/g] } });
    const map = new Map<string, unknown>([["note", "a secret here"]]);
    const set = new Set<unknown>(["another secret there"]);

    const logObj = logger.info({ map, set });
    expect((logObj?.map as Map<string, unknown>).get("note")).toBe("a [***] here");
    expect([...(logObj?.set as Set<string>)][0]).toBe("another [***] there");
  });

  test("path masking stays position-exact for a shared reference (censors only the configured path)", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["b.secret"] } });
    const shared = { secret: "x", plain: "ok" };

    const logObj = logger.info({ a: shared, b: shared });
    expect((logObj?.a as Record<string, unknown>)?.secret).toBe("x");
    expect((logObj?.b as Record<string, unknown>)?.secret).toBe("[***]");
  });

  test("path masking of a shared reference does not over-censor the other position", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["a.secret"] } });
    const shared = { secret: "x" };

    const logObj = logger.info({ a: shared, b: shared });
    expect((logObj?.a as Record<string, unknown>)?.secret).toBe("[***]");
    expect((logObj?.b as Record<string, unknown>)?.secret).toBe("x");
  });

  test("path masking with a circular structure does not throw and censors the configured path", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["secret"] } });
    const obj: Record<string, unknown> = { secret: "x", plain: "ok" };
    obj.self = obj;

    let logObj: Record<string, unknown> | undefined;
    expect(() => {
      logObj = logger.info(obj) as Record<string, unknown> | undefined;
    }).not.toThrow();
    expect(logObj?.secret).toBe("[***]");
    expect(logObj?.plain).toBe("ok");
  });

  test("masks numeric Map keys the same way numeric mask.keys match object properties", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: [1234] } });
    const map = new Map<unknown, unknown>([
      [1234, "SECRET-MAP"],
      ["1234", "SECRET-STRING-KEY"],
    ]);

    const logObj = logger.info({ obj: { 1234: "SECRET-OBJ" }, map });
    expect((logObj?.obj as Record<string, unknown>)?.["1234"]).toBe("[***]");
    const maskedMap = logObj?.map as Map<unknown, unknown>;
    expect(maskedMap.get(1234)).toBe("[***]");
    expect(maskedMap.get("1234")).toBe("[***]");
  });

  test("shared-reference DAGs under mask.paths complete in linear time (no exponential re-walk)", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["user.password"] } });
    // A diamond graph: 2^26 root-to-leaf paths but only 27 distinct nodes. Exponential re-walking
    // would take minutes here; the path-inert memo keeps it linear in the number of nodes.
    let node: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 26; i++) {
      node = { l: node, r: node };
    }

    const startedAt = Date.now();
    const logObj = logger.info(node);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(logObj).toBeDefined();
  });

  test("sparse arrays keep their holes (and are not densified with undefined)", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });
    const sparse: unknown[] = new Array(5);
    sparse[1] = { password: "p", plain: "ok" };
    sparse[4] = "end";

    const logObj = logger.info({ sparse });
    const masked = logObj?.sparse as unknown[];
    expect(masked.length).toBe(5);
    expect(0 in masked).toBe(false);
    expect(2 in masked).toBe(false);
    expect((masked[1] as Record<string, unknown>).password).toBe("[***]");
    expect(masked[4]).toBe("end");
  });

  test("mask.paths neither descends into nor passes through Map contents", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["a.b"] } });
    const map = new Map<string, unknown>([["k", { b: "inside-map" }]]);

    const logObj = logger.info({ a: map, plain: { b: "outside" } });
    // The object inside the Map sits at no addressable path — "a.b" must not censor it…
    expect(((logObj?.a as Map<string, unknown>).get("k") as Record<string, unknown>)?.b).toBe("inside-map");
    // …while the same path outside the Map does not match "plain.b" either (different segments).
    expect((logObj?.plain as Record<string, unknown>)?.b).toBe("outside");
  });
});

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** A subclass that cannot be constructed blindly: `new error.constructor()` without arguments throws. */
class StatusError extends Error {
  constructor(status: number) {
    if (typeof status !== "number") {
      throw new TypeError("StatusError needs a numeric status");
    }
    super(`status ${status} key=SECRET_777`);
    this.name = "StatusError";
  }
}

type AnyRecord = Record<string, unknown> & ILogObjMeta;
type ErrorRecord = {
  name?: string;
  message?: string;
  stack?: { fileName?: string; filePath?: string; fileLine?: string }[];
  nativeError?: Error & Record<string, unknown>;
  cause?: ErrorRecord;
};

describe("Masking inside errors", () => {
  const SECRET = /SECRET_[0-9]+/;

  // Issue #361: a secret inside an Error is masked the same way as in a string argument.
  test("mask.regex masks an error's message in the record, the JSON line and the native handle", () => {
    const logger = new Logger<AnyRecord>({ type: "hidden", mask: { regex: [SECRET] } });
    const record = logger.error(new Error("connecting to https://example.org/?key=SECRET_123456")) as AnyRecord;
    const logObj = record as ErrorRecord;
    expect(logObj.message).toBe("connecting to https://example.org/?key=[***]");
    expect(logObj.nativeError?.message).toBe("connecting to https://example.org/?key=[***]");

    const line = renderJson(record, logger.settings);
    expect(line).toContain('"message":"connecting to https://example.org/?key=[***]"');
    expect(line).not.toContain("SECRET_123456");
  });

  test("the pretty error block carries the masked message and own properties", () => {
    mockConsoleLog(true);
    const logger = new Logger({ type: "pretty", pretty: { style: false }, mask: { regex: [SECRET], keys: ["token"] } });
    const err = Object.assign(new Error("connecting to https://example.org/?key=SECRET_123456"), { token: "SECRET_999" });
    logger.error(err);

    const out = getConsoleLogStripped();
    expect(out).toContain("connecting to https://example.org/?key=[***]");
    expect(out).not.toContain("SECRET_123456");
    expect(out).not.toContain("SECRET_999");
  });

  // Issue #214: properties assigned onto an error are masked too, since they show in pretty output and reach transports.
  test("mask.keys masks own properties assigned to an error, nested included", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["token", "phoneNumber"] } });
    const err = Object.assign(new Error("boom"), { token: "t-1", extensions: { serviceName: "upstream", variables: { phoneNumber: "555" } } });
    const native = (logger.error(err) as ErrorRecord).nativeError as Record<string, unknown>;
    const extensions = native.extensions as Record<string, Record<string, unknown>>;
    expect(native.token).toBe("[***]");
    expect(extensions.variables.phoneNumber).toBe("[***]");
    expect(extensions.serviceName).toBe("upstream");
    // The caller's error is untouched.
    expect(err.token).toBe("t-1");
    expect(err.extensions.variables.phoneNumber).toBe("555");
  });

  test("the cause chain is masked, for Error and string causes", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const outer = new Error("outer", { cause: new Error("inner key=SECRET_1", { cause: "root key=SECRET_2" }) });
    const logObj = logger.error(outer) as ErrorRecord;
    expect(logObj.message).toBe("outer");
    expect(logObj.cause?.message).toBe("inner key=[***]");
    expect(logObj.cause?.cause?.message).toBe("root key=[***]");
  });

  test("mask.keys never touches name/message/stack, while mask.paths can censor them", () => {
    const keyed = new Logger({ type: "hidden", mask: { keys: ["name", "message", "stack", "status"] } });
    const byKeys = keyed.error(new HttpError("Not Found", 404)) as ErrorRecord;
    expect(byKeys.name).toBe("HttpError");
    expect(byKeys.message).toBe("Not Found");
    expect(byKeys.stack?.length).toBeGreaterThan(0);
    // An own property of the same error is still masked by key.
    expect(byKeys.nativeError?.status).toBe("[***]");

    const pathed = new Logger({ type: "hidden", mask: { paths: ["message"] } });
    const byPath = pathed.error(new HttpError("Not Found", 404)) as ErrorRecord;
    expect(byPath.message).toBe("[***]");
    expect(byPath.name).toBe("HttpError");
  });

  test("the caller's error is never mutated and the clone keeps the subclass", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const err = new HttpError("key=SECRET_1", 404);
    const logObj = logger.error(err) as ErrorRecord;
    expect(err.message).toBe("key=SECRET_1");
    expect(logObj.nativeError).not.toBe(err);
    expect(logObj.nativeError).toBeInstanceOf(HttpError);
    expect(logObj.nativeError?.name).toBe("HttpError");
    expect(logObj.nativeError?.status).toBe(404);
  });

  test("an Error subclass whose constructor requires arguments is cloned without running it", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const logObj = logger.error(new StatusError(503)) as ErrorRecord;
    expect(logObj.message).toBe("status 503 key=[***]");
    expect(logObj.nativeError).toBeInstanceOf(StatusError);
  });

  test("the message repeated in the stack header is masked too", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    // With a name other than `Error` the header line survives stack sanitizing, and the " at " in the message
    // makes the parser read it as a frame. So the secret would land in the parsed `stack` array as well.
    const logObj = logger.error(new TypeError("failed at https://example.org/?key=SECRET_1")) as ErrorRecord;
    expect(logObj.message).toBe("failed at https://example.org/?key=[***]");
    expect(logObj.nativeError?.stack).not.toContain("SECRET_1");
    expect(JSON.stringify(logObj.stack)).not.toContain("SECRET_1");
  });

  test("stack frames still parse after masking (frames are not regex-masked)", () => {
    // A digit pattern would mangle every `line:col` if it ran over the stack string.
    const logger = new Logger({ type: "hidden", mask: { regex: [/[0-9]{3,}/] } });
    const logObj = logger.error(new Error("key=123456")) as ErrorRecord;
    expect(logObj.message).toBe("key=[***]");
    expect(logObj.stack?.[0]?.fileName).toBe("26_advanced_masking.test.ts");
    expect(logObj.stack?.[0]?.fileLine).toMatch(/^[0-9]+$/);
  });

  test("a masked message that also occurs in the frame paths leaves the frames alone", () => {
    // Every frame of this file has "tests" in its path. Only the header may change, the paths must stay.
    const logger = new Logger({ type: "hidden", mask: { regex: [/tests/] } });
    const logObj = logger.error(new Error("tests")) as ErrorRecord;
    expect(logObj.message).toBe("[***]");
    expect(logObj.nativeError?.stack?.split("\n")[0]).toBe("Error: [***]");
    expect(logObj.stack?.[0]?.fileName).toBe("26_advanced_masking.test.ts");
    expect(logObj.stack?.[0]?.filePath).toMatch(/tests\/26_advanced_masking\.test\.ts$/);
  });

  test("a stack header formatted before the message changed is masked too", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const err = new Error("key=SECRET_1");
    // V8 formats the header on the first read of `stack` and keeps that text afterwards.
    expect(err.stack).toContain("SECRET_1");
    err.message = "sanitized";
    const logObj = logger.error(err) as ErrorRecord;
    expect(logObj.message).toBe("sanitized");
    expect(logObj.nativeError?.stack?.split("\n")[0]).toBe("Error: key=[***]");
  });

  test("a frameless V8 stack is masked as a whole", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const err = new Error("key=SECRET_1");
    // This is what V8 produces under `Error.stackTraceLimit = 0`. Bun gives no stack at all there, so the
    // string is set by hand.
    err.stack = "Error: key=SECRET_1";
    const logObj = logger.error(err) as ErrorRecord;
    expect(logObj.nativeError?.stack).toBe("Error: key=[***]");
  });

  test("a frames-only stack (Firefox, Safari) is left untouched", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [/[0-9]{3,}/] } });
    const err = new Error("key=123456");
    err.stack = "handler@https://example.org/app.3f9a8c1.js:120:4567\n@https://example.org/app.3f9a8c1.js:1:1";
    const logObj = logger.error(err) as ErrorRecord;
    expect(logObj.message).toBe("key=[***]");
    expect(logObj.nativeError?.stack).toBe(err.stack);
  });

  test("a cross-realm error is cloned as a real Error", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const err = runInNewContext("new Error('key=SECRET_1')") as Error;
    const logObj = logger.error(err) as ErrorRecord;
    expect(logObj.message).toBe("key=[***]");
    expect(Object.prototype.toString.call(logObj.nativeError)).toBe("[object Error]");
  });

  test("an error that references itself through an own property resolves to one masked clone", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const engine = new MaskingEngine(logger.settings, { isError: (value): value is Error => value instanceof Error, isBuffer: () => false });
    const err = new Error("key=SECRET_1") as Error & { self?: unknown };
    err.self = err;
    const [out] = engine.mask([err]) as (Error & { self?: unknown })[];
    expect(out).not.toBe(err);
    expect(out.message).toBe("key=[***]");
    expect(out.self).toBe(out);
  });

  // Issue #217: read-only own properties on an Error must not break the masking clone.
  test("read-only and frozen own properties on an error neither throw nor escape masking", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["token"] } });
    const err = new Error("boom");
    Object.defineProperty(err, "token", { value: "t-1", writable: false, enumerable: true, configurable: false });
    Object.defineProperty(err, "kept", { value: "keep", writable: false, enumerable: true, configurable: false });
    Object.freeze(err);
    const logObj = logger.error(err) as ErrorRecord;
    expect(logObj.nativeError?.token).toBe("[***]");
    expect(logObj.nativeError?.kept).toBe("keep");
    expect(logObj.message).toBe("boom");
  });

  // Issue #234: some SDK errors expose `message` through a getter only.
  test("a getter-only message is read through the getter and masked on the clone", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const err = new Error("placeholder");
    Object.defineProperty(err, "message", { get: () => "key=SECRET_1", enumerable: false, configurable: true });
    const logObj = logger.error(err) as ErrorRecord;
    expect(logObj.message).toBe("key=[***]");
    expect(logObj.nativeError?.message).toBe("key=[***]");
  });

  test("a throwing getter on an error's own property yields null, like on a plain object, instead of throwing", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const err = new Error("key=SECRET_1");
    Object.defineProperty(err, "hostile", {
      get() {
        throw new Error("trap");
      },
      enumerable: true,
      configurable: true,
    });
    const logObj = logger.error(err) as ErrorRecord;
    expect(logObj.message).toBe("key=[***]");
    expect(logObj.nativeError?.hostile).toBeNull();
  });

  test("an error nested below the deepest mask.paths depth is still cloned and masked", () => {
    // At `wrap.err` no configured path can match any more, so the engine may reuse the clone for the second
    // reference instead of cloning again.
    const logger = new Logger({ type: "hidden", mask: { paths: ["wrap.other"], regex: [SECRET] } });
    const err = new Error("key=SECRET_1");
    const logObj = logger.info({ wrap: { err, again: err } }) as Record<string, Record<string, ErrorRecord>>;
    expect(logObj.wrap.err.message).toBe("key=[***]");
    expect(logObj.wrap.again).toBe(logObj.wrap.err);
    expect(err.message).toBe("key=SECRET_1");
  });

  test("the clone keeps message and stack non-enumerable, so JSON.stringify(nativeError) is unchanged", () => {
    const logger = new Logger({ type: "hidden", mask: { regex: [SECRET] } });
    const logObj = logger.error(new Error("key=SECRET_1")) as ErrorRecord;
    expect(JSON.stringify(logObj.nativeError)).toBe("{}");
    expect(Object.keys(logObj.nativeError ?? {})).toEqual([]);
  });
});
