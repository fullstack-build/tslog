import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("Exotic types", () => {
  describe("JSON mode", () => {
    const logger = new Logger({ type: "json" });

    beforeEach(() => mockConsoleLog(true, false));

    test("Symbol as log argument", () => {
      expect(() => logger.info(Symbol("test-sym"))).not.toThrow();
      expect(getConsoleLog()).toContain("_meta");
    });

    test("RegExp as log argument", () => {
      const logObj = logger.info(/test-pattern/gi);
      expect(logObj).toBeDefined();
      // RegExp serializes to { lastIndex: 0 } via JSON.stringify (no source property)
      expect(getConsoleLog()).toContain("_meta");
    });

    test("Typed array (Uint8Array)", () => {
      expect(() => logger.info(new Uint8Array([1, 2, 3]))).not.toThrow();
      expect(getConsoleLog()).toContain("_meta");
    });

    test("BigInt serializes in JSON output", () => {
      expect(() => logger.info({ value: BigInt(9007199254740991) })).not.toThrow();
      expect(getConsoleLog()).toContain("9007199254740991");
    });

    test("Function as log argument is not executed", () => {
      let called = false;
      const fn = () => {
        called = true;
        return "result";
      };
      // Functions with parameters > 0 should not be executed
      const twoArgFn = (a: string, b: string) => a + b;
      logger.info(twoArgFn);
      expect(called).toBe(false);
    });

    test("Promise as log argument does not throw", () => {
      expect(() => logger.info(Promise.resolve("test"))).not.toThrow();
    });

    test("Date serialization", () => {
      const date = new Date("2024-01-15T12:00:00Z");
      const logObj = logger.info(date);
      expect(logObj).toBeDefined();
    });

    test("null and undefined together", () => {
      const logObj = logger.info(null, undefined);
      expect(logObj?.["0"]).toBeNull();
      expect(getConsoleLog()).toContain("null");
    });

    test("Map and Set as log arguments", () => {
      const map = new Map([["key", "value"]]);
      const set = new Set([1, 2, 3]);
      expect(() => logger.info({ map, set })).not.toThrow();
    });

    test("URL object serialization", () => {
      const url = new URL("https://example.com/path?q=test");
      expect(() => logger.info(url)).not.toThrow();
    });
  });

  describe("Pretty mode", () => {
    const logger = new Logger({ type: "pretty", stylePrettyLogs: false });

    beforeEach(() => mockConsoleLog(true, false));

    test("Symbol does not throw in pretty mode", () => {
      expect(() => logger.info(Symbol("pretty-sym"))).not.toThrow();
    });

    test("RegExp renders in pretty mode without throwing", () => {
      expect(() => logger.info(/pattern/i)).not.toThrow();
      expect(getConsoleLog().length).toBeGreaterThan(0);
    });

    test("mixed exotic types in single call", () => {
      expect(() => {
        logger.info("text", 42, true, null, undefined, /regex/, new Date());
      }).not.toThrow();
      const output = getConsoleLog();
      expect(output).toContain("text");
      expect(output).toContain("42");
    });
  });

  describe("Hidden mode (no console, return logObj)", () => {
    const logger = new Logger({ type: "hidden" });

    test("all exotic types return valid logObj", () => {
      expect(logger.info(Symbol("s"))).toBeDefined();
      expect(logger.info(/re/)).toBeDefined();
      expect(logger.info(new Uint8Array([0]))).toBeDefined();
      expect(logger.info(new Date())).toBeDefined();
      expect(logger.info(new Map())).toBeDefined();
      expect(logger.info(new Set())).toBeDefined();
      expect(logger.info(new URL("https://x.com"))).toBeDefined();
    });
  });
});
