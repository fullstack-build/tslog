import type { ISettingsParam } from "../src/index.js";
import { defineConfig, Logger, LogLevel, TslogConfigError } from "../src/index.js";

// M3b — additive DX surface (E1–E6): isLevelEnabled, child() alias, Symbol.dispose, Logger.fromEnv,
// defineConfig identity helper, and strictConfig throwing a typed TslogConfigError.

describe("isLevelEnabled (E4)", () => {
  test("compares the resolved level id against minLevel", () => {
    const logger = new Logger({ type: "hidden", minLevel: "WARN" });
    expect(logger.isLevelEnabled("ERROR")).toBe(true);
    expect(logger.isLevelEnabled("WARN")).toBe(true); // at minLevel is enabled
    expect(logger.isLevelEnabled("INFO")).toBe(false);
    expect(logger.isLevelEnabled(LogLevel.DEBUG)).toBe(false);
    expect(logger.isLevelEnabled(6)).toBe(true);
  });

  test("honors a custom level by name and id", () => {
    const logger = new Logger({ type: "hidden", minLevel: "NOTICE", customLevels: { NOTICE: 3.5 } });
    expect(logger.settings.minLevel).toBe(3.5);
    expect(logger.isLevelEnabled("NOTICE")).toBe(true);
    expect(logger.isLevelEnabled(3.5)).toBe(true);
    expect(logger.isLevelEnabled("INFO")).toBe(false); // INFO(3) < 3.5
    expect(logger.isLevelEnabled("WARN")).toBe(true); // WARN(4) >= 3.5
  });

  test("an unknown level name returns false", () => {
    const logger = new Logger({ type: "hidden", minLevel: "SILLY" });
    expect(logger.isLevelEnabled("LOUD" as never)).toBe(false);
  });
});

describe("child() alias (E2)", () => {
  test("behaves like getSubLogger and inherits the name", () => {
    const parent = new Logger({ type: "hidden", name: "parent", minLevel: "INFO" });
    const viaChild = parent.child({ name: "kid" });
    const viaSub = parent.getSubLogger({ name: "kid" });

    expect(viaChild).toBeInstanceOf(Logger);
    // Same inheritance: minLevel carried over, parentNames collected from the parent's name.
    expect(viaChild.settings.minLevel).toBe(LogLevel.INFO);
    expect(viaChild.settings.name).toBe("kid");
    expect(viaChild.settings.parentNames).toEqual(["parent"]);
    // child() and getSubLogger() resolve to the same settings shape.
    expect(viaChild.settings.parentNames).toEqual(viaSub.settings.parentNames);
    expect(viaChild.settings.name).toBe(viaSub.settings.name);
  });

  test("child() of a sub-logger keeps merging settings overrides", () => {
    const parent = new Logger({ type: "hidden", minLevel: "SILLY" });
    const child = parent.child({ minLevel: "ERROR" });
    expect(child.warn("below")).toBeUndefined();
    expect(child.error("at")).toBeDefined();
  });
});

describe("Symbol.dispose (E1)", () => {
  test("a logger is sync-disposable and best-effort flushes/disposes transports", () => {
    let disposed = false;
    let flushed = false;
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport({
      name: "t",
      write: () => undefined,
      flush: async () => {
        flushed = true;
      },
      [Symbol.asyncDispose]: async () => {
        disposed = true;
      },
    });

    expect(typeof logger[Symbol.dispose]).toBe("function");
    // Synchronous disposal kicks off flush+dispose (best-effort, not awaited) without throwing.
    expect(() => logger[Symbol.dispose]()).not.toThrow();
    expect(flushed).toBe(true);
    expect(disposed).toBe(true);
  });

  test("works under a synchronous `using` scope", () => {
    let count = 0;
    {
      using logger = new Logger({ type: "hidden" });
      logger.attachTransport({ write: () => undefined, flush: async () => void (count += 1) });
    }
    expect(count).toBe(1);
  });
});

