import { formatTemplate } from "../formatTemplate.js";
import type { ILogObjMeta, IMeta, ISettings, IStackFrame } from "../interfaces.js";
import { consoleSupportsCssStyling, safeGetCwd } from "../internal/environment.js";
import { collectErrorCauses, safeErrorString } from "../internal/errorUtils.js";
import type { InspectOptions } from "../internal/InspectOptions.interface.js";
import { jsonStringifyRecursive } from "../internal/jsonStringifyRecursive.js";
import { buildPrettyMeta } from "../internal/metaFormatting.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";
import type { FormatWithOptions } from "../render/inspect.js";
import { ansiToCssConsoleFormat, styleTokenToCss } from "../render/styles.js";
import type { EnvironmentProvider } from "./environment.js";
import {
  createRuntimeMeta,
  detectOwnBrowserFilePattern,
  formatErrorMessage,
  formatStackFrames,
  getPrettyLogMethod,
  isNativeError,
  parseBrowserStackLine,
  parseReactNativeStackLine,
  parseServerStackLine,
  type RuntimeInfo,
  type RuntimeMetaStatic,
  type SourceMapResolver,
  stringifyFallback,
  stripAnsi,
} from "./shared.js";
import { buildStackTrace, clampIndex, findFirstExternalFrameIndex, getDefaultIgnorePatterns } from "./stackTrace.js";

/**
 * The runtime-agnostic {@link EnvironmentProvider} implementation shared by the node, universal, and
 * browser providers. Historically each provider carried a byte-identical copy of `getCallerStackFrame`,
 * `getErrorTrace`, `isError`/`isBuffer`, the pretty formatting trio, `transportFormatted` (with the
 * CSS `%c` block duplicated between the universal and browser copies), and `transportJSON`; the only
 * real per-provider differences are captured by {@link ProviderBaseConfig}:
 *
 *  - which stack parser applies (a pure function of the detected runtime, or forced server-style);
 *  - how the `formatWithOptions` implementation is resolved (static `node:util` import vs
 *    construction-time vs lazy `resolveInspect()`);
 *  - whether `transportFormatted` may take the CSS `%c` console path at all.
 *
 * `getMeta` intentionally stays in the entries: the node provider builds lazy-path meta via
 * `core/meta.ts` (`buildMeta` + {@link ProviderBase.resolveCallerStackFrame}), while the universal and
 * browser providers assemble eagerly via {@link ProviderBase.buildEagerMeta}.
 *
 * Nothing here runs at module top level, so `sideEffects: false` keeps holding. The slim provider
 * (`environment.slim.ts`) deliberately does NOT use this base — it ships its own minimal methods to
 * hold the slim bundle budget.
 */
export interface ProviderBaseConfig {
  /** Runtime detected at provider construction; drives stack-parser choice, ignore patterns, and static meta. */
  runtimeInfo: RuntimeInfo;
  /**
   * `"adaptive"` (universal/browser entries): stack parsing follows the detected runtime — browser
   * frames on browser/worker, the hybrid Hermes/JSC parser on React Native, server (V8) frames
   * elsewhere — and `transportFormatted` may take the CSS `%c` console path where the console supports
   * it. `"server"` (node entry): always parse server-style frames and never take the CSS path.
   */
  flavor: "server" | "adaptive";
  /**
   * Return the `formatWithOptions` implementation. Invoked on every safe-format call, so each provider
   * keeps its own resolution timing: node returns its static `node:util` import, universal a value
   * resolved once at construction, and browser a lazily-memoized `resolveInspect()`.
   */
  getFormatWithOptions(): FormatWithOptions;
  /**
   * Resolve a transpiled/bundled server-style frame back to its original source position via a
   * source map (issue #307). Only ever supplied by the node/universal providers — undefined here
   * means "never attempt source-map resolution" (browser/React Native/slim always pass undefined).
   */
  resolveSourceMap?: SourceMapResolver;
}

