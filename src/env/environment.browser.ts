import { formatTemplate } from "../formatTemplate.js";
import type { ILogObjMeta, IMeta, ISettings, IStackFrame } from "../interfaces.js";
import { consoleSupportsCssStyling, safeGetCwd } from "../internal/environment.js";
import { collectErrorCauses, safeErrorString } from "../internal/errorUtils.js";
import type { InspectOptions } from "../internal/InspectOptions.interface.js";
import { jsonStringifyRecursive } from "../internal/jsonStringifyRecursive.js";
import { buildPrettyMeta } from "../internal/metaFormatting.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";
import { resolveInspect } from "../render/inspect.js";
import { styleTokenToCss } from "../render/styles.js";
import type { EnvironmentProvider } from "./environment.js";
import {
  createRuntimeMeta,
  detectRuntimeInfo,
  formatErrorMessage,
  formatStackFrames,
  getPrettyLogMethod,
  isNativeError,
  parseBrowserStackLine,
  parseServerStackLine,
  type RuntimeInfo,
  type RuntimeMetaStatic,
  stringifyFallback,
  stripAnsi,
} from "./shared.js";
import { buildStackTrace, clampIndex, findFirstExternalFrameIndex, getDefaultIgnorePatterns } from "./stackTrace.js";

type RuntimeMeta = IMeta & {
  runtimeVersion?: string;
  hostname?: string;
  browser?: string;
};

/**
 * Browser {@link EnvironmentProvider}.
 *
 * Mirrors the Node provider but with the browser-specific pieces the monolith's
 * `createLoggerEnvironment()` selected when running in a DOM or web-worker scope:
 *  - stack lines are parsed with {@link parseBrowserStackLine} (Hermes/Safari/Chrome format);
 *  - the inspect implementation comes from {@link resolveInspect} (native `util.formatWithOptions`
 *    where a runtime exposes it, otherwise the bundled polyfill — never a static `node:util` import);
 *  - `transportFormatted` implements the CSS `%c` styling path (`buildCssMetaOutput` /
 *    `collectStyleTokens` / `tokensToCss` over {@link styleTokenToCss}) when the console supports it.
 *
 * Created lazily by the browser entry's Logger constructor — NEVER at module top level — so
 * `sideEffects: false` keeps holding.
 */
