import "ts-jest";
import { collectErrorCauses, toError, toErrorObject } from "../src/internal/errorUtils.js";
import { IStackFrame } from "../src/interfaces.js";

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
