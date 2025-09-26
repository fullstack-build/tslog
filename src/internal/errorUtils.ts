import { IErrorObject, IStackFrame } from "../interfaces.js";
import { buildStackTrace } from "./stackTrace.js";

type StackParser = (line: string) => IStackFrame | undefined;

export interface CollectCauseOptions {
  maxDepth?: number;
}

const DEFAULT_CAUSE_DEPTH = 5;

export function collectErrorCauses(error: unknown, options: CollectCauseOptions = {}): Error[] {
  const maxDepth = options.maxDepth ?? DEFAULT_CAUSE_DEPTH;
  const causes: Error[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current != null && depth < maxDepth) {
    const cause = (current as { cause?: unknown })?.cause;
    if (cause == null || visited.has(cause)) {
      break;
    }
    visited.add(cause);
    causes.push(toError(cause));
    current = cause;
    depth += 1;
  }

  return causes;
}

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  const error = new Error(typeof value === "string" ? value : JSON.stringify(value));
  if (typeof value === "object" && value != null) {
    Object.assign(error, value);
  }
  return error;
}

export function toErrorObject(error: Error, parseLine: StackParser): IErrorObject {
  return {
    nativeError: error,
    name: error.name ?? "Error",
    message: error.message ?? "",
    stack: buildStackTrace(error, parseLine),
  };
}
