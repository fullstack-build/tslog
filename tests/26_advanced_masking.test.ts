import { Logger } from "../src/index.js";

describe("Advanced masking", () => {
  test("masks keys in deeply nested structure (5+ levels)", () => {
    const logger = new Logger({ type: "hidden", maskValuesOfKeys: ["secret"] });
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
    const logger = new Logger({ type: "hidden", maskValuesOfKeys: ["password"] });
    const obj: Record<string, unknown> = { password: "secret123", name: "test" };
    obj.self = obj;

    expect(() => {
      const logObj = logger.info(obj);
      expect(logObj?.password).toBe("[***]");
      expect(logObj?.name).toBe("test");
    }).not.toThrow();
  });

  test("masking preserves Date instances", () => {
    const logger = new Logger({ type: "hidden", maskValuesOfKeys: ["token"] });
    const now = new Date();
    const input = { token: "abc", created: now };

    const logObj = logger.info(input);
    expect(logObj?.token).toBe("[***]");
    expect(logObj?.created).toBeInstanceOf(Date);
    expect((logObj?.created as Date).getTime()).toBe(now.getTime());
  });

  test("masking preserves Map and Set instances", () => {
    const logger = new Logger({ type: "hidden", maskValuesOfKeys: ["apiKey"] });
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
    const logger = new Logger({ type: "hidden", maskValuesOfKeys: ["password"] });
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
      maskValuesOfKeys: ["password"],
      maskValuesRegEx: [/\d{3}-\d{2}-\d{4}/],
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
      maskValuesOfKeys: ["password"],
      maskValuesOfKeysCaseInsensitive: true,
    });

    const input = { Password: "a", PASSWORD: "b", pAsSwOrD: "c", other: "visible" };
    const logObj = logger.info(input);

    expect(logObj?.Password).toBe("[***]");
    expect(logObj?.PASSWORD).toBe("[***]");
    expect(logObj?.pAsSwOrD).toBe("[***]");
    expect(logObj?.other).toBe("visible");
  });

  test("original input is not mutated after logging", () => {
    const logger = new Logger({ type: "hidden", maskValuesOfKeys: ["password"] });
    const input = { password: "original", nested: { password: "also-original" } };
    const inputSnapshot = JSON.parse(JSON.stringify(input));

    logger.info(input);

    expect(input.password).toBe(inputSnapshot.password);
    expect(input.nested.password).toBe(inputSnapshot.nested.password);
  });

  test("custom maskPlaceholder is used", () => {
    const logger = new Logger({
      type: "hidden",
      maskValuesOfKeys: ["secret"],
      maskPlaceholder: "<REDACTED>",
    });

    const logObj = logger.info({ secret: "value" });
    expect(logObj?.secret).toBe("<REDACTED>");
  });
});
