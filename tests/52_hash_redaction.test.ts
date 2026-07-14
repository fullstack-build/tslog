import { Logger } from "../src/index.js";

/** Matches the M4.3 correlation token: "[<label>:xxxxxxxx]" with an 8-char lowercase hex digest. */
const HASH_TOKEN = /^\[hash:[0-9a-f]{8}\]$/;

describe("M4.3 hash-for-correlation redaction", () => {
  test("censor: 'hash' replaces a path-matched value with a short stable token", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["userId"], censor: "hash" } });

    const logObj = logger.info({ userId: "user-42", name: "alice" });

    expect(typeof logObj?.userId).toBe("string");
    expect(logObj?.userId as string).toMatch(HASH_TOKEN);
    // Non-matched fields are untouched.
    expect(logObj?.name).toBe("alice");
  });

  test("same input always yields the same token (correlation)", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["userId"], censor: "hash" } });

    const first = logger.info({ userId: "user-42" });
    const second = logger.info({ userId: "user-42" });

    expect(first?.userId).toBe(second?.userId);
  });

  test("different inputs yield different tokens", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["userId"], censor: "hash" } });

    const a = logger.info({ userId: "user-42" });
    const b = logger.info({ userId: "user-99" });

    expect(a?.userId).not.toBe(b?.userId);
    expect(a?.userId as string).toMatch(HASH_TOKEN);
    expect(b?.userId as string).toMatch(HASH_TOKEN);
  });

  test("hashing is stable across two separate logger instances (depends only on value)", () => {
    const loggerA = new Logger({ type: "hidden", mask: { paths: ["token"], censor: "hash" } });
    const loggerB = new Logger({ type: "hidden", mask: { paths: ["token"], censor: "hash" } });

    const a = loggerA.info({ token: "abc-secret" });
    const b = loggerB.info({ token: "abc-secret" });

    expect(a?.token).toBe(b?.token);
  });

  test("works with mask.keys as well as mask.paths", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"], censor: "hash" } });

    const logObj = logger.info({ user: "bob", password: "hunter2", nested: { password: "hunter2" } });

    expect(logObj?.password as string).toMatch(HASH_TOKEN);
    const nested = logObj?.nested as Record<string, unknown>;
    expect(nested?.password as string).toMatch(HASH_TOKEN);
    // Same secret -> same token, whether matched at the top level or nested.
    expect(logObj?.password).toBe(nested?.password);
    expect(logObj?.user).toBe("bob");
  });

  test("the hash token is non-cryptographic and does not contain the original value", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["secret"], censor: "hash" } });

    const logObj = logger.info({ secret: "super-secret-password" });

    expect(logObj?.secret as string).not.toContain("super-secret-password");
    expect(logObj?.secret as string).toMatch(HASH_TOKEN);
  });

  test("custom hashLabel changes the token prefix", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["userId"], censor: "hash", hashLabel: "id" } });

    const logObj = logger.info({ userId: "user-42" });

    expect(logObj?.userId as string).toMatch(/^\[id:[0-9a-f]{8}\]$/);
  });

  test("hashes numeric, boolean, and object values deterministically", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["v"], censor: "hash" } });

    const num = logger.info({ v: 12345 });
    const numAgain = logger.info({ v: 12345 });
    const bool = logger.info({ v: true });
    const obj = logger.info({ v: { a: 1, b: 2 } });
    const objAgain = logger.info({ v: { a: 1, b: 2 } });

    expect(num?.v as string).toMatch(HASH_TOKEN);
    expect(num?.v).toBe(numAgain?.v);
    expect(bool?.v as string).toMatch(HASH_TOKEN);
    expect(obj?.v).toBe(objAgain?.v);
    // Distinct logical values differ.
    expect(num?.v).not.toBe(bool?.v);
  });

  test("hashes null and undefined matched values without throwing", () => {
    const logger = new Logger({ type: "hidden", mask: { paths: ["a", "b"], censor: "hash" } });

    let logObj: Record<string, unknown> | undefined;
    expect(() => {
      logObj = logger.info({ a: null, b: undefined });
    }).not.toThrow();

    expect(logObj?.a as string).toMatch(HASH_TOKEN);
    expect(logObj?.b as string).toMatch(HASH_TOKEN);
    // null and undefined are distinguished.
    expect(logObj?.a).not.toBe(logObj?.b);
  });

  test("default (no censor) key masking still uses the placeholder, not a hash", () => {
    const logger = new Logger({ type: "hidden", mask: { keys: ["password"] } });

    const logObj = logger.info({ password: "secret" });

    expect(logObj?.password).toBe("[***]");
  });

  test("fast path is bypassed when nothing is configured (no masking applied)", () => {
    const logger = new Logger({ type: "hidden" });

    const input = { userId: "user-42", password: "secret" };
    const logObj = logger.info(input);

    expect(logObj?.userId).toBe("user-42");
    expect(logObj?.password).toBe("secret");
  });
});
