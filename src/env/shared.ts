import { formatTemplate } from "../formatTemplate.js";
import type { IMetaStatic, ISettings, IStackFrame } from "../interfaces.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";

/**
 * Runtime-agnostic environment helpers shared by every {@link EnvironmentProvider}.
 *
 * The v4 monolith built these as closures inside `createLoggerEnvironment()`. v5 deletes that
 * module-level singleton (BC11) and hoists the parts that do NOT vary by runtime here, so the
 * per-runtime providers (`environment.node.ts`, `environment.browser.ts`, `environment.universal.ts`)
 * can reuse them without duplicating logic.
 *
 * What stays here: the stack-line parsers (server + browser), file-path normalization, error/stack
 * formatting, the ANSI stripper, the pretty-log console-method picker, and runtime detection.
 *
 * What does NOT live here (it differs per runtime — inspect source, CSS styling, console target):
 * `transportFormatted`, `transportJSON`, `prettyFormatLogObj`, `prettyFormatErrorObj`, and the
 * CSS meta builder. Those belong in the providers.
 */

/* ------------------------------------------------------------------------------------------------ */
/* Runtime detection                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

/** The runtimes tslog distinguishes for meta/stack-parsing purposes. */
export type RuntimeName = "browser" | "node" | "deno" | "bun" | "worker" | "unknown";

/** Detected runtime details used to build the static meta block. */
export interface RuntimeInfo {
  name: RuntimeName;
  version?: string;
  hostname?: string;
  userAgent?: string;
}

/** Static meta extended with the optional runtime-specific fields. */
export type RuntimeMetaStatic = IMetaStatic & {
  runtimeVersion?: string;
  hostname?: string;
  browser?: string;
};

/** Whether the detected runtime should expose a host name (server-side runtimes only). */
function shouldCaptureHostname(name: RuntimeName): boolean {
  return name === "node" || name === "deno" || name === "bun";
}

/** Whether the detected runtime should expose a runtime version string (server-side runtimes only). */
function shouldCaptureRuntimeVersion(name: RuntimeName): boolean {
  return name === "node" || name === "deno" || name === "bun";
}

/**
 * Probe the global scope and classify the current runtime. Order matters: browser first, then web
 * worker (`importScripts`), then Bun, Deno and finally Node (with a last-resort "node" branch when a
 * bare `process` global is present). Anything else is "unknown" (e.g. Cloudflare Workers).
 */
export function detectRuntimeInfo(): RuntimeInfo {
  if (isBrowserEnvironment()) {
    const navigatorObj = (globalThis as { navigator?: { userAgent?: string } }).navigator;
    return {
      name: "browser",
      userAgent: navigatorObj?.userAgent,
    };
  }

  const globalScope = globalThis as {
    importScripts?: unknown;
    navigator?: { userAgent?: string };
  };

  if (typeof globalScope.importScripts === "function") {
    return {
      name: "worker",
      userAgent: globalScope.navigator?.userAgent,
    };
  }

  const globalAny = globalThis as {
    process?: { versions?: Record<string, string>; version?: string; env?: Record<string, string | undefined> };
    Deno?: { version?: { deno?: string }; env?: { get?: (key: string) => string | undefined }; hostname?: () => string };
    Bun?: { version?: string; env?: Record<string, string | undefined> };
    location?: { hostname?: string };
  };

  if (globalAny.Bun != null) {
    const bunVersion = globalAny.Bun.version;
    return {
      name: "bun",
      version: bunVersion != null ? `bun/${bunVersion}` : undefined,
      hostname: getEnvironmentHostname(globalAny.process, globalAny.Deno, globalAny.Bun, globalAny.location),
    };
  }

  if (globalAny.Deno != null) {
    const denoHostname = resolveDenoHostname(globalAny.Deno);
    const denoVersion = globalAny.Deno?.version?.deno;
    return {
      name: "deno",
      version: denoVersion != null ? `deno/${denoVersion}` : undefined,
      hostname: denoHostname ?? getEnvironmentHostname(globalAny.process, globalAny.Deno, globalAny.Bun, globalAny.location),
    };
  }

  if (globalAny.process?.versions?.node != null || globalAny.process?.version != null) {
    return {
      name: "node",
      version: globalAny.process?.versions?.node ?? globalAny.process?.version,
      hostname: getEnvironmentHostname(globalAny.process, globalAny.Deno, globalAny.Bun, globalAny.location),
    };
  }

  if (globalAny.process != null) {
    return {
      name: "node",
      version: "unknown",
      hostname: getEnvironmentHostname(globalAny.process, globalAny.Deno, globalAny.Bun, globalAny.location),
    };
  }

  return {
    name: "unknown",
  };
}

