import { createLogger, Logger } from "../src/index.node.js";
import { jsonStringifyValue, renderJson, toFlatJsonObject } from "../src/render/json.js";

const capture = { stack: { capture: "off" as const } };

function jsonLine(logObj: unknown, logger: Logger<unknown>): string {
  return renderJson(logObj as never, logger.settings);
}

describe("bindings", () => {
  test("bound fields appear on every call shape", () => {
    const logger = new Logger({ type: "hidden", ...capture, bindings: { tenant: "acme", region: "eu" } });
    const shapes = [
      logger.info("bare message"),
      logger.info("message", { fields: true }),
      logger.info({ single: "object" }),
      logger.info({ fields: true }, "pino shape"),
    ];
    for (const logObj of shapes) {
      const line = jsonLine(logObj, logger);
      expect(line).toContain('"tenant":"acme"');
      expect(line).toContain('"region":"eu"');
    }
  });

  test("per-call fields win over bindings on every shape", () => {
    const logger = new Logger({ type: "hidden", ...capture, bindings: { env: "prod" } });
    const cases = [logger.info({ env: "override" }), logger.info("msg", { env: "override" }), logger.info({ env: "override" }, "msg")];
    for (const logObj of cases) {
      const line = jsonLine(logObj, logger);
      expect(line).toContain('"env":"override"');
      expect(line).not.toContain('"env":"prod"');
    }
  });

  test("bindings merge down the sub-logger chain, child keys win", () => {
    const root = new Logger({ type: "hidden", ...capture, bindings: { tenant: "acme", tier: "free" } });
    const child = root.child({ bindings: { requestId: "r-1", tier: "paid" } });
    const grandchild = child.getSubLogger({ name: "gc" });

    const line = jsonLine(grandchild.info("nested"), grandchild as Logger<unknown>);
    expect(line).toContain('"tenant":"acme"');
    expect(line).toContain('"requestId":"r-1"');
    expect(line).toContain('"tier":"paid"');
  });

  test("bindings are masked once with the logger's mask settings", () => {
    const logger = new Logger({
      type: "hidden",
      ...capture,
      mask: { keys: ["password"] },
      bindings: { password: "hunter2", service: "auth" },
    });
    const line = jsonLine(logger.info("login"), logger);
    expect(line).toContain('"password":"[***]"');
    expect(line).toContain('"service":"auth"');
  });

  test("function values in bindings are NOT invoked", () => {
    let invoked = 0;
    const logger = new Logger({
      type: "hidden",
      ...capture,
      bindings: {
        sneaky: () => {
          invoked++;
          return "nope";
        },
        kept: "yes",
      },
    });
    const line = jsonLine(logger.info("call"), logger);
    expect(invoked).toBe(0);
    expect(line).toContain('"kept":"yes"');
    expect(line).not.toContain("nope");
  });

  test("the default logObj still wins over bindings", () => {
    const logger = new Logger<Record<string, unknown>>({ type: "hidden", ...capture, bindings: { source: "bindings" } }, { source: "defaults" });
    const line = jsonLine(logger.info("who wins"), logger as Logger<unknown>);
    expect(line).toContain('"source":"defaults"');
  });

  test("records with bindings keep the planned/object-path byte identity", () => {
    const logger = new Logger({ type: "hidden", ...capture, bindings: { tenant: "acme" } });
    const cases = [logger.info("hello"), logger.info("msg", { fresh: 1 }), logger.info({ a: 1 })];
    for (const logObj of cases) {
      const record = logObj as never;
      expect(renderJson(record, logger.settings)).toBe(jsonStringifyValue(toFlatJsonObject(record, logger.settings)));
    }
  });
});

