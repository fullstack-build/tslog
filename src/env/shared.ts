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
export type RuntimeName = "browser" | "node" | "deno" | "bun" | "worker" | "react-native" | "unknown";

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
 * Probe the global scope and classify the current runtime. Order matters: browser first, then React
 * Native (`navigator.product === "ReactNative"` — RN has no `document`, so the browser check never
 * claims it; real browsers report the frozen legacy product "Gecko", so RN never claims them), then web
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
    navigator?: { userAgent?: string; product?: string };
  };

  if (globalScope.navigator?.product === "ReactNative") {
    return {
      name: "react-native",
      version: resolveHermesVersion(),
    };
  }

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
    const denoVersion = globalAny.Deno?.version?.deno;
    return {
      name: "deno",
      version: denoVersion != null ? `deno/${denoVersion}` : undefined,
      // Env-first like every other server runtime (HOSTNAME is the explicit override), then
      // Deno.hostname()/os.hostname inside getEnvironmentHostname, then location.
      hostname: getEnvironmentHostname(globalAny.process, globalAny.Deno, globalAny.Bun, globalAny.location),
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

/**
 * Resolve the Hermes engine version on React Native (`hermes/<version>`), or `undefined` off Hermes
 * (JSC-based RN apps have no comparable engine-version API). Never throws.
 */
export function resolveHermesVersion(): string | undefined {
  try {
    const hermes = (globalThis as { HermesInternal?: { getRuntimeProperties?: () => Record<string, unknown> } }).HermesInternal;
    const version = hermes?.getRuntimeProperties?.()?.["OSS Release Version"];
    return typeof version === "string" && version.length > 0 ? `hermes/${version}` : undefined;
  } catch {
    return undefined;
  }
}

/** Build the static (per-logger-instance) meta block for the detected runtime. */
export function createRuntimeMeta(info: RuntimeInfo): RuntimeMetaStatic {
  if (info.name === "browser" || info.name === "worker") {
    return {
      runtime: info.name,
      browser: info.userAgent,
    };
  }

  if (info.name === "react-native") {
    // No hostname (mobile devices have none worth logging) and no `"unknown"` placeholder version:
    // only Hermes exposes an engine version, so the key is omitted entirely on JSC.
    const reactNativeMeta: RuntimeMetaStatic = { runtime: info.name };
    if (info.version !== undefined) {
      reactNativeMeta.runtimeVersion = info.version;
    }
    return reactNativeMeta;
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
 * Resolve a host name for server runtimes. The environment variables (HOSTNAME/HOST/COMPUTERNAME)
 * are consulted first — they are the explicit override and what containers set — then the OS hostname
 * (`Deno.hostname()` on Deno, else `process.getBuiltinModule("node:os")` — Node 20.16+, Bun, Deno 2;
 * the synchronous, import-free builtin accessor, so this module never imports `node:os`), then
 * `location.hostname`. Returns
 * `undefined` when nothing resolves. Every probe is guarded: Deno throws `NotCapable` on env reads
 * without `--allow-env` and on `os.hostname()` without `--allow-sys`.
 */
export function getEnvironmentHostname(
  nodeProcess?: { env?: Record<string, string | undefined>; getBuiltinModule?: (id: string) => unknown },
  deno?: { env?: { get?: (key: string) => string | undefined }; hostname?: () => string },
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

  try {
    // Deno's native API first on Deno (same permission class as os.hostname: --allow-sys).
    if (typeof deno?.hostname === "function") {
      const value = deno.hostname();
      if (value != null && value.length > 0) {
        return value;
      }
    }
  } catch {
    // ignore — NotCapable without --allow-sys
  }

  try {
    if (typeof nodeProcess?.getBuiltinModule === "function") {
      const os = nodeProcess.getBuiltinModule("node:os") as { hostname?: () => string } | undefined;
      if (typeof os?.hostname === "function") {
        const value = os.hostname();
        if (value != null && value.length > 0) {
          return value;
        }
      }
    }
  } catch {
    // ignore — Deno without --allow-sys throws NotCapable here
  }

  if (location?.hostname != null && location.hostname.length > 0) {
    return location.hostname;
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
 *
 * Each path segment is `[^:/]+`, but a single Windows drive-letter colon is allowed inside the run via
 * `(?::(?=\/))?` — a `:` is absorbed into the path only when it is immediately followed by `/`, i.e. the
 * `C:/` drive separator in a Vite `/@fs/C:/…` URL (issue #323). The trailing `:line[:col]` colons are
 * always followed by digits, never a slash, so they never match this branch and still bind to groups 2/3.
 */
export const BROWSER_PATH_REGEX = /(?:(?:file|https?|global code|[^@]+)@)?(?:file:)?((?:\/[^:/]+(?::(?=\/))?){2,})(?::(\d+))?(?::(\d+))?/;

/**
 * Resolve a transpiled/bundled `(absoluteFilePath, line, column)` back to its original source
 * position via that file's source map. Injected by the Node/universal providers (issue #307);
 * `undefined` on browser/React Native, where it is never called. Must never throw.
 */
export type SourceMapResolver = (filePath: string, line: number, column: number) => { source: string; line: number; column: number } | undefined;

/**
 * Parse a V8/server-style stack line (`at method (path:line:col)` or `at path:line:col`).
 *
 * `getCwd` is supplied by the provider so callers control cwd caching (the v4 monolith memoized cwd
 * inside the singleton; v5 lifts that responsibility to the provider to keep this function pure).
 * `resolveSourceMap`, when supplied, remaps the parsed position through a source map before the cwd
 * relativization below — so a bundled `dist/app.js:42:9` frame reports `src/app.ts:12:3` when a map
 * resolves it, falling back silently to the transpiled position otherwise.
 * Returns `undefined` for lines that are not stack frames.
 */
export function parseServerStackLine(
  rawLine: string | undefined,
  getCwd: () => string | undefined,
  resolveSourceMap?: SourceMapResolver,
): IStackFrame | undefined {
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
  // Hermes (React Native's default engine) emits V8-style frames whose location is prefixed with
  // "address at" for bytecode bundles ("at fn (address at index.android.bundle:1:1234)"); strip it so
  // the bundle name parses as the path. Never appears in Node/Deno/Bun frames.
  const withoutAddressPrefix = sanitizedLocation.replace(/^address at /, "");

  let fileLine: string | undefined;
  let fileColumn: string | undefined;

  // Pop the trailing :line[:column] BEFORE stripping a query string — Metro dev-server frames append
  // them AFTER the query ("/index.bundle?platform=ios&dev=true:117:42"), so stripping the query first
  // would discard the position.
  let filePathCandidate = withoutAddressPrefix;
  const segments = withoutAddressPrefix.split(":");
  if (segments.length >= 3 && /^\d+$/.test(segments[segments.length - 1])) {
    fileColumn = segments.pop();
    fileLine = segments.pop();
    filePathCandidate = segments.join(":");
  } else if (segments.length >= 2 && /^\d+$/.test(segments[segments.length - 1])) {
    fileLine = segments.pop();
    filePathCandidate = segments.join(":");
  }
  filePathCandidate = filePathCandidate.replace(/\?.*$/, "");

  let normalizedPath = filePathCandidate.replace(/^file:\/\//, "");

  if (resolveSourceMap != null && fileLine != null) {
    const original = resolveSourceMap(normalizedPath, Number(fileLine), fileColumn != null ? Number(fileColumn) : 1);
    if (original != null) {
      normalizedPath = original.source;
      fileLine = String(original.line);
      fileColumn = String(original.column);
    }
  }

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

  // The captured path retains the host as its first segment (see BROWSER_PATH_REGEX), so a frame that
  // carries its own absolute URL is authoritative for fullFilePath — prefixing location.origin on top
  // of it would double the host (and pick the wrong one for cross-origin scripts). The page origin is
  // only prepended to origin-relative frames that have no scheme of their own.
  const urlMatch = line.match(/(?:https?|file):\/\/[^\s)]+/);
  let fullFilePath: string;
  if (urlMatch != null) {
    // Strip the trailing :line[:column] first (a query string may itself contain colons), then the query.
    fullFilePath = urlMatch[0].replace(/(?::\d+){1,2}$/, "").replace(/\?.*$/, "");
  } else {
    fullFilePath = href ? `${href}${filePath}` : filePath;
  }

  return {
    fullFilePath,
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
 * Matches a JSC-style `func@path:line:col` frame with NO path-shape requirement — React Native bundle
 * locations are often single-segment Metro URLs (`http://host:8081/index.bundle?...`) or bare bundle
 * names (`main.jsbundle`) that {@link BROWSER_PATH_REGEX} (which demands 2+ path segments) rejects.
 */
const REACT_NATIVE_JSC_REGEX = /^\s*(?:([^@\s]*)@)?(.+?):(\d+):(\d+)\s*$/;

/**
 * Parse a React Native stack line. RN needs a hybrid strategy:
 *  - Hermes (the default engine) emits V8-style frames — `at fn (http://host:8081/index.bundle?...:117:42)`
 *    in dev, `at fn (address at index.android.bundle:1:1234)` in release — handled by
 *    {@link parseServerStackLine} (which strips the `address at` prefix and pops line/col before the query).
 *  - JSC emits `fn@location:line:col`, where the location may be a bare bundle name (`main.jsbundle`) —
 *    handled by a lenient dedicated regex, with {@link parseBrowserStackLine} as the final fallback.
 */
export function parseReactNativeStackLine(rawLine: string | undefined, getCwd: () => string | undefined): IStackFrame | undefined {
  if (typeof rawLine !== "string" || rawLine.length === 0) {
    return undefined;
  }

  const serverFrame = parseServerStackLine(rawLine, getCwd);
  if (serverFrame !== undefined) {
    return serverFrame;
  }

  const jscMatch = rawLine.match(REACT_NATIVE_JSC_REGEX);
  if (jscMatch) {
    const method = jscMatch[1] != null && jscMatch[1].length > 0 ? jscMatch[1] : undefined;
    const filePath = jscMatch[2].replace(/\?.*$/, "");
    const fileLine = jscMatch[3];
    const fileColumn = jscMatch[4];
    // "[native code]"-style locations carry no position information worth a frame.
    if (filePath.length > 0 && !filePath.includes("[native")) {
      const pathParts = filePath.split("/");
      const fileName = pathParts[pathParts.length - 1];
      return {
        fullFilePath: jscMatch[2],
        fileName,
        fileNameWithLine: fileName ? `${fileName}:${fileLine}` : undefined,
        fileColumn,
        fileLine,
        filePath,
        filePathWithLine: `${filePath}:${fileLine}`,
        method,
      };
    }
  }

  return parseBrowserStackLine(rawLine);
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