/** Build the static (per-logger-instance) meta block for the detected runtime. */
export function createRuntimeMeta(info: RuntimeInfo): RuntimeMetaStatic {
  if (info.name === "browser" || info.name === "worker") {
    return {
      runtime: info.name,
      browser: info.userAgent,
    };
  }

  const metaStatic: RuntimeMetaStatic = {
    runtime: info.name,
  };

  if (shouldCaptureRuntimeVersion(info.name)) {
    metaStatic.runtimeVersion = info.version ?? "unknown";
  }

  if (shouldCaptureHostname(info.name)) {
    metaStatic.hostname = info.hostname ?? "unknown";
  }

  return metaStatic;
}

/**
 * Resolve a host name from the runtime's environment variables (HOSTNAME/HOST/COMPUTERNAME) across
 * Node, Bun and Deno, falling back to `location.hostname`. Returns `undefined` when nothing is set.
 */
export function getEnvironmentHostname(
  nodeProcess?: { env?: Record<string, string | undefined> },
  deno?: { env?: { get?: (key: string) => string | undefined } },
  bun?: { env?: Record<string, string | undefined> },
  location?: { hostname?: string },
): string | undefined {
  // Guarded per-property reads: on Deno, `process.env` is a permission-checked proxy whose property
  // GETs throw NotCapable without --allow-env — an unguarded read here crashed `import "tslog"` itself.
  try {
    const processHostname = nodeProcess?.env?.HOSTNAME ?? nodeProcess?.env?.HOST ?? nodeProcess?.env?.COMPUTERNAME;
    if (processHostname != null && processHostname.length > 0) {
      return processHostname;
    }
  } catch {
    // ignore permission or access issues
  }

  try {
    const bunHostname = bun?.env?.HOSTNAME ?? bun?.env?.HOST ?? bun?.env?.COMPUTERNAME;
    if (bunHostname != null && bunHostname.length > 0) {
      return bunHostname;
    }
  } catch {
    // ignore permission or access issues
  }

  try {
    const denoEnvGet = deno?.env?.get;
    if (typeof denoEnvGet === "function") {
      const value = denoEnvGet("HOSTNAME");
      if (value != null && value.length > 0) {
        return value;
      }
    }
  } catch {
    // ignore permission or access issues
  }

  if (location?.hostname != null && location.hostname.length > 0) {
    return location.hostname;
  }

  return undefined;
}

/** Resolve a Deno host name via `Deno.hostname()`, swallowing permission errors, then `location.hostname`. */
export function resolveDenoHostname(deno?: { hostname?: () => string }): string | undefined {
  try {
    if (typeof deno?.hostname === "function") {
      const value = deno.hostname();
      if (value != null && value.length > 0) {
        return value;
      }
    }
  } catch {
    // ignore inability to resolve hostname via Deno APIs
  }
  const locationHostname = (globalThis as { location?: { hostname?: string } }).location?.hostname;
  if (locationHostname != null && locationHostname.length > 0) {
    return locationHostname;
  }
  return undefined;
}

/** True for DOM environments (both `window` and `document` present). */
export function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** True for web-worker scopes (the `importScripts` global is a function). */
export function isWorkerEnvironment(): boolean {
  return typeof (globalThis as { importScripts?: unknown }).importScripts === "function";
}

/**
 * Best-effort `Error` detection that also recognizes cross-realm errors and error-like plain objects.
 * Matches native `instanceof Error`, the `[object ...Error]` toString tag, and `name` ending in "Error".
 */
export function isNativeError(value: unknown): value is Error {
  if (value instanceof Error) {
    return true;
  }

  if (value != null && typeof value === "object") {
    const objectTag = Object.prototype.toString.call(value);
    if (/\[object .*Error\]/.test(objectTag)) {
      return true;
    }

    const name = (value as { name?: unknown }).name;
    if (typeof name === "string" && name.endsWith("Error")) {
      return true;
    }
  }

  return false;
}