/** Everything {@link createProviderBase} hands back to a provider entry. */
export interface ProviderBase {
  /** The shared {@link EnvironmentProvider} methods; entries spread these and add their runtime-specific ones. */
  methods: Pick<
    EnvironmentProvider,
    | "getCallerStackFrame"
    | "getErrorTrace"
    | "isError"
    | "isBuffer"
    | "prettyFormatLogObj"
    | "prettyFormatErrorObj"
    | "prettyFormatLine"
    | "transportFormatted"
    | "transportJSON"
  >;
  /** Static runtime meta (`createRuntimeMeta` over the config's runtime), shared by both getMeta styles. */
  staticMeta: RuntimeMetaStatic;
  /** The `MetaDeps.resolveCallerStackFrame` seam for the lazy-path `core/meta.ts` getMeta (node entry). */
  resolveCallerStackFrame(error: Error, callerFrame: number, internalFramePatterns?: RegExp[]): IStackFrame;
  /**
   * Eager getMeta assembly (universal/browser entries): static meta + date/level, with `path` resolved
   * immediately from `positionError`. Pass `undefined` as `positionError` when position capture is off —
   * the provider's thin `getMeta` decides and captures the `Error` ITSELF, so the frame depth a manual
   * `callerFrame` index sees is identical to capturing inside the provider method.
   */
  buildEagerMeta(
    logLevelId: number,
    logLevelName: string,
    callerFrame: number,
    positionError: Error | undefined,
    name?: string,
    parentNames?: string[],
    internalFramePatterns?: RegExp[],
  ): IMeta;
}

type RuntimeMeta = IMeta & {
  runtimeVersion?: string;
  hostname?: string;
  browser?: string;
};

