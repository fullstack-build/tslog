import { createNodeEnvironment } from "../src/env/environment.node.js";
import {
  buildStackTrace,
  clampIndex,
  findFirstExternalFrameIndex,
  getDefaultIgnorePatterns,
  sanitizeStackLines,
  splitStackLines,
} from "../src/env/stackTrace.js";
import { IStackFrame } from "../src/interfaces.js";

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

  // Re-expressed from the dropped `isIgnorableFrame` helper. The surviving API
  // `findFirstExternalFrameIndex` encodes the same predicate: a frame that matches
  // the default ignore patterns is skipped. A lone ignorable frame yields the
  // "all matched" fallback index 0, while placing an external frame after it lands
  // on index 1 — proving the first frame is treated as ignorable.
  test("default ignore patterns match internal tslog frames (both relative and absolute paths)", () => {
    const patterns = getDefaultIgnorePatterns();
    const ignorableFrame: IStackFrame = {
      filePath: "node_modules/tslog/src/internal/environment.ts",
      fullFilePath: "/tmp/project/node_modules/tslog/src/internal/environment.ts:10:2",
    };
    const externalFrame: IStackFrame = { filePath: "src/app.ts", fullFilePath: "/tmp/project/src/app.ts:1:1" };

    expect(findFirstExternalFrameIndex([ignorableFrame], patterns)).toBe(0);
    expect(findFirstExternalFrameIndex([ignorableFrame, externalFrame], patterns)).toBe(1);

    // Matching must consider absolute paths too: a frame whose relative filePath is clean
    // but whose fullFilePath matches the pattern is still ignored.
    const absoluteOnlyIgnorable: IStackFrame = { filePath: "app.ts", fullFilePath: "/tmp/node_modules/tslog/src/index.ts:1:1" };
    expect(findFirstExternalFrameIndex([absoluteOnlyIgnorable, externalFrame], patterns)).toBe(1);
  });

  // Re-expressed from the dropped `pickCallerStackFrame(..., { stackDepthLevel })` helper.
  // Manual depth selects that index into the parsed (sanitized) frames.
  test("manual depth selects the frame at that index", () => {
    const error = {
      stack: ["Error", "frameA", "frameB"].join("\n"),
    } as unknown as Error;

    const frames = buildStackTrace(error, (line) => ({ filePath: line }));
    expect(frames).toEqual([{ filePath: "frameA" }, { filePath: "frameB" }]);

    const frame = frames[clampIndex(1, frames.length)];
    expect(frame?.filePath).toBe("frameB");
  });

  // Re-expressed from the dropped `pickCallerStackFrame` "no frames" case: when the parser
  // yields nothing, no frames are produced (the public getCallerStackFrame returns {} below).
  test("yields no frames when the parser produces none", () => {
    const error = {
      stack: "Error\n    at ignored",
    } as unknown as Error;

    const frames = buildStackTrace(error, () => undefined);
    expect(frames).toEqual([]);
  });

  test("getCallerStackFrame returns empty object without frames", () => {
    const runtime = createNodeEnvironment();
    const frame = runtime.getCallerStackFrame(Number.NaN, { stack: "Error" } as Error);
    expect(frame).toEqual({});
  });
});