/* ------------------------------------------------------------------------------------------------ */
/* Stack-line parsing (server + browser)                                                             */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Matches a browser/Hermes/Safari stack frame, capturing the file path (group 1), line (group 2) and
 * column (group 3). The path capture starts at the first slash after an optional scheme, so the host
 * is retained as the leading path segment (see test 35).
 */
export const BROWSER_PATH_REGEX = /(?:(?:file|https?|global code|[^@]+)@)?(?:file:)?((?:\/[^:/]+){2,})(?::(\d+))?(?::(\d+))?/;

/**
 * Parse a V8/server-style stack line (`at method (path:line:col)` or `at path:line:col`).
 *
 * `getCwd` is supplied by the provider so callers control cwd caching (the v4 monolith memoized cwd
 * inside the singleton; v5 lifts that responsibility to the provider to keep this function pure).
 * Returns `undefined` for lines that are not stack frames.
 */
export function parseServerStackLine(rawLine: string | undefined, getCwd: () => string | undefined): IStackFrame | undefined {
  if (typeof rawLine !== "string" || rawLine.length === 0) {
    return undefined;
  }

  const trimmedLine = rawLine.trim();
  if (!trimmedLine.includes(" at ") && !trimmedLine.startsWith("at ")) {
    return undefined;
  }

  const line = trimmedLine.replace(/^at\s+/, "");
  let method: string | undefined;
  let location = line;

  const methodMatch = line.match(/^(.*?)\s+\((.*)\)$/);
  if (methodMatch) {
    method = methodMatch[1];
    location = methodMatch[2];
  }

  const sanitizedLocation = location.replace(/^\(/, "").replace(/\)$/, "");
  const withoutQuery = sanitizedLocation.replace(/\?.*$/, "");

  let fileLine: string | undefined;
  let fileColumn: string | undefined;
  let filePathCandidate = withoutQuery;

  const segments = withoutQuery.split(":");
  if (segments.length >= 3 && /^\d+$/.test(segments[segments.length - 1])) {
    fileColumn = segments.pop();
    fileLine = segments.pop();
    filePathCandidate = segments.join(":");
  } else if (segments.length >= 2 && /^\d+$/.test(segments[segments.length - 1])) {
    fileLine = segments.pop();
    filePathCandidate = segments.join(":");
  }

  let normalizedPath = filePathCandidate.replace(/^file:\/\//, "");
  const cwd = getCwd();
  if (cwd != null && normalizedPath.startsWith(cwd)) {
    normalizedPath = normalizedPath.slice(cwd.length);
    normalizedPath = normalizedPath.replace(/^[\\/]/, "");
  }

  if (normalizedPath.length === 0) {
    normalizedPath = filePathCandidate;
  }

  const normalizedPathWithoutLine = normalizeFilePath(normalizedPath);
  const effectivePath = normalizedPathWithoutLine.length > 0 ? normalizedPathWithoutLine : normalizedPath;
  const pathSegments = effectivePath.split(/\\|\//);
  const fileName = pathSegments[pathSegments.length - 1];
  const fileNameWithLine = fileName && fileLine ? `${fileName}:${fileLine}` : undefined;
  const filePathWithLine = effectivePath && fileLine ? `${effectivePath}:${fileLine}` : undefined;

  return {
    fullFilePath: sanitizedLocation,
    fileName,
    fileNameWithLine,
    fileColumn,
    fileLine,
    filePath: effectivePath,
    filePathWithLine,
    method,
  };
}

/**
 * Parse a browser/Hermes/Safari stack line via {@link BROWSER_PATH_REGEX}. `method` is always
 * undefined for browser frames. Returns `undefined` for lines without a parseable file path.
 */
export function parseBrowserStackLine(line: string | undefined): IStackFrame | undefined {
  const href = (globalThis as { location?: { origin?: string } }).location?.origin;
  /* v8 ignore next 3 -- defensive: buildStackTrace only ever feeds non-null lines into the parser */
  if (line == null) {
    return undefined;
  }

  const match = line.match(BROWSER_PATH_REGEX);
  if (!match) {
    return undefined;
  }

  const filePath = match[1]?.replace(/\?.*$/, "");
  /* v8 ignore next 3 -- defensive: the regex requires capture group 1 to match, so filePath is never null here */
  if (filePath == null) {
    return undefined;
  }

  const pathParts = filePath.split("/");
  const fileLine = match[2];
  const fileColumn = match[3];
  const fileName = pathParts[pathParts.length - 1];

  return {
    fullFilePath: href ? `${href}${filePath}` : filePath,
    fileName,
    fileNameWithLine: fileName && fileLine ? `${fileName}:${fileLine}` : undefined,
    fileColumn,
    fileLine,
    filePath,
    filePathWithLine: fileLine ? `${filePath}:${fileLine}` : undefined,
    method: undefined,
  };
}

/**
 * Normalize a file path: collapse repeated/backslash separators to single forward slashes, resolve
 * `.` / `..` segments, and preserve a Windows drive prefix, a UNC leading `//`, or a leading `/`.
 * Falls back to the original value when normalization collapses to an empty string.
 */
export function normalizeFilePath(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  const replaced = value.replace(/\\+/g, "\\").replace(/\\/g, "/");
  const hasRootDoubleSlash = replaced.startsWith("//");
  const hasLeadingSlash = replaced.startsWith("/") && !hasRootDoubleSlash;
  const driveMatch = replaced.match(/^[A-Za-z]:/);
  const drivePrefix = driveMatch ? driveMatch[0] : "";
  const withoutDrive = drivePrefix ? replaced.slice(drivePrefix.length) : replaced;

  const segments = withoutDrive.split("/");
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalizedSegments.length > 0) {
        normalizedSegments.pop();
      }
      continue;
    }
    normalizedSegments.push(segment);
  }

  let normalized = normalizedSegments.join("/");
  if (hasRootDoubleSlash) {
    normalized = `//${normalized}`;
  } else if (hasLeadingSlash) {
    normalized = `/${normalized}`;
  } else if (drivePrefix !== "") {
    normalized = `${drivePrefix}${normalized.length > 0 ? `/${normalized}` : ""}`;
  }

  if (normalized.length === 0) {
    return value;
  }

  return normalized;
}