/** Build the shared provider methods and the getMeta seams for one runtime configuration. */
export function createProviderBase(config: ProviderBaseConfig): ProviderBase {
  const { runtimeInfo } = config;
  const staticMeta: RuntimeMetaStatic = createRuntimeMeta(runtimeInfo);
  const adaptive = config.flavor === "adaptive";
  const usesBrowserStack = adaptive && (runtimeInfo.name === "browser" || runtimeInfo.name === "worker");
  // React Native needs a hybrid parser: Hermes (the default engine) emits V8-style frames
  // ("at fn (address at index.android.bundle:1:1234)"), while JSC emits "fn@main.jsbundle:1:2" —
  // parseReactNativeStackLine tries the server parser first and falls back to the JSC shapes.
  const isReactNative = adaptive && runtimeInfo.name === "react-native";
  // Auto-detection skips tslog's own frames; server-style runtimes additionally skip node:internal/vm
  // and the generic `internal/` directory (preserved from the monolith).
  const callerIgnorePatterns: RegExp[] =
    usesBrowserStack || isReactNative
      ? [...getDefaultIgnorePatterns(), /node_modules[\\/].*tslog/i]
      : [...getDefaultIgnorePatterns(), /node:(?:internal|vm)/i, /\binternal[\\/]/i];
  if (usesBrowserStack) {
    // The browser IIFE has no import.meta-based own-dir marker, so detect the file tslog is served
    // from (script tag / CDN / dev-server deps chunk) and skip its frames in caller detection.
    const ownFilePattern = detectOwnBrowserFilePattern();
    if (ownFilePattern != null) {
      callerIgnorePatterns.push(ownFilePattern);
    }
  }

  // Provider-owned cwd cache: resolved once via safeGetCwd() and reused for every stack line.
  let cachedCwd: string | null | undefined;

  function getWorkingDirectory(): string | undefined {
    if (cachedCwd === undefined) {
      cachedCwd = safeGetCwd() ?? null;
    }
    return cachedCwd ?? undefined;
  }

  function parseStackLine(line?: string): IStackFrame | undefined {
    if (isReactNative) {
      return parseReactNativeStackLine(line, getWorkingDirectory);
    }
    return usesBrowserStack ? parseBrowserStackLine(line) : parseServerStackLine(line, getWorkingDirectory, config.resolveSourceMap);
  }

  /** Run the configured formatWithOptions, falling back to a best-effort stringify if it throws. */
  function formatWithOptionsSafe(options: InspectOptions, args: unknown[]): string {
    try {
      return config.getFormatWithOptions()(options, ...args);
    } catch {
      return args.map(stringifyFallback).join(" ");
    }
  }

  /** Resolve the caller's stack frame from a captured error, honoring manual index / auto-detection. */
  function resolveCallerStackFrame(error: Error, callerFrame: number, internalFramePatterns?: RegExp[]): IStackFrame {
    const frames = buildStackTrace(error, parseStackLine);
    if (frames.length === 0) {
      return {};
    }

    // Allow callers (e.g. wrapper/custom loggers) to register additional frame patterns to skip,
    // so auto-detection lands on their caller rather than the wrapper itself.
    const ignorePatterns =
      internalFramePatterns != null && internalFramePatterns.length > 0 ? [...callerIgnorePatterns, ...internalFramePatterns] : callerIgnorePatterns;
    const autoIndex = findFirstExternalFrameIndex(frames, ignorePatterns);
    const useManualIndex = Number.isFinite(callerFrame) && callerFrame >= 0;
    const resolvedIndex = useManualIndex ? clampIndex(callerFrame, frames.length) : clampIndex(autoIndex, frames.length);
    /* v8 ignore next -- defensive: clampIndex always yields a valid index for a non-empty frames array */
    return frames[resolvedIndex] ?? {};
  }

  const methods: ProviderBase["methods"] = {
    getCallerStackFrame(callerFrame: number, error: Error = new Error(), internalFramePatterns?: RegExp[]): IStackFrame {
      return resolveCallerStackFrame(error, callerFrame, internalFramePatterns);
    },
    getErrorTrace(error: Error): IStackFrame[] {
      return buildStackTrace(error, parseStackLine);
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
          if (methods.isError(arg)) {
            result.errors.push(methods.prettyFormatErrorObj(arg as Error, settings));
          } else {
            result.args.push(arg);
          }
          return result;
        },
        { args: [], errors: [] },
      );
    },
    prettyFormatErrorObj<LogObj>(error: Error, settings: ISettings<LogObj>): string {
      const stackLines = formatStackFrames(methods.getErrorTrace(error), settings);
      const causeSections = collectErrorCauses(error).map((cause, index) => {
        const causeMessage = safeErrorString(cause, "message", "");
        const header = `Caused by (${index + 1}): ${safeErrorString(cause, "name", "Error")}${causeMessage ? `: ${causeMessage}` : ""}`;
        const frames = formatStackFrames(buildStackTrace(cause, parseStackLine), settings);
        return [header, ...frames].join("\n");
      });

      const placeholderValuesError = {
        errorName: ` ${safeErrorString(error, "name", "Error")} `,
        errorMessage: formatErrorMessage(error),
        errorStack: [...stackLines, ...causeSections].join("\n"),
      };

      return formatTemplate(settings, settings.pretty.errorTemplate, placeholderValuesError);
    },
    prettyFormatLine<LogObj>(maskedArgs: unknown[], meta: IMeta | undefined, settings: ISettings<LogObj>): string {
      const prettyLogs = settings.pretty.style !== false;
      const { args: logArgs, errors: logErrors } = methods.prettyFormatLogObj(maskedArgs, settings);
      const logMetaMarkup = buildPrettyMeta(settings, meta).text;
      const logErrorsStr = (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") + logErrors.join("\n");
      const metaMarkupForText = prettyLogs ? logMetaMarkup : stripAnsi(logMetaMarkup);

      settings.pretty.inspectOptions.colors = prettyLogs;
      const formattedArgs = formatWithOptionsSafe(settings.pretty.inspectOptions, logArgs);
      return metaMarkupForText + formattedArgs + logErrorsStr;
    },
    transportFormatted<LogObj>(logMetaMarkup: string, logArgs: unknown[], logErrors: string[], logMeta: IMeta | undefined, settings: ISettings<LogObj>): void {
      const prettyLogs = settings.pretty.style !== false;
      // When passing objects natively, the raw args become trailing console arguments rather than part
      // of the rendered string, so any inter-arg spacing is the console's job — the string ends at the
      // meta prefix (kept only when there are no native args to trail, e.g. an errors-only record).
      const nativeArgs = settings.pretty.passObjectsNatively;
      const logErrorsStr = (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") + logErrors.join("\n");
      const log = getPrettyLogMethod(logMeta?.logLevelName, settings.pretty.levelMethod);

      // CSS %c styling: adaptive providers only, while pretty styling is on and the console supports
      // it. The server flavor (node entry) always takes the plain-text path below.
      if (prettyLogs && usesBrowserStack && consoleSupportsCssStyling()) {
        const sanitizedMetaMarkup = stripAnsi(logMetaMarkup);
        settings.pretty.inspectOptions.colors = false;
        const formattedArgs = nativeArgs ? "" : formatWithOptionsSafe(settings.pretty.inspectOptions, logArgs);
        const cssMeta = logMeta != null ? buildCssMetaOutput(settings, logMeta) : { text: sanitizedMetaMarkup, styles: [] };
        const hasCssMeta = cssMeta.text.length > 0 && cssMeta.styles.length > 0;
        const metaOutput = hasCssMeta ? cssMeta.text : sanitizedMetaMarkup;
        // Errors arrive pre-rendered with ANSI styling (only Chromium's console interprets ANSI;
        // Firefox/WebKit print the escapes literally), so they are re-expressed as `%c` CSS segments.
        // That styling only survives inside the format string, which prints before any trailing
        // arguments — so errors embed there unless native args must print between meta and errors,
        // in which case they trail as plain (ANSI-stripped) text.
        const embedErrors = !nativeArgs || logArgs.length === 0;
        const cssErrors = embedErrors && logErrorsStr.length > 0 ? ansiToCssConsoleFormat(logErrorsStr) : { text: "", styles: [] };
        const output = metaOutput + formattedArgs + cssErrors.text;
        const styleArgs = [...(hasCssMeta ? cssMeta.styles : []), ...cssErrors.styles];
        const trailing = nativeArgs ? [...logArgs, ...(!embedErrors && logErrorsStr.length > 0 ? [stripAnsi(logErrorsStr)] : [])] : [];

        if (styleArgs.length > 0) {
          log(output, ...styleArgs, ...trailing);
        } else {
          log(output, ...trailing);
        }
        return;
      }

      settings.pretty.inspectOptions.colors = prettyLogs;
      const metaPrefix = prettyLogs ? logMetaMarkup : stripAnsi(logMetaMarkup);
      if (nativeArgs) {
        log(metaPrefix, ...logArgs, ...(logErrorsStr ? [logErrorsStr] : []));
        return;
      }
      const formattedArgs = formatWithOptionsSafe(settings.pretty.inspectOptions, logArgs);
      log(metaPrefix + formattedArgs + logErrorsStr);
    },
    transportJSON<LogObj>(json: LogObj & ILogObjMeta): void {
      nativeConsoleMethod("log")(jsonStringifyRecursive(json));
    },
  };

  function buildEagerMeta(
    logLevelId: number,
    logLevelName: string,
    callerFrame: number,
    positionError: Error | undefined,
    name?: string,
    parentNames?: string[],
    internalFramePatterns?: RegExp[],
  ): IMeta {
    const built = Object.assign({}, staticMeta, {
      date: new Date(),
      logLevelId,
      logLevelName,
    }) as RuntimeMeta;
    // Omit `path` entirely when capture is off (no positionError): an ever-present `path: undefined`
    // key serialized as the junk string "[undefined]" on every record.
    if (positionError != null) {
      built.path = methods.getCallerStackFrame(callerFrame, positionError, internalFramePatterns);
    }
    // Omit name/parentNames when unset so they don't serialize as `"[undefined]"`.
    if (name !== undefined) {
      built.name = name;
    }
    if (parentNames !== undefined) {
      built.parentNames = parentNames;
    }
    return built;
  }

  return { methods, staticMeta, resolveCallerStackFrame, buildEagerMeta };
}

