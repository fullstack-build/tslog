import type { IStackFrame } from "../interfaces.js";

/**
 * Frames that originate from tslog's own code (or its bundled copies under node_modules/deps)
 * are skipped during caller detection so the reported log position lands on user code.
 *
 * M1.12: do NOT match tslog's own frames by a directory *name* like `tslog/src/` — that misclassifies
 * a user's own code as internal whenever their project happens to live under a directory named `tslog`
 * (e.g. `/home/me/tslog/src/app.ts`). Instead we anchor on tslog's *actual* installed location, derived
 * from this module's own URL at runtime ({@link OWN_DIR_MARKER}), plus the published bundle layout and the
 * node_modules/deps copies. A user project under a `tslog` directory does not share tslog's real module
 * directory, so its frames are correctly treated as external.
 */

/** tslog's own directory, derived from this module's URL — used to recognize internal frames by location, not by name. */
const OWN_DIR_MARKER: string | undefined = (() => {
  try {
    // import.meta.url points at this file inside the installed/built tslog. Strip the trailing
    // `env/stackTrace.<ext>` (or the equivalent in a bundle) to get tslog's own root directory.
    const url = import.meta.url;
    /* v8 ignore next 3 -- unreachable under the Node ESM runner where coverage runs; live in the browser IIFE, where esbuild lowers import.meta to {} */
    if (typeof url !== "string" || url.length === 0) {
      return undefined;
    }
    const path = url.replace(/^file:\/\//, "").replace(/[\\/]env[\\/]stackTrace\.[a-z]+(?:\?.*)?$/i, "");
    /* v8 ignore next -- unreachable under the Node ESM runner (our URL ends with env/stackTrace.<ext>); live in user bundles whose URL keeps path === url */
    return path === url ? undefined : path;
    /* v8 ignore next 3 -- defensive: reading import.meta.url and the string replaces cannot throw in a real runtime */
  } catch {
    return undefined;
  }
})();

/** A frame whose path begins with tslog's actual own directory is internal (location-based, name-independent). */
/* v8 ignore next 2 -- unreachable under the Node ESM runner where OWN_DIR_MARKER always resolves; live in the browser IIFE and user bundles where it is undefined */
const OWN_DIR_PATTERN: RegExp | undefined =
  OWN_DIR_MARKER != null ? new RegExp(`^(?:file://)?${OWN_DIR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\\\/]`, "i") : undefined;

const DEFAULT_IGNORE_PATTERNS: RegExp[] = [
  /(?:^|[\\/])node_modules[\\/].*tslog/i,
  /(?:^|[\\/])deps[\\/].*tslog/i,
  // The published bundle layout, so a frame in dist/esm or dist/cjs of *the tslog package* is internal.
  // Anchored to `tslog/dist/...` rather than any bare `tslog/` substring.
  /(?:^|[\\/])tslog[\\/]dist[\\/](?:esm|cjs)[\\/]/i,
  /* v8 ignore next -- unreachable under the Node ESM runner where OWN_DIR_PATTERN is non-null; live in the browser IIFE and user bundles where it is undefined */
  ...(OWN_DIR_PATTERN != null ? [OWN_DIR_PATTERN] : []),
];

/**
 * Split an error stack into individual lines while guaranteeing an array result. The `stack` read is
 * guarded: a hostile getter (e.g. own properties copied from a user-supplied `cause` object) must
 * never crash the logging pipeline — it yields an empty stack instead.
 */
export function splitStackLines(error: Error | unknown): string[] {
  let stack: string | undefined;
  try {
    const value = (error as Error)?.stack;
    stack = typeof value === "string" ? value : undefined;
  } catch {
    return [];
  }
  if (stack == null || stack.length === 0) {
    return [];
  }
  return stack.split("\n").map((line) => line.trimEnd());
}

/**
 * Remove empty and error header lines which vary between runtimes.
 */
export function sanitizeStackLines(lines: string[]): string[] {
  return lines.filter((line) => line.length > 0 && !/^\s*Error\b/.test(line));
}

/**
 * Convert stack trace lines into stack frames using the provided parser.
 */
export function toStackFrames(lines: string[], parseLine: (line: string) => IStackFrame | undefined): IStackFrame[] {
  const frames: IStackFrame[] = [];
  for (const line of lines) {
    const frame = parseLine(line);
    if (frame != null) {
      frames.push(frame);
    }
  }
  return frames;
}

/**
 * Determine the first stack frame that does not match known internal patterns.
 */
export function findFirstExternalFrameIndex(frames: IStackFrame[], ignorePatterns: RegExp[] = DEFAULT_IGNORE_PATTERNS): number {
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const filePathCandidate = frame.filePath ?? "";
    const fullPathCandidate = frame.fullFilePath ?? "";
    if (!ignorePatterns.some((pattern) => pattern.test(filePathCandidate) || pattern.test(fullPathCandidate))) {
      return index;
    }
  }
  return 0;
}

/**
 * Utility that splits and sanitizes stack lines in a single call.
 */
export function getCleanStackLines(error: Error | unknown): string[] {
  return sanitizeStackLines(splitStackLines(error));
}

/**
 * Build a normalized stack trace for the provided error using the parser.
 */
export function buildStackTrace(error: Error | unknown, parseLine: (line: string) => IStackFrame | undefined): IStackFrame[] {
  return toStackFrames(getCleanStackLines(error), parseLine);
}

/**
 * Clamp an index into the valid range `[0, maxExclusive)`.
 */
export function clampIndex(index: number, maxExclusive: number): number {
  if (index < 0) {
    return 0;
  }
  if (index >= maxExclusive) {
    return Math.max(0, maxExclusive - 1);
  }
  return index;
}

/**
 * Return a fresh copy of the default ignore patterns so callers can extend them without mutating the shared list.
 */
export function getDefaultIgnorePatterns(): RegExp[] {
  return [...DEFAULT_IGNORE_PATTERNS];
}