export function createBrowserEnvironment(): EnvironmentProvider {
  const runtimeInfo: RuntimeInfo = detectRuntimeInfo();
  const meta: RuntimeMetaStatic = createRuntimeMeta(runtimeInfo);
  const usesBrowserStack = runtimeInfo.name === "browser" || runtimeInfo.name === "worker";
  const callerIgnorePatterns = usesBrowserStack
    ? [...getDefaultIgnorePatterns(), /node_modules[\\/].*tslog/i]
    : [...getDefaultIgnorePatterns(), /node:(?:internal|vm)/i, /\binternal[\\/]/i];

  let cachedCwd: string | null | undefined;
  let formatWithOptions: ((options: InspectOptions, ...args: unknown[]) => string) | undefined;

  const environment: EnvironmentProvider = {
    getMeta(
      logLevelId: number,
      logLevelName: string,
      callerFrame: number,
      hideLogPosition: boolean,
      name?: string,
      parentNames?: string[],
      internalFramePatterns?: RegExp[],
    ): IMeta {
      const built = Object.assign({}, meta, {
        date: new Date(),
        logLevelId,
        logLevelName,
      }) as RuntimeMeta;
      // Omit `path` entirely when capture is off (mirrors the node provider): an ever-present
      // `path: undefined` key serialized as the junk string "[undefined]" on every record.
      if (!hideLogPosition) {
        built.path = environment.getCallerStackFrame(callerFrame, new Error(), internalFramePatterns);
      }
      // Omit name/parentNames when unset so they don't serialize as `"[undefined]"` (matches the node provider).
      if (name !== undefined) {
        built.name = name;
      }
      if (parentNames !== undefined) {
        built.parentNames = parentNames;
      }
      return built;
    },
    getCallerStackFrame(callerFrame: number, error: Error = new Error(), internalFramePatterns?: RegExp[]): IStackFrame {
      const frames = buildStackTrace(error, (line) => parseStackLine(line));
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
        const causeMessage = safeErrorString(cause, "message", "");
        const header = `Caused by (${index + 1}): ${safeErrorString(cause, "name", "Error")}${causeMessage ? `: ${causeMessage}` : ""}`;
        const frames = formatStackFrames(
          buildStackTrace(cause, (line) => parseStackLine(line)),
          settings,
        );
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
      const { args: logArgs, errors: logErrors } = environment.prettyFormatLogObj(maskedArgs, settings);
      const logMetaMarkup = buildPrettyMeta(settings, meta).text;
      const logErrorsStr = (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") + logErrors.join("\n");
      const metaMarkupForText = prettyLogs ? logMetaMarkup : stripAnsi(logMetaMarkup);

      settings.pretty.inspectOptions.colors = prettyLogs;
      const formattedArgs = formatWithOptionsSafe(settings.pretty.inspectOptions, logArgs);
      return metaMarkupForText + formattedArgs + logErrorsStr;
    },
    transportFormatted<LogObj>(logMetaMarkup: string, logArgs: unknown[], logErrors: string[], logMeta: IMeta | undefined, settings: ISettings<LogObj>): void {
      const prettyLogs = settings.pretty.style !== false;
      const logErrorsStr = (logErrors.length > 0 && logArgs.length > 0 ? "\n" : "") + logErrors.join("\n");
      const sanitizedMetaMarkup = stripAnsi(logMetaMarkup);
      const metaMarkupForText = prettyLogs ? logMetaMarkup : sanitizedMetaMarkup;
      const log = getPrettyLogMethod(logMeta?.logLevelName, settings.pretty.levelMethod);

      if (shouldUseCss(prettyLogs)) {
        settings.pretty.inspectOptions.colors = false;
        const formattedArgs = formatWithOptionsSafe(settings.pretty.inspectOptions, logArgs);
        const cssMeta = logMeta != null ? buildCssMetaOutput(settings, logMeta) : { text: sanitizedMetaMarkup, styles: [] };
        const hasCssMeta = cssMeta.text.length > 0 && cssMeta.styles.length > 0;
        const metaOutput = hasCssMeta ? cssMeta.text : sanitizedMetaMarkup;
        const output = metaOutput + formattedArgs + logErrorsStr;

        if (hasCssMeta) {
          log(output, ...cssMeta.styles);
        } else {
          log(output);
        }
        return;
      }

      settings.pretty.inspectOptions.colors = prettyLogs;
      const formattedArgs = formatWithOptionsSafe(settings.pretty.inspectOptions, logArgs);
      log(metaMarkupForText + formattedArgs + logErrorsStr);
    },
    transportJSON<LogObj>(json: LogObj & ILogObjMeta): void {
      nativeConsoleMethod("log")(jsonStringifyRecursive(json));
    },
  };

  return environment;

  function parseStackLine(line?: string): IStackFrame | undefined {
    return usesBrowserStack ? parseBrowserStackLine(line) : parseServerStackLine(line, getWorkingDirectory);
  }

  function shouldUseCss(prettyLogs: boolean): boolean {
    return prettyLogs && (runtimeInfo.name === "browser" || runtimeInfo.name === "worker") && consoleSupportsCssStyling();
  }

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

  function getWorkingDirectory(): string | undefined {
    if (cachedCwd === undefined) {
      cachedCwd = safeGetCwd() ?? null;
    }
    return cachedCwd ?? undefined;
  }

  function formatWithOptionsSafe(options: InspectOptions, args: unknown[]): string {
    if (formatWithOptions == null) {
      formatWithOptions = resolveInspect();
    }
    try {
      return formatWithOptions(options, ...args);
    } catch {
      return args.map(stringifyFallback).join(" ");
    }
  }
}
