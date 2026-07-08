import { MaskingEngine } from "../src/core/masking.js";
import { normalizeSettings } from "../src/core/settings.js";
import { createNodeEnvironment } from "../src/env/environment.node.js";
import { Logger } from "../src/index.js";
import type { ISettingsParam } from "../src/interfaces.js";

/**
 * Build a MaskingEngine wired to a fully-normalized settings object and the Node runtime predicates.
 *
 * v5 moved the masking internals out of the Logger and into a standalone `MaskingEngine` (core/masking.ts).
 * The v4 tests reached into the Logger via `_recursiveCloneAndMaskValuesOfKeys` / `_getMaskKeys`; those
 * methods now live on the engine, so the genuine masking unit tests below are repointed to it directly.
 */
function createMaskingEngine(settings?: ISettingsParam<unknown>): MaskingEngine<unknown> {
  const normalized = normalizeSettings(settings);
  const env = createNodeEnvironment();
  return new MaskingEngine<unknown>(normalized, {
    isError: (value): value is Error => env.isError(value),
    isBuffer: (value) => env.isBuffer(value),
  });
}

describe("Robustness fixes", () => {
  describe("Fix 1 - attached transport isolation", () => {
    test("a throwing transport does not prevent other transports from running and logging never throws", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const recorded: string[] = [];

      const logger = new Logger({ type: "hidden" });
      logger.attachTransport(() => {
        recorded.push("A");
        throw new Error("transport A failure");
      });
      logger.attachTransport(() => {
        recorded.push("B");
      });

      let returnValue: unknown;
      expect(() => {
        returnValue = logger.info("x");
      }).not.toThrow();

      // Both transports ran even though A threw before B.
      expect(recorded).toEqual(["A", "B"]);

      // console.error reported the transport error.
      expect(consoleErrorSpy).toHaveBeenCalled();
      const firstCall = consoleErrorSpy.mock.calls[0];
      expect(firstCall[0]).toBe("tslog: attached transport threw an error");
      expect(firstCall[1]).toBeInstanceOf(Error);
      expect((firstCall[1] as Error).message).toBe("transport A failure");

      // The log object is still returned despite a transport throwing.
      expect(returnValue).toBeDefined();
      expect((returnValue as Record<string, unknown>)?._logMeta).toBeDefined();

      consoleErrorSpy.mockRestore();
    });

    test("default console output / return value still happens when a transport throws", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      const logger = new Logger({ type: "json" });
      logger.attachTransport(() => {
        throw new Error("boom");
      });

      let returnValue: unknown;
      expect(() => {
        returnValue = logger.info("payload");
      }).not.toThrow();

      // The default JSON transport (console.log) still emitted output.
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      // The transport error was reported.
      expect(consoleErrorSpy).toHaveBeenCalled();
      // The log object is still returned (defined) even when a transport throws.
      expect(returnValue).toBeDefined();
      expect((returnValue as Record<string, unknown>)?._logMeta).toBeDefined();

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    test("multiple throwing transports are all invoked and logging never throws", () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const invoked: number[] = [];

      const logger = new Logger({ type: "hidden" });
      logger.attachTransport(() => {
        invoked.push(1);
        throw new Error("fail 1");
      });
      logger.attachTransport(() => {
        invoked.push(2);
        throw new Error("fail 2");
      });
      logger.attachTransport(() => {
        invoked.push(3);
        throw new Error("fail 3");
      });

      expect(() => logger.warn("multi")).not.toThrow();

      // All three transports were invoked despite every one throwing.
      expect(invoked).toEqual([1, 2, 3]);
      // Each failure was reported.
      expect(consoleErrorSpy).toHaveBeenCalledTimes(3);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Fix 2 - maskValuesRegEx placeholder $ is escaped and inserted literally", () => {
    test('placeholder "$1SECRET" is inserted verbatim, not interpreted as a capture-group substitution', () => {
      const engine = createMaskingEngine({
        type: "json",
        mask: {
          regex: [/(.)(.)/],
          placeholder: "$1SECRET",
        },
      });

      const result = engine.recursiveCloneAndMaskValuesOfKeys("ab", []);
      // Without escaping "$1" would expand to the first capture group ("a") yielding "aSECRET".
      expect(result).toBe("$1SECRET");
    });

    test('placeholder containing "$&" is inserted literally, not the whole match', () => {
      const engine = createMaskingEngine({
        type: "json",
        mask: {
          regex: [/secret/gi],
          placeholder: "[$&]",
        },
      });

      const result = engine.recursiveCloneAndMaskValuesOfKeys("my secret here", []) as string;
      // "$&" must NOT expand to the matched "secret".
      expect(result).toContain("[$&]");
      expect(result).not.toContain("[secret]");
      expect(result).toBe("my [$&] here");
    });

    test('default placeholder "[***]" (no "$") is still replaced normally', () => {
      const engine = createMaskingEngine({
        type: "json",
        mask: {
          regex: [/secret/gi],
        },
      });

      const result = engine.recursiveCloneAndMaskValuesOfKeys("my secret here", []) as string;
      expect(result).toBe("my [***] here");
    });
  });

  describe("Fix 3 - numeric maskValuesOfKeys match string property names", () => {
    test("a numeric mask key masks the matching string property name", () => {
      const engine = createMaskingEngine({
        type: "json",
        mask: {
          keys: [123 as unknown as string],
        },
      });

      const maskKeys = engine.getMaskKeys();
      const result = engine.recursiveCloneAndMaskValuesOfKeys({ 0: "ok", 123: "secret" }, maskKeys) as Record<string, unknown>;

      expect(result["123"]).toBe("[***]");
      expect(result["0"]).toBe("ok");
    });

    test("mixed string and numeric mask keys", () => {
      const engine = createMaskingEngine({
        type: "json",
        mask: {
          keys: ["password", 42 as unknown as string],
        },
      });

      const maskKeys = engine.getMaskKeys();
      const result = engine.recursiveCloneAndMaskValuesOfKeys({ password: "p", 42: "q", keep: "k" }, maskKeys) as Record<string, unknown>;

      expect(result["password"]).toBe("[***]");
      expect(result["42"]).toBe("[***]");
      expect(result["keep"]).toBe("k");
    });

    test("case-insensitive masking still works alongside string keys", () => {
      const engine = createMaskingEngine({
        type: "json",
        mask: {
          keys: ["Token"],
          caseInsensitive: true,
        },
      });

      const maskKeys = engine.getMaskKeys();
      const result = engine.recursiveCloneAndMaskValuesOfKeys({ token: "abc", other: "v" }, maskKeys) as Record<string, unknown>;

      expect(result["token"]).toBe("[***]");
      expect(result["other"]).toBe("v");
    });

    test("the case-sensitive mask-keys cache returns a stable normalized array across calls", () => {
      const engine = createMaskingEngine({
        type: "json",
        mask: {
          keys: ["password", 7 as unknown as string],
        },
      });

      const first = engine.getMaskKeys();
      const second = engine.getMaskKeys();

      // Same reference returned from the cache on the second call.
      expect(second).toBe(first);
      expect(first).toEqual(["password", "7"]);
    });
  });
});
