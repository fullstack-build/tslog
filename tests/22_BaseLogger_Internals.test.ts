import "ts-jest";
import { Logger } from "../src/index.js";
import { IErrorObject } from "../src/interfaces.js";

describe("BaseLogger internals", () => {
  test("cloneError creates a new instance", () => {
    const logger = new Logger({ type: "json" });
    const base = logger as unknown as {
      _cloneError: (error: Error) => Error;
    };
    const original = new Error("boom");
    const clone = base._cloneError(original);

    expect(clone).not.toBe(original);
    expect(clone.message).toBe("boom");
  });

  test("toErrorObject respects max depth", () => {
    const logger = new Logger({ type: "json" });
    const base = logger as unknown as {
      _toErrorObject: (error: Error, depth?: number, seen?: Set<Error>) => IErrorObject;
      maxErrorCauseDepth: number;
    };

    const tail = new Error("tail");
    const head = new Error("head");
    (head as Error & { cause?: unknown }).cause = tail;

    const capped = base._toErrorObject(head, base.maxErrorCauseDepth);
    expect(capped.cause).toBeUndefined();
  });

  test("masking gracefully falls back to null when getters throw", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };

    const source: Record<string, unknown> = {};
    Object.defineProperty(source, "safe", {
      value: "ok",
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(source, "boom", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("fail");
      },
    });

    const cloned = internals._recursiveCloneAndMaskValuesOfKeys(source, []) as Record<string, unknown>;

    expect(cloned.safe).toBe("ok");
    expect(cloned.boom).toBeNull();
  });

  test("cloning duplicates date instances instead of reusing references", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _recursiveCloneAndExecuteFunctions: <T>(source: T, seen?: unknown[]) => T;
    };

    const original = new Date("2024-01-01T00:00:00Z");
    const cloned = internals._recursiveCloneAndExecuteFunctions(original) as Date;

    expect(cloned).not.toBe(original);
    expect((cloned as Date).getTime()).toBe(original.getTime());
  });

  test("recursive cloning breaks array cycles via shallow copies", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _recursiveCloneAndExecuteFunctions: <T>(source: T, seen?: unknown[]) => T;
    };

    const cyclic: unknown[] = [];
    cyclic.push(cyclic);

    const cloned = internals._recursiveCloneAndExecuteFunctions(cyclic) as unknown[];

    expect(Array.isArray(cloned)).toBe(true);
    expect(cloned).not.toBe(cyclic);
    const inner = cloned[0] as unknown[];
    expect(Array.isArray(inner)).toBe(true);
    expect(inner[0]).toBe(cyclic);
  });

  test("mask key lookup caches normalized values in case-insensitive mode", () => {
    const logger = new Logger({
      type: "json",
      maskValuesOfKeys: ["Password"],
      maskValuesOfKeysCaseInsensitive: true,
    });
    const internals = logger as unknown as {
      _getMaskKeys: () => (string | number)[];
    };

    const first = internals._getMaskKeys();
    const second = internals._getMaskKeys();

    expect(first).toBe(second);
    expect(first).toEqual(["password"]);
  });

  test("get mask keys returns original array in case-sensitive mode", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _getMaskKeys: () => (string | number)[];
    };

    logger.settings.maskValuesOfKeys = ["token"];
    const result = internals._getMaskKeys();

    expect(result).toBe(logger.settings.maskValuesOfKeys);
  });

  test("numeric mask keys are normalized when lower-casing", () => {
    const logger = new Logger({
      type: "json",
      maskValuesOfKeysCaseInsensitive: true,
    });
    logger.settings.maskValuesOfKeys = [123 as unknown as string];
    const internals = logger as unknown as { _getMaskKeys: () => (string | number)[] };

    expect(internals._getMaskKeys()).toEqual(["123"]);
  });

  test("mask keys fall back to empty array when not configured", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as { _getMaskKeys: () => (string | number)[] };
    logger.settings.maskValuesOfKeys = undefined as unknown as string[];

    expect(internals._getMaskKeys()).toEqual([]);
  });

  test("resolveLogArguments executes zero-arity functions", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _resolveLogArguments: (args: unknown[]) => unknown[];
    };

    const eager = internals._resolveLogArguments([() => ["foo", "bar"]]);
    expect(eager).toEqual(["foo", "bar"]);

    const single = internals._resolveLogArguments([() => "value"]);
    expect(single).toEqual(["value"]);

    const passthrough = internals._resolveLogArguments([(value: string) => value]);
    expect(typeof passthrough[0]).toBe("function");
  });

  test("recursive masking clones maps, sets, and URLs", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };

    const originalMap = new Map([["a", 1]]);
    const clonedMap = internals._recursiveCloneAndMaskValuesOfKeys(originalMap, []);
    expect(clonedMap).toBeInstanceOf(Map);
    expect(clonedMap).not.toBe(originalMap);
    expect([...clonedMap.entries()]).toEqual([...originalMap.entries()]);

    const originalSet = new Set([1, 2]);
    const clonedSet = internals._recursiveCloneAndMaskValuesOfKeys(originalSet, []);
    expect(clonedSet).toBeInstanceOf(Set);
    expect(clonedSet).not.toBe(originalSet);
    expect([...clonedSet.values()]).toEqual([...originalSet.values()]);

    const originalUrl = new URL("https://example.com/path?x=1");
    const clonedUrl = internals._recursiveCloneAndMaskValuesOfKeys(originalUrl, []);
    expect(clonedUrl).toMatchObject({
      href: "https://example.com/path?x=1",
      protocol: "https:",
      pathname: "/path",
      search: "?x=1",
    });

    const maskedObject = internals._recursiveCloneAndMaskValuesOfKeys({ secret: "value", other: "keep" }, ["secret"]) as Record<string, unknown>;
    expect(maskedObject.secret).toBe(logger.settings.maskPlaceholder);
    expect(maskedObject.other).toBe("keep");

    const plainString = internals._recursiveCloneAndMaskValuesOfKeys("public", []);
    expect(plainString).toBe("public");

    const caseInsensitiveLogger = new Logger({
      type: "json",
      maskValuesOfKeys: ["Secret"],
      maskValuesOfKeysCaseInsensitive: true,
      maskPlaceholder: "[case]",
    });
    const caseInternals = caseInsensitiveLogger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };
    const caseKeys = (caseInsensitiveLogger as unknown as { _getMaskKeys: () => (string | number)[] })._getMaskKeys();
    const caseMasked = caseInternals._recursiveCloneAndMaskValuesOfKeys({ secret: "value" }, caseKeys) as Record<string, unknown>;
    expect(caseMasked.secret).toBe("[case]");
  });

  test("recursive masking applies regex replacements for strings", () => {
    const logger = new Logger({ type: "json", maskPlaceholder: "[***]", maskValuesRegEx: [/secret/gi] });
    const internals = logger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };

    const masked = internals._recursiveCloneAndMaskValuesOfKeys("SECRET-value", []);
    expect(masked).toBe("[***]-value");

    const noRegexLogger = new Logger({ type: "json" });
    const noRegexInternals = noRegexLogger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };
    expect(noRegexInternals._recursiveCloneAndMaskValuesOfKeys("unaltered", [])).toBe("unaltered");
  });

  test("case-insensitive masking handles non-string property names", () => {
    const logger = new Logger({
      type: "json",
      maskValuesOfKeysCaseInsensitive: true,
      maskValuesOfKeys: [123 as unknown as string],
      maskPlaceholder: "[case]",
    });
    const internals = logger as unknown as {
      _getMaskKeys: () => (string | number)[];
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };
    const maskKeys = internals._getMaskKeys();
    const spy = jest.spyOn(Object, "getOwnPropertyNames").mockImplementationOnce(() => [123 as unknown as string] as unknown as string[]);

    const result = internals._recursiveCloneAndMaskValuesOfKeys({ [123]: "value" } as Record<string, unknown>, maskKeys) as Record<string, unknown>;

    spy.mockRestore();
    expect(result[123 as unknown as string]).toBe("[case]");
  });

  test("string masking supports undefined regex configuration", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };

    logger.settings.maskValuesRegEx = null as unknown as RegExp[];

    expect(internals._recursiveCloneAndMaskValuesOfKeys("plain", [])).toBe("plain");
  });

  test("should capture stack when template requests file information", () => {
    const withStack = new Logger({
      type: "pretty",
      prettyLogTemplate: "{{filePath}}",
    });
    const withoutStack = new Logger({
      type: "pretty",
      hideLogPositionForProduction: true,
      prettyLogTemplate: "{{dateIsoStr}}",
    });
    const templateWithoutPlaceholder = new Logger({
      type: "pretty",
      prettyLogTemplate: "{{dateIsoStr}}",
    });
    const internalsWithStack = withStack as unknown as { _shouldCaptureStack: () => boolean };
    const internalsWithoutStack = withoutStack as unknown as { _shouldCaptureStack: () => boolean };
    const internalsTemplateOnly = templateWithoutPlaceholder as unknown as { _shouldCaptureStack: () => boolean };
    const defaultPretty = new Logger({ type: "pretty" });
    defaultPretty.settings.prettyLogTemplate = undefined as unknown as string;
    const internalsDefaultTemplate = defaultPretty as unknown as { _shouldCaptureStack: () => boolean };

    expect(internalsWithStack._shouldCaptureStack()).toBe(true);
    expect(internalsWithoutStack._shouldCaptureStack()).toBe(false);
    expect(internalsTemplateOnly._shouldCaptureStack()).toBe(false);
    expect(internalsDefaultTemplate._shouldCaptureStack()).toBe(false);
  });

  test("case-sensitive masking is exercised through log flow", () => {
    const logger = new Logger({
      type: "json",
      maskValuesOfKeys: ["token"],
      maskValuesOfKeysCaseInsensitive: false,
    });

    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    const log = logger.log(1, "test", { token: "foo", other: "bar" });
    expect(log?.token).toBe("[***]");
    expect(log?.other).toBe("bar");

    consoleSpy.mockRestore();
  });

  test("toErrorObject falls back to default error name", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _toErrorObject: (error: Error, depth?: number, seen?: Set<Error>) => IErrorObject;
    };

    const unnamed = new Error("boom");
    (unnamed as { name?: string }).name = undefined;
    const result = internals._toErrorObject(unnamed);
    expect(result.name).toBe("Error");
  });

  test("recursion guard recognizes error instances", () => {
    const logger = new Logger({ type: "json" });
    const internals = logger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };

    const error = new Error("boom");
    const result = internals._recursiveCloneAndMaskValuesOfKeys(error, []);
    expect(result).toBe(error);
  });

  test("recursive masking clones error prototypes when encountered", () => {
    const logger = new Logger({ type: "json" });
    const runtimeInternals = logger as unknown as { runtime: { isError: (value: unknown) => boolean } };
    const internals = logger as unknown as {
      _recursiveCloneAndMaskValuesOfKeys: <T>(source: T, keys: (number | string)[], seen?: unknown[]) => T;
    };

    const errorLike = { message: "boom" };
    const isErrorSpy = jest.spyOn(runtimeInternals.runtime, "isError");
    isErrorSpy
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => true)
      .mockImplementation(() => false);

    const cloned = internals._recursiveCloneAndMaskValuesOfKeys(errorLike, []);
    expect(cloned).not.toBe(errorLike);
    isErrorSpy.mockRestore();
  });
});