/**
 * Render the pretty meta template with CSS `%c` markers: each placeholder whose style resolves to CSS
 * is wrapped in a `%c...%c` pair with the matching entries pushed onto `styles` (console.log consumes
 * them positionally). Placeholders without a resolvable style are emitted as plain text.
 */
function buildCssMetaOutput<LogObj>(settings: ISettings<LogObj>, metaValue: IMeta | undefined): { text: string; styles: string[] } {
  /* v8 ignore next 3 -- defensive: the sole caller only invokes this when logMeta is non-null */
  if (metaValue == null) {
    return { text: "", styles: [] };
  }

  const { template, placeholders } = buildPrettyMeta(settings, metaValue);
  const parts: string[] = [];
  const styles: string[] = [];
  let lastIndex = 0;
  const placeholderRegex = /{{(.+?)}}/g;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = placeholderRegex.exec(template)) != null) {
    if (match.index > lastIndex) {
      parts.push(template.slice(lastIndex, match.index));
    }

    const key = match[1];
    const rawValue = placeholders[key] != null ? String(placeholders[key]) : "";
    const tokens = collectStyleTokens(settings.pretty.styles?.[key as keyof typeof settings.pretty.styles], rawValue);
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

/** Flatten a pretty style setting (string, array, or per-value map with a `"*"` wildcard) into tokens. */
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

/** Convert style tokens to a deduplicated `;`-joined CSS declaration string. */
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