/* ------------------------------------------------------------------------------------------------ */
/* Error / stack formatting                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/** Render each stack frame through the configured `pretty.errorStackTemplate`. */
export function formatStackFrames<LogObj>(frames: IStackFrame[], settings: ISettings<LogObj>): string[] {
  return frames.map((stackFrame) => formatTemplate(settings, settings.pretty.errorStackTemplate, { ...stackFrame }, true));
}

/**
 * Build the human-readable message line for an error by joining its own enumerable, non-function
 * properties (excluding `stack` and `cause`).
 */
export function formatErrorMessage(error: Error): string {
  return Object.getOwnPropertyNames(error)
    .filter((key) => key !== "stack" && key !== "cause")
    .reduce<string[]>((result, key) => {
      // Guarded read + stringify: own properties may have been copied from a user-supplied cause
      // object and can carry hostile getters/toString — skip them rather than crash the pipeline.
      try {
        const value = (error as unknown as Record<string, unknown>)[key];
        if (typeof value === "function") {
          return result;
        }
        result.push(stringifyFallback(value));
      } catch {
        // skip this property, keep the rest
      }
      return result;
    }, [])
    .join(", ");
}

/** Last-resort value stringifier: pass strings through, JSON-stringify, else `String(value)`. */
export function stringifyFallback(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
    /* v8 ignore next 3 -- defensive: only reached for values JSON.stringify rejects (e.g. BigInt) while the primary inspect path has already failed */
  } catch {
    return String(value);
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* ANSI + console-method helpers                                                                      */
/* ------------------------------------------------------------------------------------------------ */

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
export const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

/** Remove ANSI SGR escape sequences from a string. */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_REGEX, "");
}

/**
 * Pick the console method used to print a pretty log: the per-level override, then the `"*"` override,
 * then the default `console.log`.
 */
export function getPrettyLogMethod(
  logLevelName: string | undefined,
  levelMethod: Record<string, (...args: unknown[]) => void> | undefined,
): (...args: unknown[]) => void {
  if (logLevelName && levelMethod?.[logLevelName]) {
    return levelMethod[logLevelName];
  }
  if (levelMethod?.["*"]) {
    return levelMethod["*"];
  }
  return nativeConsoleMethod("log");
}
