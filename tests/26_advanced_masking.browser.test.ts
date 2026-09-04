import { expect, test } from "@playwright/test";
import { inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("Advanced masking (browser)", () => {
  test("masks keys in deeply nested structure (5+ levels)", async ({ page }) => {
    const result = await inPage<{ secret: unknown; visible: unknown }>(
      page,
      { type: "hidden", mask: { keys: ["secret"] } },
      `
      const logger = new tslog.Logger(settings);
      const input = { a: { b: { c: { d: { e: { secret: "top-secret-value", visible: "ok" } } } } } };
      const logObj = logger.info(input);
      const e = logObj.a.b.c.d.e;
      return { secret: e.secret, visible: e.visible };
    `,
    );
    expect(result.secret).toBe("[***]");
    expect(result.visible).toBe("ok");
  });

  test("masks keys in circular structures without throwing", async ({ page }) => {
    const result = await inPage<{ threw: boolean; password: unknown; name: unknown }>(
      page,
      { type: "hidden", mask: { keys: ["password"] } },
      `
      const logger = new tslog.Logger(settings);
      const obj = { password: "secret123", name: "test" };
      obj.self = obj;
      try {
        const logObj = logger.info(obj);
        return { threw: false, password: logObj.password, name: logObj.name };
      } catch {
        return { threw: true, password: null, name: null };
      }
    `,
    );
    expect(result.threw).toBe(false);
    expect(result.password).toBe("[***]");
    expect(result.name).toBe("test");
  });

  test("masking preserves Date instances", async ({ page }) => {
    const result = await inPage<{ token: unknown; isDate: boolean; time: number; expected: number }>(
      page,
      { type: "hidden", mask: { keys: ["token"] } },
      `
      const logger = new tslog.Logger(settings);
      const now = new Date();
      const logObj = logger.info({ token: "abc", created: now });
      return { token: logObj.token, isDate: logObj.created instanceof Date, time: logObj.created.getTime(), expected: now.getTime() };
    `,
    );
    expect(result.token).toBe("[***]");
    expect(result.isDate).toBe(true);
    expect(result.time).toBe(result.expected);
  });

  test("masking preserves Map and Set instances", async ({ page }) => {
    const result = await inPage<{ apiKey: unknown; isMap: boolean; isSet: boolean }>(
      page,
      { type: "hidden", mask: { keys: ["apiKey"] } },
      `
      const logger = new tslog.Logger(settings);
      const input = { apiKey: "key123", data: { map: new Map([["a", 1]]), set: new Set([1, 2, 3]) } };
      const logObj = logger.info(input);
      return { apiKey: logObj.apiKey, isMap: logObj.data.map instanceof Map, isSet: logObj.data.set instanceof Set };
    `,
    );
    expect(result.apiKey).toBe("[***]");
    expect(result.isMap).toBe(true);
    expect(result.isSet).toBe(true);
  });

  test("masks keys within objects passed as multiple args", async ({ page }) => {
    const result = await inPage<{ p0: unknown; p1: unknown; user0: unknown }>(
      page,
      { type: "hidden", mask: { keys: ["password"] } },
      `
      const logger = new tslog.Logger(settings);
      const logObj = logger.info({ user: "alice", password: "pass1" }, { user: "bob", password: "pass2" });
      return { p0: logObj["0"].password, p1: logObj["1"].password, user0: logObj["0"].user };
    `,
    );
    expect(result.p0).toBe("[***]");
    expect(result.p1).toBe("[***]");
    expect(result.user0).toBe("alice");
  });

  test("key masking and regex masking work simultaneously", async ({ page }) => {
    const result = await inPage<{ password: unknown; message: unknown }>(
      page,
      { type: "hidden", mask: { keys: ["password"], regex: [/\d{3}-\d{2}-\d{4}/] } },
      `
      const logger = new tslog.Logger(settings);
      const logObj = logger.info({ password: "secret", message: "SSN is 123-45-6789" });
      return { password: logObj.password, message: logObj.message };
    `,
    );
    expect(result.password).toBe("[***]");
    expect(result.message).toBe("SSN is [***]");
  });

  test("case-insensitive masking matches regardless of key casing", async ({ page }) => {
    const result = await inPage<Record<string, unknown>>(
      page,
      { type: "hidden", mask: { keys: ["password"], caseInsensitive: true } },
      `
      const logger = new tslog.Logger(settings);
      const logObj = logger.info({ Password: "a", PASSWORD: "b", pAsSwOrD: "c", other: "visible" });
      return { Password: logObj.Password, PASSWORD: logObj.PASSWORD, pAsSwOrD: logObj.pAsSwOrD, other: logObj.other };
    `,
    );
    expect(result.Password).toBe("[***]");
    expect(result.PASSWORD).toBe("[***]");
    expect(result.pAsSwOrD).toBe("[***]");
    expect(result.other).toBe("visible");
  });

  test("original input is not mutated after logging", async ({ page }) => {
    const result = await inPage<{ top: unknown; nested: unknown }>(
      page,
      { type: "hidden", mask: { keys: ["password"] } },
      `
      const logger = new tslog.Logger(settings);
      const input = { password: "original", nested: { password: "also-original" } };
      logger.info(input);
      return { top: input.password, nested: input.nested.password };
    `,
    );
    expect(result.top).toBe("original");
    expect(result.nested).toBe("also-original");
  });

  test("custom maskPlaceholder is used", async ({ page }) => {
    const result = await inPage<unknown>(
      page,
      { type: "hidden", mask: { keys: ["secret"], placeholder: "<REDACTED>" } },
      `
      const logger = new tslog.Logger(settings);
      return logger.info({ secret: "value" }).secret;
    `,
    );
    expect(result).toBe("<REDACTED>");
  });

  test("mask.regex masks an error's message in the record and on the native handle", async ({ page }) => {
    const result = await inPage<{ message: unknown; native: unknown; isError: boolean; original: unknown }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger({ ...settings, mask: { regex: [/SECRET_[0-9]+/] } });
      const err = new Error("connecting to https://example.org/?key=SECRET_123456");
      const logObj = logger.error(err);
      return { message: logObj.message, native: logObj.nativeError.message, isError: logObj.nativeError instanceof Error, original: err.message };
    `,
    );
    expect(result.message).toBe("connecting to https://example.org/?key=[***]");
    expect(result.native).toBe("connecting to https://example.org/?key=[***]");
    expect(result.isError).toBe(true);
    expect(result.original).toBe("connecting to https://example.org/?key=SECRET_123456");
  });

  test("mask.keys masks own properties assigned to an error", async ({ page }) => {
    const result = await inPage<{ token: unknown; nested: unknown; original: unknown }>(
      page,
      { type: "hidden", mask: { keys: ["token"] } },
      `
      const logger = new tslog.Logger(settings);
      const err = Object.assign(new Error("boom"), { token: "t-1", extensions: { token: "t-2" } });
      const logObj = logger.error(err);
      return { token: logObj.nativeError.token, nested: logObj.nativeError.extensions.token, original: err.token };
    `,
    );
    expect(result.token).toBe("[***]");
    expect(result.nested).toBe("[***]");
    expect(result.original).toBe("t-1");
  });
});
