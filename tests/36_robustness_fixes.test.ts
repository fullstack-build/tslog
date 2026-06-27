import { Logger } from "../src/index.js";

type MaskInternals = {
  _recursiveCloneAndMaskValuesOfKeys: (source: unknown, keys: (string | number)[], seen?: unknown[]) => unknown;
  _getMaskKeys: () => (string | number)[];
};

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
      expect((returnValue as Record<string, unknown>)?._meta).toBeDefined();

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
      expect((returnValue as Record<string, unknown>)?._meta).toBeDefined();

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
      const logger = new Logger({
        type: "json",
        maskValuesRegEx: [/(.)(.)/],
        maskPlaceholder: "$1SECRET",
      }) as unknown as MaskInternals;

      const result = logger._recursiveCloneAndMaskValuesOfKeys("ab", []);
      // Without escaping "$1" would expand to the first capture group ("a") yielding "aSECRET".
      expect(result).toBe("$1SECRET");
    });

    test('placeholder containing "$&" is inserted literally, not the whole match', () => {
      const logger = new Logger({
        type: "json",
        maskValuesRegEx: [/secret/gi],
        maskPlaceholder: "[$&]",
      }) as unknown as MaskInternals;

      const result = logger._recursiveCloneAndMaskValuesOfKeys("my secret here", []) as string;
      // "$&" must NOT expand to the matched "secret".
      expect(result).toContain("[$&]");
      expect(result).not.toContain("[secret]");
      expect(result).toBe("my [$&] here");
    });

    test('default placeholder "[***]" (no "$") is still replaced normally', () => {
      const logger = new Logger({
        type: "json",
        maskValuesRegEx: [/secret/gi],
      }) as unknown as MaskInternals;

      const result = logger._recursiveCloneAndMaskValuesOfKeys("my secret here", []) as string;
      expect(result).toBe("my [***] here");
    });
  });

  describe("Fix 3 - numeric maskValuesOfKeys match string property names", () => {
    test("a numeric mask key masks the matching string property name", () => {
      const logger = new Logger({
        type: "json",
        maskValuesOfKeys: [123 as unknown as string],
      }) as unknown as MaskInternals;

      const maskKeys = logger._getMaskKeys();
      const result = logger._recursiveCloneAndMaskValuesOfKeys({ 0: "ok", 123: "secret" }, maskKeys) as Record<string, unknown>;

      expect(result["123"]).toBe("[***]");
      expect(result["0"]).toBe("ok");
    });

    test("mixed string and numeric mask keys", () => {
      const logger = new Logger({
        type: "json",
        maskValuesOfKeys: ["password", 42 as unknown as string],
      }) as unknown as MaskInternals;

      const maskKeys = logger._getMaskKeys();
      const result = logger._recursiveCloneAndMaskValuesOfKeys({ password: "p", 42: "q", keep: "k" }, maskKeys) as Record<string, unknown>;

      expect(result["password"]).toBe("[***]");
      expect(result["42"]).toBe("[***]");
      expect(result["keep"]).toBe("k");
    });

    test("case-insensitive masking still works alongside string keys", () => {
      const logger = new Logger({
        type: "json",
        maskValuesOfKeys: ["Token"],
        maskValuesOfKeysCaseInsensitive: true,
      }) as unknown as MaskInternals;

      const maskKeys = logger._getMaskKeys();
      const result = logger._recursiveCloneAndMaskValuesOfKeys({ token: "abc", other: "v" }, maskKeys) as Record<string, unknown>;

      expect(result["token"]).toBe("[***]");
      expect(result["other"]).toBe("v");
    });

    test("the case-sensitive mask-keys cache returns a stable normalized array across calls", () => {
      const logger = new Logger({
        type: "json",
        maskValuesOfKeys: ["password", 7 as unknown as string],
      }) as unknown as MaskInternals;

      const first = logger._getMaskKeys();
      const second = logger._getMaskKeys();

      // Same reference returned from the cache on the second call.
      expect(second).toBe(first);
      expect(first).toEqual(["password", "7"]);
    });
  });
});