describe("custom level methods", () => {
  test("addLevel installs a typed method that logs with the canonical name and id", () => {
    const logger = new Logger({ type: "hidden", ...capture }).addLevel("NOTICE", 3.5);
    const logObj = logger.notice("heads up", { detail: 1 });

    const meta = (logObj as Record<string, { logLevelId: number; logLevelName: string }>)?._meta;
    expect(meta?.logLevelId).toBe(3.5);
    expect(meta?.logLevelName).toBe("NOTICE");
    const line = jsonLine(logObj, logger);
    expect(line).toContain('"detail":1');
  });

  test("constructor customLevels install methods, and createLogger types them", () => {
    const logger = createLogger({ type: "hidden", ...capture, customLevels: { AUDIT: 7 } });
    const logObj = logger.audit("permission granted");
    const meta = (logObj as Record<string, { logLevelId: number; logLevelName: string }>)?._meta;
    expect(meta?.logLevelId).toBe(7);
    expect(meta?.logLevelName).toBe("AUDIT");
  });

  test("lowercase-registered levels resolve case-insensitively for minLevel and isLevelEnabled", () => {
    const logger = new Logger({ type: "hidden", ...capture, customLevels: { audit: 8 }, minLevel: "AUDIT" });
    expect(logger.settings.minLevel).toBe(8);
    expect(logger.isLevelEnabled("AUDIT")).toBe(true);
    expect(logger.isLevelEnabled("audit")).toBe(true);
    expect(logger.info("below")).toBeUndefined();
  });

  test("sub-loggers inherit custom level methods", () => {
    const root = new Logger({ type: "hidden", ...capture, customLevels: { AUDIT: 7 } });
    const child = root.getSubLogger({ name: "child" }) as Logger<unknown> & { audit?: (...args: unknown[]) => unknown };
    expect(typeof child.audit).toBe("function");
    const logObj = child.audit?.("inherited") as Record<string, { logLevelName: string }>;
    expect(logObj?._meta?.logLevelName).toBe("AUDIT");
  });

  test("a custom level colliding with a reserved logger member throws at construction", () => {
    // Throwing keeps the type surface honest: the typed method could never be installed.
    expect(() => new Logger({ type: "hidden", ...capture, customLevels: { FLUSH: 5 } })).toThrow(/reserved|collides/);
    expect(() => new Logger({ type: "hidden", ...capture, customLevels: { LOG: 15 } })).toThrow(/collides/);
  });

  test("custom levels differing only by case are rejected", () => {
    expect(() => new Logger({ type: "hidden", ...capture, customLevels: { AUDIT: 7, audit: 8 } })).toThrow(/case/);
    const logger = new Logger({ type: "hidden", ...capture }).addLevel("NOTICE", 3.5);
    expect(() => logger.addLevel("notice", 4)).toThrow(/case/);
  });

  test("bindings colliding with reserved record keys or integer-like names are dropped with a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const logger = new Logger({
        type: "hidden",
        ...capture,
        bindings: { message: "hijack", 2: "positional", _meta: "nope", kept: "yes" },
      });
      const line = jsonLine(logger.info("real message"), logger);
      expect(line).toContain('"message":"real message"');
      expect(line).toContain('"kept":"yes"');
      expect(line).not.toContain("hijack");
      expect(line).not.toContain("positional");
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain('binding "message" was dropped');
      expect(output).toContain('binding "2" was dropped');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("bindings stay at the top level when logging a lone Error", () => {
    const logger = new Logger({ type: "hidden", ...capture, bindings: { service: "checkout", region: "eu" } });
    const line = jsonLine(logger.error(new Error("boom")), logger);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.service).toBe("checkout");
    expect(parsed.region).toBe("eu");
    const error = parsed.error as Record<string, unknown>;
    expect(error.message).toBe("boom");
    expect(error.service).toBeUndefined();
    expect(error.region).toBeUndefined();
  });

  test("hash-censored bindings keep the SAME correlation token down the sub-logger chain", () => {
    const root = new Logger({
      type: "hidden",
      ...capture,
      mask: { keys: ["token"], censor: "hash" },
      bindings: { token: "super-secret" },
    });
    const child = root.getSubLogger({ name: "child" });
    const grandchild = child.getSubLogger({ name: "gc" });

    const extract = (logger: Logger<unknown>): string => {
      const line = jsonLine(logger.info("x"), logger);
      return (JSON.parse(line) as { token: string }).token;
    };
    const rootToken = extract(root as Logger<unknown>);
    expect(rootToken).toMatch(/^\[hash:[0-9a-f]{8}\]$/);
    expect(extract(child as Logger<unknown>)).toBe(rootToken);
    expect(extract(grandchild as Logger<unknown>)).toBe(rootToken);
  });

  test("a drifting (id, name) pair for a registered custom level warns in development", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const logger = new Logger({ type: "hidden", ...capture, customLevels: { AUDIT: 8 } });
      logger.log(3, "AUDIT", "drifting id");
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("does not match the registered id 8");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("no drift warning when the pair matches or no custom levels exist", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const plain = new Logger({ type: "hidden", ...capture });
      plain.log(3, "INFO", "fine");
      const custom = new Logger({ type: "hidden", ...capture, customLevels: { AUDIT: 8 } });
      custom.log(8, "AUDIT", "fine too");
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
