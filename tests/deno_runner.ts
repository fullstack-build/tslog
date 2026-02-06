// Deno test adapter for tslog
// Run: deno test --allow-read --allow-env tests/deno_runner.ts
// Requires: npm run build (imports from dist/esm/)

import { assertEquals, assertExists } from "jsr:@std/assert";

const { Logger } = await import("../dist/esm/index.js");

Deno.test("JSON output contains meta with runtime", () => {
  const logger = new Logger({ type: "hidden" });
  const logObj = logger.info("deno test");

  assertExists(logObj);
  assertExists(logObj._meta);
  assertEquals(logObj._meta.logLevelName, "INFO");
  assertEquals(logObj._meta.logLevelId, 3);
  assertEquals(typeof logObj._meta.runtime, "string");
  assertExists(logObj._meta.date);
});

Deno.test("all 7 log levels work", () => {
  const logger = new Logger({ type: "hidden" });
  const levels = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;
  const expectedIds = [0, 1, 2, 3, 4, 5, 6];

  for (let i = 0; i < levels.length; i++) {
    const logObj = logger[levels[i]](`${levels[i]} message`);
    assertExists(logObj);
    assertEquals(logObj._meta.logLevelId, expectedIds[i]);
  }
});

Deno.test("minLevel filtering", () => {
  const logger = new Logger({ type: "hidden", minLevel: 3 });

  assertEquals(logger.debug("filtered"), undefined);
  assertExists(logger.info("included"));
});

Deno.test("masking works", () => {
  const logger = new Logger({ type: "hidden", maskValuesOfKeys: ["password"] });
  const logObj = logger.info({ user: "alice", password: "secret" });

  assertExists(logObj);
  assertEquals(logObj.password, "[***]");
  assertEquals(logObj.user, "alice");
});

Deno.test("error serialization", () => {
  const logger = new Logger({ type: "hidden" });
  const err = new Error("test error");
  const logObj = logger.info(err);

  assertExists(logObj);
  assertEquals(logObj.name, "Error");
  assertEquals(logObj.message, "test error");
});

Deno.test("error cause chain", () => {
  const logger = new Logger({ type: "hidden" });
  const root = new Error("root");
  const outer = new Error("outer", { cause: root });
  const logObj = logger.info(outer);

  assertExists(logObj);
  assertEquals(logObj.message, "outer");
  assertExists(logObj.cause);
  assertEquals(logObj.cause.message, "root");
});

Deno.test("sub-logger preserves parent names", () => {
  const root = new Logger({ type: "hidden", name: "root" });
  const child = root.getSubLogger({ name: "child" });
  const logObj = child.info("from child");

  assertExists(logObj);
  assertEquals(logObj._meta.name, "child");
  assertEquals(logObj._meta.parentNames, ["root"]);
});

Deno.test("sub-logger accumulates prefixes", () => {
  const root = new Logger({ type: "hidden", prefix: ["[R]"] });
  const child = root.getSubLogger({ prefix: ["[C]"] });
  const logObj = child.info("msg");

  assertExists(logObj);
  assertEquals(logObj["0"], "[R]");
  assertEquals(logObj["1"], "[C]");
  assertEquals(logObj["2"], "msg");
});

Deno.test("hidden mode produces no console output", () => {
  const logger = new Logger({ type: "hidden" });
  const output: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => output.push(String(args[0]));

  logger.info("hidden msg");

  console.log = origLog;
  assertEquals(output.length, 0);
});

Deno.test("transport receives logObj", () => {
  const captured: unknown[] = [];
  const logger = new Logger({ type: "hidden" });
  logger.attachTransport((logObj: unknown) => captured.push(logObj));

  logger.info("transport test");

  assertEquals(captured.length, 1);
  assertEquals((captured[0] as Record<string, unknown>)["0"], "transport test");
});

Deno.test("circular reference handled gracefully in JSON mode", () => {
  const logger = new Logger({ type: "hidden" });
  const obj: Record<string, unknown> = { name: "circular" };
  obj.self = obj;

  const logObj = logger.info(obj);
  assertExists(logObj);
});

Deno.test("regex masking", () => {
  const logger = new Logger({
    type: "hidden",
    maskValuesOfKeys: [],
    maskValuesRegEx: [/\d{3}-\d{2}-\d{4}/],
  });

  const logObj = logger.info("SSN is 123-45-6789");
  assertExists(logObj);
  assertEquals(logObj["0"], "SSN is [***]");
});
