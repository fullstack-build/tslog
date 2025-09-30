import "ts-jest";
import {
  findFirstExternalFrameIndex,
  sanitizeStackLines,
  splitStackLines,
  getDefaultIgnorePatterns,
  clampIndex,
  pickCallerStackFrame,
  getFrameAt,
  isIgnorableFrame,
} from "../src/internal/stackTrace.js";
import { IStackFrame } from "../src/interfaces.js";
import { createLoggerEnvironment } from "../src/BaseLogger.js";

describe("stack trace helpers", () => {
  test("split and sanitize stack lines", () => {
    const error = new Error("boom");
    (error as Error & { stack: string }).stack = "Error: boom\n    at first line\n    at second line";

    const lines = splitStackLines(error);
    expect(lines.length).toBe(3);

    const sanitized = sanitizeStackLines(lines);
    expect(sanitized).toEqual(["    at first line", "    at second line"]);
  });

  test("ignores internal tslog frames", () => {
    const frames: IStackFrame[] = [
      {
        filePath: "node_modules/tslog/src/BaseLogger.ts",
        fullFilePath: "/Users/foo/project/node_modules/tslog/src/BaseLogger.ts:10:5",
      },
      {
        filePath: "src/routes/index.ts",
        fullFilePath: "/Users/foo/project/src/routes/index.ts:99:3",
        filePathWithLine: "src/routes/index.ts:99",
      },
    ];

    const index = findFirstExternalFrameIndex(frames, getDefaultIgnorePatterns());
    expect(index).toBe(1);
  });

  test("returns zero when every frame matches the ignore patterns", () => {
    const frames: IStackFrame[] = [
      {
        filePath: "node_modules/tslog/src/internal/environment.ts",
        fullFilePath: "/tmp/node_modules/tslog/src/internal/environment.ts:1",
      },
    ];

    const index = findFirstExternalFrameIndex(frames, getDefaultIgnorePatterns());
    expect(index).toBe(0);
  });

  test("clampIndex bounds index", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });

  test("getFrameAt returns undefined for out of range indices", () => {
    const frames: IStackFrame[] = [{ filePath: "src/app.ts" }];
    expect(getFrameAt(frames, -1)).toBeUndefined();
    expect(getFrameAt(frames, 5)).toBeUndefined();
  });

  test("isIgnorableFrame checks both relative and absolute paths", () => {
    const patterns = getDefaultIgnorePatterns();
    const frame: IStackFrame = {
      filePath: "node_modules/tslog/src/internal/environment.ts",
      fullFilePath: "/tmp/project/node_modules/tslog/src/internal/environment.ts:10:2",
    };

    expect(isIgnorableFrame(frame, patterns)).toBe(true);
  });

  test("pickCallerStackFrame honors manual depth", () => {
    const error = {
      stack: ["Error", "frameA", "frameB"].join("\n"),
    } as unknown as Error;
    const frame = pickCallerStackFrame(error, (line) => ({ filePath: line }), { stackDepthLevel: 1 });

    expect(frame?.filePath).toBe("frameB");
  });

  test("pickCallerStackFrame returns undefined when parser yields no frames", () => {
    const error = {
      stack: "Error\n    at ignored",
    } as unknown as Error;

    const frame = pickCallerStackFrame(error, () => undefined, { stackDepthLevel: undefined });

    expect(frame).toBeUndefined();
  });

  test("getCallerStackFrame returns empty object without frames", () => {
    const runtime = createLoggerEnvironment();
    const frame = runtime.getCallerStackFrame(Number.NaN, { stack: "Error" } as Error);
    expect(frame).toEqual({});
  });
});
