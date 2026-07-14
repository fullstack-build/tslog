import { cloneError, type LogObjDeps, recursiveCloneAndExecuteFunctions, toErrorObject } from "../src/core/logObj.js";
import { MaskingEngine, type MaskingPredicates } from "../src/core/masking.js";
import { Logger } from "../src/index.js";
import { IErrorObject } from "../src/interfaces.js";

/**
 * v5 migration note: the v4 monolith exposed these internals as private `_`-prefixed methods on the
 * logger instance. In v5 they live in dedicated, runtime-agnostic core modules:
 *   - cloning / error / logObj helpers -> ../src/core/logObj.js
 *   - the masking engine               -> ../src/core/masking.js (MaskingEngine)
 * Both take explicit predicate/deps parameters instead of reaching for a module-level `runtime`
 * singleton. The tests below repoint to those new homes. `_resolveLogArguments` and
 * `_shouldCaptureStack` are still private methods on BaseLogger, so those tests still cast the logger.
 *
 * The masking predicates intentionally delegate to the LIVE `logger.runtime.isError` / `isBuffer` at
 * call time (rather than capturing the function references) so tests that spy on
 * `logger.runtime.isError` still observe the engine's calls — matching the v4 behavior where the
 * monolith read `this.runtime.isError` on every invocation.
 */
function predicatesFor<LogObj>(logger: Logger<LogObj>): MaskingPredicates {
  const runtime = (logger as unknown as { runtime: { isError: (v: unknown) => boolean; isBuffer: (v: unknown) => boolean } }).runtime;
  return {
    isError: (value): value is Error => runtime.isError(value),
    isBuffer: (value) => runtime.isBuffer(value),
  };
}

function maskingEngineFor<LogObj>(logger: Logger<LogObj>): MaskingEngine<LogObj> {
  return new MaskingEngine<LogObj>(logger.settings, predicatesFor(logger));
}

function logObjDepsFor<LogObj>(logger: Logger<LogObj>, maxErrorCauseDepth = 5): LogObjDeps {
  const runtime = (
    logger as unknown as { runtime: { isError: (v: unknown) => boolean; isBuffer: (v: unknown) => boolean; getErrorTrace: (e: Error) => unknown } }
  ).runtime;
  return {
    isError: (value): value is Error => runtime.isError(value),
    isBuffer: (value) => runtime.isBuffer(value),
    // biome-ignore lint/suspicious/noExplicitAny: stack frame typing irrelevant for these tests
    getErrorTrace: (error) => runtime.getErrorTrace(error) as any,
    maxErrorCauseDepth,
  };
}

