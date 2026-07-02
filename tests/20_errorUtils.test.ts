import { IStackFrame } from "../src/interfaces.js";
import { collectErrorCauses, toError, toErrorObject } from "../src/internal/errorUtils.js";

describe("error utils", () => {
  test("collectErrorCauses respects depth and cycles", () => {
    const deepest = new Error("depth-3");
    const mid = new Error("depth-2");
    const top = new Error("depth-1");
    (mid as Error & { cause?: unknown }).cause = deepest;
    (top as Error & { cause?: unknown }).cause = mid;

    const causesDepth1 = collectErrorCauses(top, { maxDepth: 1 });
    expect(causesDepth1).toHaveLength(1);
    expect(causesDepth1[0]?.message).toBe("depth-2");

    const cyclic = new Error("cycle");
    (cyclic as Error & { cause?: unknown }).cause = cyclic;
    const causes = collectErrorCauses(cyclic);
    expect(causes).toHaveLength(1);
    expect(causes[0]).toBe(cyclic);
  });

  test("toError wraps values and copies properties", () => {
    const wrapped = toError({ message: "custom", extra: 1 } as unknown as Error);
    expect(wrapped).toBeInstanceOf(Error);
    expect((wrapped as unknown as { extra?: number }).extra).toBe(1);

    const fromString = toError("literal");
    expect(fromString.message).toBe("literal");
  });

  test("toErrorObject serializes stack frames", () => {
    const error = new Error("boom");
    const frames: IStackFrame[] = [
      { filePath: "src/app.ts", fileLine: "10" },
      { filePath: "src/other.ts", fileLine: "20" },
    ];

    const result = toErrorObject(error, () => frames.shift());
    expect(result.stack).toEqual([
      { filePath: "src/app.ts", fileLine: "10" },
      { filePath: "src/other.ts", fileLine: "20" },
    ]);
    expect(result.nativeError).toBe(error);
  });
});

describe("toError is total (never throws on hostile causes)", () => {
  test("circular non-Error cause produces an Error with a [Circular] marker", () => {
    const cause: Record<string, unknown> = { info: "root" };
    cause.self = cause;

    const error = toError(cause);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("[Circular]");
    expect((error as Error & { info?: string }).info).toBe("root");
  });

  test("BigInt-bearing cause is stringified instead of throwing", () => {
    const error = toError({ count: 10n });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("10");
  });

  test("a throwing getter on the cause skips that property but keeps the rest", () => {
    const hostile = {
      good: 1,
      get bad(): string {
        throw new Error("boom from getter");
      },
    };

    const error = toError(hostile);
    expect((error as Error & { good?: number }).good).toBe(1);
  });

  test("an own __proto__ key on the cause cannot swap the error's prototype", () => {
    const poisoned = JSON.parse('{"__proto__": {"polluted": true}, "x": 1}');

    const error = toError(poisoned);
    expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
    expect((error as Error & { x?: number }).x).toBe(1);
    expect((error as Error & { polluted?: boolean }).polluted).toBeUndefined();
  });

  test("a function cause falls back to String()", () => {
    const error = toError(() => "nope");
    expect(error).toBeInstanceOf(Error);
    expect(error.message.length).toBeGreaterThan(0);
  });

  test("shared (non-circular) references are serialized in full, not mislabeled as [Circular]", () => {
    const shared = { v: 1 };
    const error = toError({ a: shared, b: shared });
    expect(error.message).toBe('{"a":{"v":1},"b":{"v":1}}');
    expect(error.message).not.toContain("[Circular]");
  });

  test("only a true cycle is labeled [Circular]", () => {
    const cycle: Record<string, unknown> = { name: "c" };
    cycle.self = cycle;
    const error = toError({ wrap: cycle });
    expect(error.message).toContain("[Circular]");
    expect(error.message).toContain('"name":"c"');
  });

  test("a hostile cause getter is skipped by collectErrorCauses instead of throwing", () => {
    const err = new Error("outer");
    Object.defineProperty(err, "cause", {
      get() {
        throw new Error("boom from cause getter");
      },
    });

    expect(() => collectErrorCauses(err)).not.toThrow();
    expect(collectErrorCauses(err)).toEqual([]);
  });
});
