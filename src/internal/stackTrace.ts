import { IStackFrame } from "../interfaces.js";

const DEFAULT_IGNORE_PATTERNS = [
  /(?:^|[\\/])node_modules[\\/].*tslog/i,
  /(?:^|[\\/])deps[\\/].*tslog/i,
  /tslog[\\/]+src[\\/]+internal[\\/]/i,
  /tslog[\\/]+src[\\/]BaseLogger/i,
  /tslog[\\/]+src[\\/]index/i,
];

/**
 * Split an error stack into individual lines while guaranteeing an array result.
 */
export function splitStackLines(error: Error | unknown): string[] {
  const stack = typeof (error as Error)?.stack === "string" ? (error as Error).stack : undefined;
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
 * Safely access a frame within the provided array.
 */
export function getFrameAt(frames: IStackFrame[], index: number): IStackFrame | undefined {
  if (index < 0 || index >= frames.length) {
    return undefined;
  }
  return frames[index];
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

export function isIgnorableFrame(frame: IStackFrame, ignorePatterns: RegExp[]): boolean {
  const filePathCandidate = frame.filePath ?? "";
  const fullPathCandidate = frame.fullFilePath ?? "";
  return ignorePatterns.some((pattern) => pattern.test(filePathCandidate) || pattern.test(fullPathCandidate));
}

export function clampIndex(index: number, maxExclusive: number): number {
  if (index < 0) {
    return 0;
  }
  if (index >= maxExclusive) {
    return Math.max(0, maxExclusive - 1);
  }
  return index;
}

export function pickCallerStackFrame(
  error: Error | unknown,
  parseLine: (line: string) => IStackFrame | undefined,
  options: {
    stackDepthLevel?: number;
    ignorePatterns?: RegExp[];
  } = {},
): IStackFrame | undefined {
  const lines = getCleanStackLines(error);
  const frames = toStackFrames(lines, parseLine);
  if (frames.length === 0) {
    return undefined;
  }

  const ignorePatterns = options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS;
  const autoIndex = findFirstExternalFrameIndex(frames, ignorePatterns);
  const resolvedIndex = options.stackDepthLevel != null ? options.stackDepthLevel : autoIndex;
  return getFrameAt(frames, clampIndex(resolvedIndex, frames.length));
}

export function getDefaultIgnorePatterns(): RegExp[] {
  return [...DEFAULT_IGNORE_PATTERNS];
}
