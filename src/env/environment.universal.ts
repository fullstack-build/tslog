import { type AsyncContextStore, createAsyncContextStore } from "../core/asyncContext.js";
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
  parseReactNativeStackLine,
  parseServerStackLine,
  type RuntimeInfo,
  type RuntimeMetaStatic,
  stringifyFallback,
  stripAnsi,
} from "./shared.js";
import { buildStackTrace, clampIndex, findFirstExternalFrameIndex, getDefaultIgnorePatterns } from "./stackTrace.js";

/**
 * The universal {@link EnvironmentProvider} — the provider injected by the universal entry
 * (`index.universal.ts`) for every runtime that is NOT specifically targeted by the Node or browser
 * entries: Deno, Bun, edge runtimes (e.g. Cloudflare Workers) and anything detected as "unknown".
 *
 * Behavior is preserved byte-for-byte from the v4 monolith's `createLoggerEnvironment()`:
 *  - runtime is detected with {@link detectRuntimeInfo} (browser/worker -> browser stack parsing,
 *    everything else -> server/V8 stack parsing);
 *  - inspect output uses the runtime's native `util.formatWithOptions` when available (Deno/Bun expose
 *    `node:util` through their compatibility layer) and falls back to the bundled polyfill otherwise
 *    (resolved via {@link resolveInspect}), so this module never statically imports `node:util`;
 *  - CSS `%c` console styling is applied only on browser/worker runtimes whose console supports it.
 *
 * The provider is created lazily by {@link createUniversalEnvironment}; nothing here runs at module
 * top level so `sideEffects: false` continues to hold.
 */
type RuntimeMeta = IMeta & {
  runtimeVersion?: string;
  hostname?: string;
  browser?: string;
};

/**
 * Build the universal environment provider for the current runtime.
 *
 * Runtime detection happens once, here, at construction time (never at module load). The returned
 * provider closes over the detected runtime so per-log calls do not re-probe the globals.
 */
export function createUniversalEnvironment(): EnvironmentProvider {
  const runtimeInfo: RuntimeInfo = detectRuntimeInfo();
  const meta: RuntimeMetaStatic = createRuntimeMeta(runtimeInfo);
  const usesBrowserStack = runtimeInfo.name === "browser" || runtimeInfo.name === "worker";
  // React Native needs a hybrid parser: Hermes (the default engine) emits V8-style frames
  // ("at fn (address at index.android.bundle:1:1234)"), while JSC emits "fn@main.jsbundle:1:2" —
  // parseReactNativeStackLine tries the server parser first and falls back to the JSC shapes.
  const isReactNative = runtimeInfo.name === "react-native";
  const callerIgnorePatterns =
    usesBrowserStack || isReactNative
      ? [...getDefaultIgnorePatterns(), /node_modules[\\/].*tslog/i]
      : [...getDefaultIgnorePatterns(), /node:(?:internal|vm)/i, /\binternal[\\/]/i];

  const formatWithOptions = resolveInspect();

  let cachedCwd: string | null | undefined;

  function getWorkingDirectory(): string | undefined {
    if (cachedCwd === undefined) {
      cachedCwd = safeGetCwd() ?? null;
    }
    return cachedCwd ?? undefined;
  }

  function parseStackLine(line: string | undefined): IStackFrame | undefined {
    if (isReactNative) {
      return parseReactNativeStackLine(line, getWorkingDirectory);
    }
    return usesBrowserStack ? parseBrowserStackLine(line) : parseServerStackLine(line, getWorkingDirectory);
  }

  function shouldUseCss(prettyLogs: boolean): boolean {
    return prettyLogs && usesBrowserStack && consoleSupportsCssStyling();
  }

  function formatWithOptionsSafe(options: InspectOptions, args: unknown[]): string {
    try {
      return formatWithOptions(options, ...args);
    } catch {
      return args.map(stringifyFallback).join(" ");
    }
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

  const provider: EnvironmentProvider = {
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
        built.path = provider.getCallerStackFrame(callerFrame, new Error(), internalFramePatterns);
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
          if (provider.isError(arg)) {
            result.errors.push(provider.prettyFormatErrorObj(arg as Error, settings));
          } else {
            result.args.push(arg);
          }
          return result;
        },
        { args: [], errors: [] },
      );
    },
    prettyFormatErrorObj<LogObj>(error: Error, settings: ISettings<LogObj>): string {
      const stackLines = formatStackFrames(provider.getErrorTrace(error), settings);
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
      const { args: logArgs, errors: logErrors } = provider.prettyFormatLogObj(maskedArgs, settings);
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
    createAsyncContextStore(): AsyncContextStore {
      // Runtime-agnostic: resolve AsyncLocalStorage through the side-effect-free global/builtin probe
      // (works on Node/Deno/Bun), degrading to a no-op store on browsers/edge runtimes that lack it.
      return createAsyncContextStore();
    },
  };

  return provider;
}

/**
 * Detect the current runtime and return the matching {@link EnvironmentProvider}.
 *
 * Used by the universal entry (`index.universal.ts`) as the default condition. For every runtime the
 * single {@link createUniversalEnvironment} provider is correct: it already adapts internally to the
 * detected runtime (server vs browser stack parsing, native-or-polyfill inspect, and CSS styling only
 * where the console supports it). Routing browser/worker, Node, Deno, Bun, edge and unknown all through
 * the universal provider keeps `selectEnvironment` free of static imports of the Node provider (which
 * would pull `node:util` into every bundle) and the browser provider, preserving `sideEffects: false`.
 */
export function selectEnvironment(): EnvironmentProvider {
  // Probe the globals once. createUniversalEnvironment() re-detects internally and closes over the
  // result; detecting here documents the routing decision and keeps the seam's intent explicit.
  detectRuntimeInfo();
  return createUniversalEnvironment();
}
