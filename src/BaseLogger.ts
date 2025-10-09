import { ISettingsParam, ISettings, ILogObjMeta, ILogObj, IErrorObject, IMeta, IMetaStatic, IStackFrame } from "./interfaces.js";
import { urlToObject } from "./urlToObj.js";
import { buildPrettyMeta } from "./internal/metaFormatting.js";
import { toError, collectErrorCauses } from "./internal/errorUtils.js";
import { formatTemplate } from "./formatTemplate.js";
import { formatWithOptions } from "./internal/util.inspect.polyfill.js";
import type { InspectOptions } from "./internal/InspectOptions.interface.js";
import { buildStackTrace, findFirstExternalFrameIndex, clampIndex, getDefaultIgnorePatterns } from "./internal/stackTrace.js";
import { safeGetCwd, consoleSupportsCssStyling, isBrowserEnvironment } from "./internal/environment.js";
import { jsonStringifyRecursive } from "./internal/jsonStringifyRecursive.js";

type RuntimeName = "browser" | "node" | "deno" | "bun" | "worker" | "unknown";

interface RuntimeInfo {
  name: RuntimeName;
  version?: string;
  hostname?: string;
  userAgent?: string;
}

export function createLoggerEnvironment(): LoggerEnvironment {
  const runtimeInfo = detectRuntimeInfo();
  const meta: RuntimeMetaStatic = createRuntimeMeta(runtimeInfo);
  const usesBrowserStack = runtimeInfo.name === "browser" || runtimeInfo.name === "worker";
  const callerIgnorePatterns = usesBrowserStack
    ? [...getDefaultIgnorePatterns(), /node_modules[\\/].*tslog/i]
    : [...getDefaultIgnorePatterns(), /node:(?:internal|vm)/i, /\binternal[\\/]/i];

  let cachedCwd: string | null | undefined;

  const environment: LoggerEnvironment & {
    __resetWorkingDirectoryCacheForTests?: () => void;
  } = {
    getMeta(
      logLevelId: number,
      logLevelName: string,
      stackDepthLevel: number,
      hideLogPositionForPerformance: boolean,
      name?: string,
      parentNames?: string[],
    ): IMeta {
      return Object.assign({}, meta, {
        name,
        parentNames,
        date: new Date(),
        logLevelId,
        logLevelName,
        path: !hideLogPositionForPerformance ? environment.getCallerStackFrame(stackDepthLevel) : undefined,
      }) as RuntimeMeta;
    },
    getCallerStackFrame(stackDepthLevel: number, error: Error = new Error()): IStackFrame {
      const frames = buildStackTrace(error, (line) => parseStackLine(line));
      if (frames.length === 0) {
        return {};
      }

      const autoIndex = findFirstExternalFrameIndex(frames, callerIgnorePatterns);
      const useManualIndex = Number.isFinite(stackDepthLevel) && stackDepthLevel >= 0;
      const resolvedIndex = useManualIndex ? clampIndex(stackDepthLevel, frames.length) : clampIndex(autoIndex, frames.length);
      return frames[resolvedIndex] ?? {};
    },
    getErrorTrace(error: Error): IStackFrame[] {
      return buildStackTrace(error, (line) => parseStackLine(line));
    },
    isError(value: unknown): value is Error {
      return isNativeError(value);
    },
    isBuffer(value: unknown): boolean {
      return typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" ? Buffer.isBuffer(value) : false;
    },
    prettyFormatLogObj<LogObj>(maskedArgs: unknown[], settings: ISettings<LogObj>): { args: unknown[]; errors: string[] } {
      return maskedArgs.reduce(
        (result: { args: unknown[]; errors: string[] }, arg) => {
          if (environment.isError(arg)) {
            result.errors.push(environment.prettyFormatErrorObj(arg as Error, settings));
          } else {
            result.args.push(arg);
          }
          return result;
        },
        { args: [], errors: [] },
      );
    },
    prettyFormatErrorObj<LogObj>(error: Error, settings: ISettings<LogObj>): string {
      const stackLines = formatStackFrames(environment.getErrorTrace(error), settings);
      const causeSections = collectErrorCauses(error).map((cause, index) => {
        const header = `Caused by (${index + 1}): ${cause.name ?? "Error"}${cause.message ? `: ${cause.message}` : ""}`;
        const frames = formatStackFrames(
          buildStackTrace(cause, (line) => parseStackLine(line)),
          settings,
        );
        return [header, ...frames].join("\n");
      });

      const placeholderValuesError = {
        errorName: ` ${error.name} `,
        errorMessage: formatErrorMessage(error),
        errorStack: [...stackLines, ...causeSections].join("\n"),
      };

      return formatTemplate(settings, settings.prettyErrorTemplate, placeholderValuesError);
    },
    transportFormatted<LogObj>(logMetaMarkup: string, logArgs: unknown[], logErrors: string[], logMeta: IMeta | undefined, settings: ISettings<LogObj>): void {
      const prettyLogs = settings.stylePrettyLogs !== false;
      const logErrorsStr = (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") + logErrors.join("\n");
      const sanitizedMetaMarkup = stripAnsi(logMetaMarkup);
      const metaMarkupForText = prettyLogs ? logMetaMarkup : sanitizedMetaMarkup;

      if (shouldUseCss(prettyLogs)) {
        settings.prettyInspectOptions.colors = false;
        const formattedArgs = formatWithOptionsSafe(settings.prettyInspectOptions, logArgs);
        const cssMeta = logMeta != null ? buildCssMetaOutput(settings, logMeta) : { text: sanitizedMetaMarkup, styles: [] };
        const hasCssMeta = cssMeta.text.length > 0 && cssMeta.styles.length > 0;
        const metaOutput = hasCssMeta ? cssMeta.text : sanitizedMetaMarkup;
        const output = metaOutput + formattedArgs + logErrorsStr;

        if (hasCssMeta) {
          console.log(output, ...cssMeta.styles);
        } else {
          console.log(output);
        }
        return;
      }

      settings.prettyInspectOptions.colors = prettyLogs;
      const formattedArgs = formatWithOptionsSafe(settings.prettyInspectOptions, logArgs);
      console.log(metaMarkupForText + formattedArgs + logErrorsStr);
    },
    transportJSON<LogObj>(json: LogObj & ILogObjMeta): void {
      console.log(jsonStringifyRecursive(json));
    },
  };

  if (getNodeEnv() === "test") {
    environment.__resetWorkingDirectoryCacheForTests = () => {
      cachedCwd = undefined;
    };
  }

  return environment;

  function parseStackLine(line?: string): IStackFrame | undefined {
    return usesBrowserStack ? parseBrowserStackLine(line) : parseServerStackLine(line);
  }

  function parseServerStackLine(rawLine?: string): IStackFrame | undefined {
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
    if (segments.length >= 3 && /^\d+$/.test(segments[segments.length - 1] ?? "")) {
      fileColumn = segments.pop();
      fileLine = segments.pop();
      filePathCandidate = segments.join(":");
    } else if (segments.length >= 2 && /^\d+$/.test(segments[segments.length - 1] ?? "")) {
      fileLine = segments.pop();
      filePathCandidate = segments.join(":");
    }

    let normalizedPath = filePathCandidate.replace(/^file:\/\//, "");
    const cwd = getWorkingDirectory();
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

  function parseBrowserStackLine(line?: string): IStackFrame | undefined {
    const href = (globalThis as { location?: { origin?: string } }).location?.origin;
    if (line == null) {
      return undefined;
    }

    const match = line.match(BROWSER_PATH_REGEX);
    if (!match) {
      return undefined;
    }

    const filePath = match[1]?.replace(/\?.*$/, "");
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

  function formatStackFrames<LogObj>(frames: IStackFrame[], settings: ISettings<LogObj>): string[] {
    return frames.map((stackFrame) => formatTemplate(settings, settings.prettyErrorStackTemplate, { ...stackFrame }, true));
  }

  function formatErrorMessage(error: Error): string {
    return Object.getOwnPropertyNames(error)
      .filter((key) => key !== "stack" && key !== "cause")
      .reduce<string[]>((result, key) => {
        const value = (error as unknown as Record<string, unknown>)[key];
        if (typeof value === "function") {
          return result;
        }
        result.push(String(value));
        return result;
      }, [])
      .join(", ");
  }

  function shouldUseCss(prettyLogs: boolean): boolean {
    return prettyLogs && (runtimeInfo.name === "browser" || runtimeInfo.name === "worker") && consoleSupportsCssStyling();
  }

  function stripAnsi(value: string): string {
    return value.replace(ANSI_REGEX, "");
  }

  function buildCssMetaOutput<LogObj>(settings: ISettings<LogObj>, metaValue: IMeta | undefined): { text: string; styles: string[] } {
    if (metaValue == null) {
      return { text: "", styles: [] };
    }

    const { template, placeholders } = buildPrettyMeta(settings, metaValue);
    const parts: string[] = [];
    const styles: string[] = [];
    let lastIndex = 0;
    const placeholderRegex = /{{(.+?)}}/g;
    let match: RegExpExecArray | null;

    while ((match = placeholderRegex.exec(template)) != null) {
      if (match.index > lastIndex) {
        parts.push(template.slice(lastIndex, match.index));
      }

      const key = match[1];
      const rawValue = placeholders[key] != null ? String(placeholders[key]) : "";
      const tokens = collectStyleTokens(settings.prettyLogStyles?.[key as keyof typeof settings.prettyLogStyles], rawValue);
      const css = tokensToCss(tokens);

      if (css.length > 0) {
        parts.push(`%c${rawValue}%c`);
        styles.push(css, "");
      } else {
        parts.push(rawValue);
      }

      lastIndex = placeholderRegex.lastIndex;
    }

    if (lastIndex < template.length) {
      parts.push(template.slice(lastIndex));
    }

    return {
      text: parts.join(""),
      styles,
    };
  }

  function collectStyleTokens(style: unknown, value: string): string[] {
    if (style == null) {
      return [];
    }

    if (typeof style === "string") {
      return [style];
    }

    if (Array.isArray(style)) {
      return style.flatMap((token) => collectStyleTokens(token, value));
    }

    if (typeof style === "object") {
      const normalizedValue = value.trim();
      const nextStyle = (style as Record<string, unknown>)[normalizedValue] ?? (style as Record<string, unknown>)["*"];
      if (nextStyle == null) {
        return [];
      }
      return collectStyleTokens(nextStyle, value);
    }

    return [];
  }

  function tokensToCss(tokens: string[]): string {
    const seen = new Set<string>();
    const cssParts: string[] = [];
    for (const token of tokens) {
      const css = styleTokenToCss(token);
      if (css != null && css.length > 0 && !seen.has(css)) {
        seen.add(css);
        cssParts.push(css);
      }
    }
    return cssParts.join("; ");
  }

  function styleTokenToCss(token: string): string | undefined {
    const color = COLOR_TOKENS[token];
    if (color != null) {
      return `color: ${color}`;
    }

    const background = BACKGROUND_TOKENS[token];
    if (background != null) {
      return `background-color: ${background}`;
    }

    switch (token) {
      case "bold":
        return "font-weight: bold";
      case "dim":
        return "opacity: 0.75";
      case "italic":
        return "font-style: italic";
      case "underline":
        return "text-decoration: underline";
      case "overline":
        return "text-decoration: overline";
      case "inverse":
        return "filter: invert(1)";
      case "hidden":
        return "visibility: hidden";
      case "strikethrough":
        return "text-decoration: line-through";
      default:
        return undefined;
    }
  }

  function getWorkingDirectory(): string | undefined {
    if (cachedCwd === undefined) {
      cachedCwd = safeGetCwd() ?? null;
    }
    return cachedCwd ?? undefined;
  }

  function shouldCaptureHostname(): boolean {
    return runtimeInfo.name === "node" || runtimeInfo.name === "deno" || runtimeInfo.name === "bun";
  }

  function shouldCaptureRuntimeVersion(): boolean {
    return runtimeInfo.name === "node" || runtimeInfo.name === "deno" || runtimeInfo.name === "bun";
  }

  function createRuntimeMeta(info: RuntimeInfo): RuntimeMetaStatic {
    if (info.name === "browser" || info.name === "worker") {
      return {
        runtime: info.name,
        browser: info.userAgent,
      };
    }

    const metaStatic: RuntimeMetaStatic = {
      runtime: info.name,
    };

    if (shouldCaptureRuntimeVersion()) {
      metaStatic.runtimeVersion = info.version ?? "unknown";
    }

    if (shouldCaptureHostname()) {
      metaStatic.hostname = info.hostname ?? "unknown";
    }

    return metaStatic;
  }

  function formatWithOptionsSafe(options: InspectOptions, args: unknown[]): string {
    try {
      return formatWithOptions(options, ...args);
    } catch {
      return args.map(stringifyFallback).join(" ");
    }
  }

  function stringifyFallback(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function normalizeFilePath(value: string): string {
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

  function detectRuntimeInfo(): RuntimeInfo {
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

  function getEnvironmentHostname(
    nodeProcess?: { env?: Record<string, string | undefined> },
    deno?: { env?: { get?: (key: string) => string | undefined } },
    bun?: { env?: Record<string, string | undefined> },
    location?: { hostname?: string },
  ): string | undefined {
    const processHostname = nodeProcess?.env?.HOSTNAME ?? nodeProcess?.env?.HOST ?? nodeProcess?.env?.COMPUTERNAME;
    if (processHostname != null && processHostname.length > 0) {
      return processHostname;
    }

    const bunHostname = bun?.env?.HOSTNAME ?? bun?.env?.HOST ?? bun?.env?.COMPUTERNAME;
    if (bunHostname != null && bunHostname.length > 0) {
      return bunHostname;
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

  function resolveDenoHostname(deno?: { hostname?: () => string }): string | undefined {
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

  function getNodeEnv(): string | undefined {
    const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })?.process;
    return globalProcess?.env?.NODE_ENV;
  }

  function isNativeError(value: unknown): value is Error {
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
}

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\u001b\[[0-9;]*m/g;

const COLOR_TOKENS: Record<string, string> = {
  black: "#000000",
  red: "#ef5350",
  green: "#66bb6a",
  yellow: "#fdd835",
  blue: "#42a5f5",
  magenta: "#ab47bc",
  cyan: "#26c6da",
  white: "#fafafa",
  blackBright: "#424242",
  redBright: "#ff7043",
  greenBright: "#81c784",
  yellowBright: "#ffe082",
  blueBright: "#64b5f6",
  magentaBright: "#ce93d8",
  cyanBright: "#4dd0e1",
  whiteBright: "#ffffff",
};

const BACKGROUND_TOKENS: Record<string, string> = {
  bgBlack: "#000000",
  bgRed: "#ef5350",
  bgGreen: "#66bb6a",
  bgYellow: "#fdd835",
  bgBlue: "#42a5f5",
  bgMagenta: "#ab47bc",
  bgCyan: "#26c6da",
  bgWhite: "#fafafa",
  bgBlackBright: "#424242",
  bgRedBright: "#ff7043",
  bgGreenBright: "#81c784",
  bgYellowBright: "#ffe082",
  bgBlueBright: "#64b5f6",
  bgMagentaBright: "#ce93d8",
  bgCyanBright: "#4dd0e1",
  bgWhiteBright: "#ffffff",
};
interface LoggerEnvironment {
  getMeta: (
    logLevelId: number,
    logLevelName: string,
    stackDepthLevel: number,
    hideLogPositionForPerformance: boolean,
    name?: string,
    parentNames?: string[],
  ) => IMeta;
  getCallerStackFrame: (stackDepthLevel: number, error?: Error) => IStackFrame;
  getErrorTrace: (error: Error) => IStackFrame[];
  isError: (value: unknown) => value is Error;
  isBuffer: (value: unknown) => boolean;
  prettyFormatLogObj: <LogObj>(
    maskedArgs: unknown[],
    settings: ISettings<LogObj>,
  ) => {
    args: unknown[];
    errors: string[];
  };
  prettyFormatErrorObj: <LogObj>(error: Error, settings: ISettings<LogObj>) => string;
  transportFormatted: <LogObj>(logMetaMarkup: string, logArgs: unknown[], logErrors: string[], logMeta: IMeta | undefined, settings: ISettings<LogObj>) => void;
  transportJSON: <LogObj>(json: LogObj & ILogObjMeta) => void;
}

type RuntimeMetaStatic = IMetaStatic & {
  runtimeVersion?: string;
  hostname?: string;
  browser?: string;
};

type RuntimeMeta = IMeta & {
  runtimeVersion?: string;
  hostname?: string;
  browser?: string;
};

const BROWSER_PATH_REGEX = /(?:(?:https?|file|global code):\/\/[^\s)]+\/)?((?:\/|[A-Za-z]:\/)[^:\s)]+?\.\w+(?:\?\S+)?):(\d+):(\d+)/;

const runtime = createLoggerEnvironment();

export const loggerEnvironment = runtime;

export * from "./interfaces.js";

export class BaseLogger<LogObj> {
  public readonly runtime: LoggerEnvironment = runtime;
  public settings: ISettings<LogObj>;
  private readonly maxErrorCauseDepth = 5;
  private readonly captureStackForMeta: boolean;
  private maskKeysCache?: {
    source: string[];
    caseInsensitive: boolean;
    normalized: (string | number)[];
    signature: string;
  };
  // not needed yet
  //private subLoggers: BaseLogger<LogObj>[] = [];

  constructor(
    settings?: ISettingsParam<LogObj>,
    private logObj?: LogObj,
    private stackDepthLevel: number = Number.NaN,
  ) {
    this.settings = {
      type: settings?.type ?? "pretty",
      name: settings?.name,
      parentNames: settings?.parentNames,
      minLevel: settings?.minLevel ?? 0,
      argumentsArrayName: settings?.argumentsArrayName,
      hideLogPositionForProduction: settings?.hideLogPositionForProduction ?? false,
      prettyLogTemplate:
        settings?.prettyLogTemplate ??
        "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t{{filePathWithLine}}{{nameWithDelimiterPrefix}}\t",
      prettyErrorTemplate: settings?.prettyErrorTemplate ?? "\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}",
      prettyErrorStackTemplate: settings?.prettyErrorStackTemplate ?? "  • {{fileName}}\t{{method}}\n\t{{filePathWithLine}}",
      prettyErrorParentNamesSeparator: settings?.prettyErrorParentNamesSeparator ?? ":",
      prettyErrorLoggerNameDelimiter: settings?.prettyErrorLoggerNameDelimiter ?? "\t",
      stylePrettyLogs: settings?.stylePrettyLogs ?? true,
      prettyLogTimeZone: settings?.prettyLogTimeZone ?? "UTC",
      prettyLogStyles: settings?.prettyLogStyles ?? {
        logLevelName: {
          "*": ["bold", "black", "bgWhiteBright", "dim"],
          SILLY: ["bold", "white"],
          TRACE: ["bold", "whiteBright"],
          DEBUG: ["bold", "green"],
          INFO: ["bold", "blue"],
          WARN: ["bold", "yellow"],
          ERROR: ["bold", "red"],
          FATAL: ["bold", "redBright"],
        },
        dateIsoStr: "white",
        filePathWithLine: "white",
        name: ["white", "bold"],
        nameWithDelimiterPrefix: ["white", "bold"],
        nameWithDelimiterSuffix: ["white", "bold"],
        errorName: ["bold", "bgRedBright", "whiteBright"],
        fileName: ["yellow"],
        fileNameWithLine: "white",
      },
      prettyInspectOptions: settings?.prettyInspectOptions ?? {
        colors: true,
        compact: false,
        depth: Infinity,
      },
      metaProperty: settings?.metaProperty ?? "_meta",
      maskPlaceholder: settings?.maskPlaceholder ?? "[***]",
      maskValuesOfKeys: settings?.maskValuesOfKeys ?? ["password"],
      maskValuesOfKeysCaseInsensitive: settings?.maskValuesOfKeysCaseInsensitive ?? false,
      maskValuesRegEx: settings?.maskValuesRegEx,
      prefix: [...(settings?.prefix ?? [])],
      attachedTransports: [...(settings?.attachedTransports ?? [])],
      overwrite: {
        mask: settings?.overwrite?.mask,
        toLogObj: settings?.overwrite?.toLogObj,
        addMeta: settings?.overwrite?.addMeta,
        addPlaceholders: settings?.overwrite?.addPlaceholders,
        formatMeta: settings?.overwrite?.formatMeta,
        formatLogObj: settings?.overwrite?.formatLogObj,
        transportFormatted: settings?.overwrite?.transportFormatted,
        transportJSON: settings?.overwrite?.transportJSON,
      },
    };

    this.captureStackForMeta = this._shouldCaptureStack();
  }

  /**
   * Logs a message with a custom log level.
   * @param logLevelId    - Log level ID e.g. 0
   * @param logLevelName  - Log level name e.g. silly
   * @param args          - Multiple log attributes that should be logged out.
   * @return LogObject with meta property, when log level is >= minLevel
   */
  public log(logLevelId: number, logLevelName: string, ...args: unknown[]): (LogObj & ILogObjMeta) | undefined {
    if (logLevelId < this.settings.minLevel) {
      return;
    }
    const resolvedArgs = this._resolveLogArguments(args);
    const logArgs = [...this.settings.prefix, ...resolvedArgs];
    const maskedArgs: unknown[] =
      this.settings.overwrite?.mask != null
        ? this.settings.overwrite?.mask(logArgs)
        : this.settings.maskValuesOfKeys != null && this.settings.maskValuesOfKeys.length > 0
          ? this._mask(logArgs)
          : logArgs;
    // execute default LogObj functions for every log (e.g. requestId)
    const thisLogObj: LogObj | undefined = this.logObj != null ? this._recursiveCloneAndExecuteFunctions(this.logObj) : undefined;
    const logObj: LogObj =
      this.settings.overwrite?.toLogObj != null ? this.settings.overwrite?.toLogObj(maskedArgs, thisLogObj) : this._toLogObj(maskedArgs, thisLogObj);
    const logObjWithMeta: LogObj & ILogObjMeta =
      this.settings.overwrite?.addMeta != null
        ? this.settings.overwrite?.addMeta(logObj, logLevelId, logLevelName)
        : this._addMetaToLogObj(logObj, logLevelId, logLevelName);
    const logMeta = logObjWithMeta?.[this.settings.metaProperty] as IMeta | undefined;

    // overwrite no matter what, should work for any type (pretty, json, ...)
    let logMetaMarkup;
    let logArgsAndErrorsMarkup: { args: unknown[]; errors: string[] } | undefined = undefined;
    if (this.settings.overwrite?.formatMeta != null) {
      logMetaMarkup = this.settings.overwrite?.formatMeta(logObjWithMeta?.[this.settings.metaProperty]);
    }
    if (this.settings.overwrite?.formatLogObj != null) {
      logArgsAndErrorsMarkup = this.settings.overwrite?.formatLogObj(maskedArgs, this.settings);
    }

    if (this.settings.type === "pretty") {
      logMetaMarkup = logMetaMarkup ?? this._prettyFormatLogObjMeta(logObjWithMeta?.[this.settings.metaProperty]);
      logArgsAndErrorsMarkup = logArgsAndErrorsMarkup ?? runtime.prettyFormatLogObj(maskedArgs, this.settings);
    }

    if (logMetaMarkup != null && logArgsAndErrorsMarkup != null) {
      if (this.settings.overwrite?.transportFormatted != null) {
        const transport = this.settings.overwrite.transportFormatted;
        const declaredParams = transport.length;
        if (declaredParams < 4) {
          transport(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors);
        } else if (declaredParams === 4) {
          transport(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors, logMeta);
        } else {
          transport(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors, logMeta, this.settings);
        }
      } else {
        runtime.transportFormatted(logMetaMarkup, logArgsAndErrorsMarkup.args, logArgsAndErrorsMarkup.errors, logMeta, this.settings);
      }
    } else {
      // overwrite transport no matter what, hide only with default transport
      if (this.settings.overwrite?.transportJSON != null) {
        this.settings.overwrite.transportJSON(logObjWithMeta);
      } else if (this.settings.type !== "hidden") {
        runtime.transportJSON(logObjWithMeta);
      }
    }

    if (this.settings.attachedTransports != null && this.settings.attachedTransports.length > 0) {
      this.settings.attachedTransports.forEach((transportLogger) => {
        transportLogger(logObjWithMeta);
      });
    }

    return logObjWithMeta;
  }

  /**
   *  Attaches external Loggers, e.g. external log services, file system, database
   *
   * @param transportLogger - External logger to be attached. Must implement all log methods.
   */
  public attachTransport(transportLogger: (transportLogger: LogObj & ILogObjMeta) => void): void {
    this.settings.attachedTransports.push(transportLogger);
  }

  /**
   *  Returns a child logger based on the current instance with inherited settings
   *
   * @param settings - Overwrite settings inherited from parent logger
   * @param logObj - Overwrite logObj for sub-logger
   */
  public getSubLogger(settings?: ISettingsParam<LogObj>, logObj?: LogObj): BaseLogger<LogObj> {
    const subLoggerSettings: ISettings<LogObj> = {
      ...this.settings,
      ...settings,
      // collect parent names in Array
      parentNames:
        this.settings?.parentNames != null && this.settings?.name != null
          ? [...this.settings.parentNames, this.settings.name]
          : this.settings?.name != null
            ? [this.settings.name]
            : undefined,
      // merge all prefixes instead of overwriting them
      prefix: [...this.settings.prefix, ...(settings?.prefix ?? [])],
    };

    const subLogger: BaseLogger<LogObj> = new (this.constructor as new (
      subLoggerSettings?: ISettingsParam<LogObj>,
      logObj?: LogObj,
      stackDepthLevel?: number,
    ) => this)(subLoggerSettings, logObj ?? this.logObj, this.stackDepthLevel);
    //this.subLoggers.push(subLogger);
    return subLogger;
  }

  private _mask(args: unknown[]): unknown[] {
    const maskKeys = this._getMaskKeys();
    return args?.map((arg) => {
      return this._recursiveCloneAndMaskValuesOfKeys(arg, maskKeys);
    });
  }

  private _getMaskKeys(): (string | number)[] {
    const maskKeys = this.settings.maskValuesOfKeys ?? [];
    const signature = maskKeys.map(String).join("|");
    if (this.settings.maskValuesOfKeysCaseInsensitive === true) {
      if (this.maskKeysCache?.source === maskKeys && this.maskKeysCache.caseInsensitive === true && this.maskKeysCache.signature === signature) {
        return this.maskKeysCache.normalized;
      }

      const normalized = maskKeys.map((key) => (typeof key === "string" ? key.toLowerCase() : String(key).toLowerCase()));
      this.maskKeysCache = {
        source: maskKeys,
        caseInsensitive: true,
        normalized,
        signature,
      };
      return normalized;
    }

    this.maskKeysCache = {
      source: maskKeys,
      caseInsensitive: false,
      normalized: maskKeys,
      signature,
    };
    return maskKeys;
  }

  private _resolveLogArguments(args: unknown[]): unknown[] {
    if (args.length === 1 && typeof args[0] === "function") {
      const candidate = args[0] as () => unknown;
      if (candidate.length === 0) {
        const result = candidate();
        return Array.isArray(result) ? result : [result];
      }
    }
    return args;
  }

  private _recursiveCloneAndMaskValuesOfKeys<T>(source: T, keys: (number | string)[], seen: unknown[] = []): T {
    if (seen.includes(source)) {
      return { ...source } as T;
    }
    if (typeof source === "object" && source !== null) {
      seen.push(source);
    }

    if (runtime.isError(source) || runtime.isBuffer(source)) {
      return source as T;
    } else if (source instanceof Map) {
      return new Map(source) as T;
    } else if (source instanceof Set) {
      return new Set(source) as T;
    } else if (Array.isArray(source)) {
      return source.map((item) => this._recursiveCloneAndMaskValuesOfKeys(item, keys, seen)) as unknown as T;
    } else if (source instanceof Date) {
      return new Date(source.getTime()) as T;
    } else if (source instanceof URL) {
      return urlToObject(source) as T;
    } else if (source !== null && typeof source === "object") {
      const baseObject = runtime.isError(source) ? this._cloneError(source as unknown as Error) : Object.create(Object.getPrototypeOf(source));
      return Object.getOwnPropertyNames(source).reduce((o, prop) => {
        const lookupKey =
          this.settings?.maskValuesOfKeysCaseInsensitive !== true
            ? (prop as string)
            : typeof prop === "string"
              ? prop.toLowerCase()
              : String(prop).toLowerCase();
        o[prop] = keys.includes(lookupKey)
          ? this.settings.maskPlaceholder
          : (() => {
              try {
                return this._recursiveCloneAndMaskValuesOfKeys((source as Record<string, unknown>)[prop], keys, seen);
              } catch {
                return null;
              }
            })();
        return o;
      }, baseObject) as T;
    } else {
      if (typeof source === "string") {
        let modifiedSource: string = source;
        for (const regEx of this.settings?.maskValuesRegEx || []) {
          modifiedSource = modifiedSource.replace(regEx, this.settings?.maskPlaceholder || "");
        }
        return modifiedSource as unknown as T;
      }
      return source;
    }
  }

  private _recursiveCloneAndExecuteFunctions<T>(source: T, seen: (object | Array<unknown>)[] = []): T {
    if (this.isObjectOrArray(source) && seen.includes(source)) {
      return this.shallowCopy(source);
    }

    if (this.isObjectOrArray(source)) {
      seen.push(source);
    }

    if (Array.isArray(source)) {
      return source.map((item) => this._recursiveCloneAndExecuteFunctions(item, seen)) as unknown as T;
    } else if (source instanceof Date) {
      return new Date(source.getTime()) as unknown as T;
    } else if (this.isObject(source)) {
      return Object.getOwnPropertyNames(source).reduce(
        (o, prop) => {
          const descriptor = Object.getOwnPropertyDescriptor(source, prop);
          if (descriptor) {
            Object.defineProperty(o, prop, descriptor);
            const value = (source as Record<string, unknown>)[prop];
            o[prop] = typeof value === "function" ? value() : this._recursiveCloneAndExecuteFunctions(value, seen);
          }
          return o;
        },
        Object.create(Object.getPrototypeOf(source)),
      ) as T;
    } else {
      return source;
    }
  }

  private isObjectOrArray(value: unknown): value is object | unknown[] {
    return typeof value === "object" && value !== null;
  }

  private isObject(value: unknown): value is object {
    return typeof value === "object" && !Array.isArray(value) && value !== null;
  }

  private shallowCopy<T>(source: T): T {
    if (Array.isArray(source)) {
      return [...source] as unknown as T;
    } else {
      return { ...source } as unknown as T;
    }
  }

  private _toLogObj(args: unknown[], clonedLogObj: LogObj = {} as LogObj): LogObj {
    args = args?.map((arg) => (runtime.isError(arg) ? this._toErrorObject(arg as Error) : arg));
    if (this.settings.argumentsArrayName == null) {
      if (args.length === 1 && !Array.isArray(args[0]) && runtime.isBuffer(args[0]) !== true && !(args[0] instanceof Date)) {
        clonedLogObj = typeof args[0] === "object" && args[0] != null ? { ...args[0], ...clonedLogObj } : { 0: args[0], ...clonedLogObj };
      } else {
        clonedLogObj = { ...clonedLogObj, ...args };
      }
    } else {
      clonedLogObj = {
        ...clonedLogObj,
        [this.settings.argumentsArrayName]: args,
      };
    }
    return clonedLogObj;
  }

  private _cloneError<T extends Error>(error: T): T {
    const cloned = new (error.constructor as { new (): T })();

    Object.getOwnPropertyNames(error).forEach((key) => {
      (cloned as Record<string, unknown>)[key] = (error as Record<string, unknown>)[key];
    });

    return cloned;
  }

  private _toErrorObject(error: Error, depth = 0, seen: Set<Error> = new Set()): IErrorObject {
    if (!seen.has(error)) {
      seen.add(error);
    }

    const errorObject: IErrorObject = {
      nativeError: error,
      name: error.name ?? "Error",
      message: error.message,
      stack: runtime.getErrorTrace(error),
    };

    if (depth >= this.maxErrorCauseDepth) {
      return errorObject;
    }

    const causeValue = (error as { cause?: unknown }).cause;
    if (causeValue != null) {
      const normalizedCause = toError(causeValue);
      if (!seen.has(normalizedCause)) {
        errorObject.cause = this._toErrorObject(normalizedCause, depth + 1, seen);
      }
    }

    return errorObject;
  }

  private _addMetaToLogObj(logObj: LogObj, logLevelId: number, logLevelName: string): LogObj & ILogObjMeta & ILogObj {
    return {
      ...logObj,
      [this.settings.metaProperty]: runtime.getMeta(
        logLevelId,
        logLevelName,
        this.stackDepthLevel,
        !this.captureStackForMeta,
        this.settings.name,
        this.settings.parentNames,
      ),
    };
  }

  private _shouldCaptureStack(): boolean {
    if (this.settings.hideLogPositionForProduction) {
      return false;
    }
    if (this.settings.type === "json") {
      return true;
    }

    const template = this.settings.prettyLogTemplate ?? "";
    const stackPlaceholders = /{{\s*(file(Name|Path|Line|PathWithLine|NameWithLine)|fullFilePath)\s*}}/;
    if (stackPlaceholders.test(template)) {
      return true;
    }

    return false;
  }

  private _prettyFormatLogObjMeta(logObjMeta?: IMeta): string {
    return buildPrettyMeta(this.settings, logObjMeta).text;
  }
}
