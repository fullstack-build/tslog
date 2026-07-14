import { Logger } from "../src/index.js";

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