describe("Logger.fromEnv (E3)", () => {
  function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const keys = ["TSLOG_LEVEL", "TSLOG_TYPE", "TSLOG_NAME"];
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) prev[k] = process.env[k];
    try {
      for (const k of keys) {
        if (vars[k] == null) delete process.env[k];
        else process.env[k] = vars[k];
      }
      fn();
    } finally {
      for (const k of keys) {
        if (prev[k] == null) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  }

  test("reads TSLOG_LEVEL / TSLOG_TYPE / TSLOG_NAME", () => {
    withEnv({ TSLOG_LEVEL: "WARN", TSLOG_TYPE: "json", TSLOG_NAME: "api" }, () => {
      const logger = Logger.fromEnv();
      expect(logger.settings.minLevel).toBe(LogLevel.WARN);
      expect(logger.settings.type).toBe("json");
      expect(logger.settings.name).toBe("api");
    });
  });

  test("a numeric TSLOG_LEVEL resolves to that id", () => {
    withEnv({ TSLOG_LEVEL: "5", TSLOG_TYPE: undefined, TSLOG_NAME: undefined }, () => {
      const logger = Logger.fromEnv({ type: "hidden" });
      expect(logger.settings.minLevel).toBe(5);
    });
  });

  test("overrides win over env-derived settings", () => {
    withEnv({ TSLOG_LEVEL: "WARN", TSLOG_TYPE: "json", TSLOG_NAME: "api" }, () => {
      const logger = Logger.fromEnv({ minLevel: "ERROR", name: "override" });
      expect(logger.settings.minLevel).toBe(LogLevel.ERROR);
      expect(logger.settings.name).toBe("override");
      expect(logger.settings.type).toBe("json"); // not overridden, kept from env
    });
  });

  test("an invalid TSLOG_TYPE is ignored", () => {
    withEnv({ TSLOG_TYPE: "bogus", TSLOG_LEVEL: undefined, TSLOG_NAME: undefined }, () => {
      const logger = Logger.fromEnv({ type: "hidden" });
      expect(logger.settings.type).toBe("hidden");
    });
  });
});

describe("defineConfig (E5)", () => {
  test("returns its input unchanged", () => {
    const settings: ISettingsParam<unknown> = { type: "json", minLevel: "INFO", mask: { keys: ["password"] } };
    const out = defineConfig(settings);
    expect(out).toBe(settings);
  });

  test("the result is usable as Logger settings", () => {
    const config = defineConfig({ type: "hidden", minLevel: "WARN" });
    const logger = new Logger(config);
    expect(logger.settings.minLevel).toBe(LogLevel.WARN);
    expect(logger.info("below")).toBeUndefined();
    expect(logger.warn("at")).toBeDefined();
  });
});