describe("BaseLogger internals", () => {
  test("cloneError creates a new instance", () => {
    const original = new Error("boom");
    const clone = cloneError(original);

    expect(clone).not.toBe(original);
    expect(clone.message).toBe("boom");
  });

  test("toErrorObject respects max depth", () => {
    const logger = new Logger({ type: "json" });
    const deps = logObjDepsFor(logger);

    const tail = new Error("tail");
    const head = new Error("head");
    (head as Error & { cause?: unknown }).cause = tail;

    // Call at depth === maxErrorCauseDepth: the cause chain must not be followed.
    const capped: IErrorObject = toErrorObject(head, deps, deps.maxErrorCauseDepth);
    expect(capped.cause).toBeUndefined();
  });

  test("masking gracefully falls back to null when getters throw", () => {
    const logger = new Logger({ type: "json" });
    const engine = maskingEngineFor(logger);

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

    const cloned = engine.recursiveCloneAndMaskValuesOfKeys(source, []) as Record<string, unknown>;

    expect(cloned.safe).toBe("ok");
    expect(cloned.boom).toBeNull();
  });

  test("cloning duplicates date instances instead of reusing references", () => {
    const original = new Date("2024-01-01T00:00:00Z");
    const cloned = recursiveCloneAndExecuteFunctions(original) as Date;

    expect(cloned).not.toBe(original);
    expect(cloned.getTime()).toBe(original.getTime());
  });

  test("recursive cloning breaks array cycles via shallow copies", () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);

    const cloned = recursiveCloneAndExecuteFunctions(cyclic) as unknown[];

    expect(Array.isArray(cloned)).toBe(true);
    expect(cloned).not.toBe(cyclic);
    const inner = cloned[0] as unknown[];
    expect(Array.isArray(inner)).toBe(true);
    expect(inner[0]).toBe(cyclic);
  });

  test("mask key lookup caches normalized values in case-insensitive mode", () => {
    const logger = new Logger({
      type: "json",
      mask: { keys: ["Password"], caseInsensitive: true },
    });
    const engine = maskingEngineFor(logger);

    const first = engine.getMaskKeys();
    const second = engine.getMaskKeys();

    expect(first).toBe(second);
    expect(first).toEqual(["password"]);
  });

  test("get mask keys normalizes and caches the result in case-sensitive mode", () => {
    const logger = new Logger({ type: "json" });
    const engine = maskingEngineFor(logger);

    logger.settings.mask.keys = ["token"];
    const result = engine.getMaskKeys();

    // String keys keep their value but the result is a normalized copy (numeric keys become strings),
    // never a live reference to settings.maskValuesOfKeys.
    expect(result).toEqual(["token"]);
    // A subsequent call with the same source returns the cached normalized array.
    expect(engine.getMaskKeys()).toBe(result);
  });

  test("numeric mask keys are normalized when lower-casing", () => {
    const logger = new Logger({
      type: "json",
      mask: { caseInsensitive: true },
    });
    logger.settings.mask.keys = [123 as unknown as string];
    const engine = maskingEngineFor(logger);

    expect(engine.getMaskKeys()).toEqual(["123"]);
  });

  test("mask keys fall back to empty array when not configured", () => {
    const logger = new Logger({ type: "json" });
    const engine = maskingEngineFor(logger);
    logger.settings.mask.keys = undefined as unknown as string[];

    expect(engine.getMaskKeys()).toEqual([]);
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
    const engine = maskingEngineFor(logger);

    const originalMap = new Map([["a", 1]]);
    const clonedMap = engine.recursiveCloneAndMaskValuesOfKeys(originalMap, []);
    expect(clonedMap).toBeInstanceOf(Map);
    expect(clonedMap).not.toBe(originalMap);
    expect([...clonedMap.entries()]).toEqual([...originalMap.entries()]);

    const originalSet = new Set([1, 2]);
    const clonedSet = engine.recursiveCloneAndMaskValuesOfKeys(originalSet, []);
    expect(clonedSet).toBeInstanceOf(Set);
    expect(clonedSet).not.toBe(originalSet);
    expect([...clonedSet.values()]).toEqual([...originalSet.values()]);

    // v5: URLs are normalized to a plain serializable object (urlToObject) rather than a URL clone,
    // but the inspected fields are preserved, so toMatchObject still asserts the same intent.
    const originalUrl = new URL("https://example.com/path?x=1");
    const clonedUrl = engine.recursiveCloneAndMaskValuesOfKeys(originalUrl, []);
    expect(clonedUrl).toMatchObject({
      href: "https://example.com/path?x=1",
      protocol: "https:",
      pathname: "/path",
      search: "?x=1",
    });

    const maskedObject = engine.recursiveCloneAndMaskValuesOfKeys({ secret: "value", other: "keep" }, ["secret"]) as Record<string, unknown>;
    expect(maskedObject.secret).toBe(logger.settings.mask.placeholder);
    expect(maskedObject.other).toBe("keep");

    const plainString = engine.recursiveCloneAndMaskValuesOfKeys("public", []);
    expect(plainString).toBe("public");

    const caseInsensitiveLogger = new Logger({
      type: "json",
      mask: { keys: ["Secret"], caseInsensitive: true, placeholder: "[case]" },
    });
    const caseEngine = maskingEngineFor(caseInsensitiveLogger);
    const caseKeys = caseEngine.getMaskKeys();
    const caseMasked = caseEngine.recursiveCloneAndMaskValuesOfKeys({ secret: "value" }, caseKeys) as Record<string, unknown>;
    expect(caseMasked.secret).toBe("[case]");
  });

  test("recursive masking applies regex replacements for strings", () => {
    const logger = new Logger({ type: "json", mask: { placeholder: "[***]", regex: [/secret/gi] } });
    const engine = maskingEngineFor(logger);

    const masked = engine.recursiveCloneAndMaskValuesOfKeys("SECRET-value", []);
    expect(masked).toBe("[***]-value");

    const noRegexLogger = new Logger({ type: "json" });
    const noRegexEngine = maskingEngineFor(noRegexLogger);
    expect(noRegexEngine.recursiveCloneAndMaskValuesOfKeys("unaltered", [])).toBe("unaltered");
  });

  test("case-insensitive masking handles non-string property names", () => {
    const logger = new Logger({
      type: "json",
      mask: { caseInsensitive: true, keys: [123 as unknown as string], placeholder: "[case]" },
    });
    const engine = maskingEngineFor(logger);
    const maskKeys = engine.getMaskKeys();
    const spy = vi.spyOn(Object, "getOwnPropertyNames").mockImplementationOnce(() => [123 as unknown as string] as unknown as string[]);

    const result = engine.recursiveCloneAndMaskValuesOfKeys({ [123]: "value" } as Record<string, unknown>, maskKeys) as Record<string, unknown>;

    spy.mockRestore();
    expect(result[123 as unknown as string]).toBe("[case]");
  });

  test("string masking supports undefined regex configuration", () => {
    const logger = new Logger({ type: "json" });
    const engine = maskingEngineFor(logger);

    logger.settings.mask.regex = null as unknown as RegExp[];

    expect(engine.recursiveCloneAndMaskValuesOfKeys("plain", [])).toBe("plain");
  });

  test("should capture stack when template requests file information", () => {
    const withStack = new Logger({
      type: "pretty",
      pretty: { template: "{{filePath}}" },
    });
    // M3a: hideLogPositionForProduction removed; its "never capture stack" behavior is now stack.capture: "off".
    const withoutStack = new Logger({
      type: "pretty",
      stack: { capture: "off" },
      pretty: { template: "{{dateIsoStr}}" },
    });
    const templateWithoutPlaceholder = new Logger({
      type: "pretty",
      pretty: { template: "{{dateIsoStr}}" },
    });
    const internalsWithStack = withStack as unknown as { _shouldCaptureStack: () => boolean };
    const internalsWithoutStack = withoutStack as unknown as { _shouldCaptureStack: () => boolean };
    const internalsTemplateOnly = templateWithoutPlaceholder as unknown as { _shouldCaptureStack: () => boolean };
    const defaultPretty = new Logger({ type: "pretty" });
    defaultPretty.settings.pretty.template = undefined as unknown as string;
    const internalsDefaultTemplate = defaultPretty as unknown as { _shouldCaptureStack: () => boolean };

    expect(internalsWithStack._shouldCaptureStack()).toBe(true);
    expect(internalsWithoutStack._shouldCaptureStack()).toBe(false);
    expect(internalsTemplateOnly._shouldCaptureStack()).toBe(false);
    expect(internalsDefaultTemplate._shouldCaptureStack()).toBe(false);
  });

  test("case-sensitive masking is exercised through log flow", () => {
    const logger = new Logger({
      type: "json",
      mask: { keys: ["token"], caseInsensitive: false },
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const log = logger.log(1, "test", { token: "foo", other: "bar" });
    expect(log?.token).toBe("[***]");
    expect(log?.other).toBe("bar");

    consoleSpy.mockRestore();
  });

  test("toErrorObject falls back to default error name", () => {
    const logger = new Logger({ type: "json" });
    const deps = logObjDepsFor(logger);

    const unnamed = new Error("boom");
    (unnamed as { name?: string }).name = undefined;
    const result = toErrorObject(unnamed, deps);
    expect(result.name).toBe("Error");
  });

  test("recursion guard recognizes error instances", () => {
    const logger = new Logger({ type: "json" });
    const engine = maskingEngineFor(logger);

    const error = new Error("boom");
    const result = engine.recursiveCloneAndMaskValuesOfKeys(error, []);
    expect(result).toBe(error);
  });

  test("recursive masking clones error prototypes when encountered", () => {
    const logger = new Logger({ type: "json" });
    const runtimeInternals = logger as unknown as { runtime: { isError: (value: unknown) => boolean } };
    // The engine delegates to the live runtime.isError on each call, so spying here is observed.
    const engine = maskingEngineFor(logger);

    const errorLike = { message: "boom" };
    const isErrorSpy = vi.spyOn(runtimeInternals.runtime, "isError");
    isErrorSpy
      .mockImplementationOnce(() => false)
      .mockImplementationOnce(() => true)
      .mockImplementation(() => false);

    const cloned = engine.recursiveCloneAndMaskValuesOfKeys(errorLike, []);
    expect(cloned).not.toBe(errorLike);
    isErrorSpy.mockRestore();
  });
});