describe("strictConfig + TslogConfigError (E6)", () => {
  test("throws a typed error with code/setting/suggestion on an unknown minLevel", () => {
    let caught: unknown;
    try {
      new Logger({ type: "hidden", strictConfig: true, minLevel: "LOUD" as never });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TslogConfigError);
    const err = caught as TslogConfigError;
    expect(err.code).toBe("UNKNOWN_MIN_LEVEL");
    expect(err.setting).toBe("minLevel");
    expect(err.suggestion.length).toBeGreaterThan(0);
    expect(err.message).toMatch(/unknown minLevel/);
  });

  test("throws on an out-of-range numeric minLevel", () => {
    expect(() => new Logger({ type: "hidden", strictConfig: true, minLevel: 99 })).toThrow(TslogConfigError);
  });

  test("throws on a typo'd pretty template placeholder", () => {
    let caught: unknown;
    try {
      new Logger({ type: "pretty", strictConfig: true, pretty: { template: "{{loglevelname}} " } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TslogConfigError);
    expect((caught as TslogConfigError).code).toBe("UNKNOWN_PRETTY_PLACEHOLDER");
    expect((caught as TslogConfigError).setting).toBe("pretty.template");
  });

  test("strict mode throws even when dev warnings are disabled (production)", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => new Logger({ type: "hidden", strictConfig: true, minLevel: 99 })).toThrow(TslogConfigError);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test("default (strictConfig unset) still warns, never throws", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let threw = false;
    try {
      new Logger({ type: "hidden", minLevel: "LOUD" as never });
    } catch {
      threw = true;
    }
    const warned = warnSpy.mock.calls.some((c) => /unknown minLevel/.test(String(c[0])));
    warnSpy.mockRestore();
    expect(threw).toBe(false);
    expect(warned).toBe(true);
  });

  test("a valid strict config does not throw", () => {
    expect(() => new Logger({ type: "json", strictConfig: true, minLevel: "INFO" })).not.toThrow();
  });
});

describe("unknown-key and v4-flat-key validation", () => {
  test("a typo'd top-level key warns with a did-you-mean suggestion", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Logger({ type: "hidden", minLvl: 3 } as never);
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain('unknown setting "minLvl"');
      expect(output).toContain('did you mean "minLevel"');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a typo inside a group warns with the group-qualified suggestion", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Logger({ type: "hidden", pretty: { tempalte: "x" } } as never);
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain('unknown setting "pretty.tempalte"');
      expect(output).toContain('did you mean "pretty.template"');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a v4 flat key gets a precise migration hint", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Logger({ type: "hidden", maskValuesOfKeys: ["password"] } as never);
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain('"maskValuesOfKeys" was removed in v5');
      expect(output).toContain("mask.keys");
      expect(output).toContain("MIGRATION_v4_to_v5.md");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("strictConfig turns an unknown key into a typed UNKNOWN_SETTING error", () => {
    let caught: unknown;
    try {
      new Logger({ type: "hidden", strictConfig: true, masks: { keys: ["password"] } } as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TslogConfigError);
    expect((caught as TslogConfigError).code).toBe("UNKNOWN_SETTING");
    expect((caught as TslogConfigError).setting).toBe("masks");
    expect((caught as TslogConfigError).message).toContain('did you mean "mask"');
  });

  test("strictConfig turns a v4 flat key into a typed V4_FLAT_KEY error", () => {
    let caught: unknown;
    try {
      new Logger({ type: "hidden", strictConfig: true, prettyLogTemplate: "{{logLevelName}} " } as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TslogConfigError);
    expect((caught as TslogConfigError).code).toBe("V4_FLAT_KEY");
    expect((caught as TslogConfigError).message).toContain("pretty.template");
  });

  test("a pure casing mistake suggests the intended key", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Logger({ type: "hidden", Mask: { keys: ["x"] } } as never);
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain('did you mean "mask"');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a fully valid grouped config emits no warnings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Logger({
        type: "json",
        name: "api",
        minLevel: "INFO",
        mask: { keys: ["password"], caseInsensitive: true },
        json: { messageKey: "msg", stableKeyOrder: false },
        pretty: { timeZone: "UTC" },
        stack: { capture: "off" },
        meta: { property: "_meta", attachContext: true },
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("the 4.11 flat keys internalFramePatterns and prettyLogLevelMethod get precise hints", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Logger({ type: "hidden", internalFramePatterns: [/x/], prettyLogLevelMethod: {} } as never);
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("stack.internalFramePatterns");
      expect(output).toContain("pretty.levelMethod");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("settings keys named after Object.prototype members are not misreported as v4 keys", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      new Logger({ type: "hidden", constructor: 1, toString: 2 } as never);
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain('unknown setting "constructor"');
      expect(output).not.toContain("was removed in v5");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a hostile Proxy group value never crashes warn-only construction", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("boom from ownKeys");
          },
        },
      );
      expect(() => new Logger({ type: "hidden", pretty: hostile } as never)).not.toThrow();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("creating a sub-logger from resolved settings emits no warnings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const logger = new Logger({ type: "hidden", name: "root", mask: { keys: ["password"] } });
      logger.getSubLogger({ name: "child" });
      logger.child({ name: "child2" });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
