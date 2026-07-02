import { createRequire } from "node:module";
import { formatWithOptions } from "node:util";
import { type AsyncContextStore, createAsyncContextStore } from "../core/asyncContext.js";
import { formatTemplate } from "../formatTemplate.js";
import type { ILogObjMeta, IMeta, ISettings, IStackFrame } from "../interfaces.js";
import { consoleSupportsCssStyling, safeGetCwd } from "../internal/environment.js";
import { collectErrorCauses, safeErrorString } from "../internal/errorUtils.js";
import type { InspectOptions } from "../internal/InspectOptions.interface.js";
import { jsonStringifyRecursive } from "../internal/jsonStringifyRecursive.js";
import { buildPrettyMeta } from "../internal/metaFormatting.js";
import { nativeConsoleMethod } from "../internal/nativeConsole.js";
import type { EnvironmentProvider } from "./environment.js";
import {
  createRuntimeMeta,
  detectRuntimeInfo,
  formatErrorMessage,
  formatStackFrames,
  getPrettyLogMethod,
  isNativeError,
  parseServerStackLine,
  type RuntimeInfo,
  type RuntimeMetaStatic,
  stripAnsi,
} from "./shared.js";
import { buildStackTrace, clampIndex, findFirstExternalFrameIndex, getDefaultIgnorePatterns } from "./stackTrace.js";

/**
 * Node.js {@link EnvironmentProvider}.
 *
 * Mirrors the server-side half of the v4 `createLoggerEnvironment()` singleton, but as a per-entry
 * factory (BC11 — no module-level singleton). The node entry (`index.node.ts`) injects the provider
 * returned here into `BaseLogger` via the constructor.
 *
 * Inspect strategy (M0.5/2.2): this provider imports `formatWithOptions` DIRECTLY from `node:util`
 * (native, higher fidelity than the bundled polyfill). The universal/browser providers use the
 * polyfill/`resolveInspect()` instead; core never statically imports `node:util`.
 *
 * Lazy stack capture (M1.2): when stack capture is on, `getMeta` does NOT eagerly parse frames. It
 * captures the `Error` cheaply and installs an enumerable, self-caching getter on `_meta.path` that
 * parses the frames on first read. NOTE FOR THE INTEGRATOR: `core/meta.ts` did not exist when this
 * provider was written, so the lazy getter is inlined below (see `defineLazyPath`). If/when
 * `core/meta.ts` lands with a shared `defineLazyPath`/`buildMeta`, replace the inline helper here with
 * an import from `../core/meta.js` so the lazy semantics live in one place.
 */
export function createNodeEnvironment(): EnvironmentProvider {
  const runtimeInfo: RuntimeInfo = detectRuntimeInfo();
  const staticMeta: RuntimeMetaStatic = createRuntimeMeta(runtimeInfo);
  // Node frames are always server-style; reuse the shared parser. Auto-detect ignores tslog's own
  // frames plus node:internal/vm and the generic `internal/` directory (preserved from the monolith).
  const callerIgnorePatterns: RegExp[] = [...getDefaultIgnorePatterns(), /node:(?:internal|vm)/i, /\binternal[\\/]/i];

  let cachedCwd: string | null | undefined;

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
      const meta = Object.assign({}, staticMeta, {
        date: new Date(),
        logLevelId,
        logLevelName,
      }) as IMeta;
      // Only attach `name`/`parentNames` when actually set, so an unnamed root logger omits them entirely
      // instead of emitting the ugly `"name":"[undefined]"` / `"parentNames":"[undefined]"` (and paying the
      // extra serialize cost). Named sub-loggers still carry both.
      if (name !== undefined) {
        meta.name = name;
      }
      if (parentNames !== undefined) {
        meta.parentNames = parentNames;
      }

      if (hideLogPosition) {
        // Capture is off: leave `path` undefined (no getter), exactly like the monolith.
        return meta;
      }

      // Capture is on. Grab the Error cheaply now (the stack string is captured here), but defer the
      // (relatively expensive) frame parsing to the first read of `_meta.path`.
      defineLazyPath(meta, new Error(), callerFrame, internalFramePatterns);
      return meta;
    },
    getCallerStackFrame(callerFrame: number, error: Error = new Error(), internalFramePatterns?: RegExp[]): IStackFrame {
      return resolveCallerStackFrame(error, callerFrame, internalFramePatterns);
    },
    getErrorTrace(error: Error): IStackFrame[] {
      return buildStackTrace(error, parseLine);
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
          if (isNativeError(arg)) {
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
        const frames = formatStackFrames(buildStackTrace(cause, parseLine), settings);
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

      // CSS `%c` styling only applies to browser/worker consoles. On Node this guard is always false,
      // so the text path below runs. Kept for parity with the monolith's branching.
      const useCss = prettyLogs && (runtimeInfo.name === "browser" || runtimeInfo.name === "worker") && consoleSupportsCssStyling();
      /* v8 ignore next 4 -- defensive: the Node provider only ever runs under Node, where useCss is false */
      if (useCss) {
        settings.pretty.inspectOptions.colors = false;
        log(sanitizedMetaMarkup + formatWithOptionsSafe(settings.pretty.inspectOptions, logArgs) + logErrorsStr);
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
      // Node-only provider: AsyncLocalStorage is always available. Resolve it lazily (on first use) via
      // a synchronous `createRequire` so this module never statically imports `node:async_hooks` and
      // `sideEffects:false` keeps holding. Fall back to the global/builtin probe if the require fails.
      try {
        const require = createRequire(import.meta.url);
        const { AsyncLocalStorage } = require("node:async_hooks") as {
          AsyncLocalStorage: new <T>() => { run<R>(s: T, f: () => R): R; getStore(): T | undefined };
        };
        return createAsyncContextStore(AsyncLocalStorage);
        /* v8 ignore next 3 -- defensive: node:async_hooks is always resolvable on Node; the probe fallback covers exotic loaders */
      } catch {
        return createAsyncContextStore();
      }
    },
  };

  return environment;

  /** Parse a single Node stack line (server-style) using the provider-owned cwd cache. */
  function parseLine(line?: string): IStackFrame | undefined {
    return parseServerStackLine(line, getWorkingDirectory);
  }

  /** Resolve the caller's stack frame from a captured error, honoring manual index / auto-detection. */
  function resolveCallerStackFrame(error: Error, callerFrame: number, internalFramePatterns?: RegExp[]): IStackFrame {
    const frames = buildStackTrace(error, parseLine);
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

  /**
   * Install a lazy, self-caching `path` getter on `meta` (M1.2). The getter parses `error`'s frames on
   * first read and then replaces itself with the resolved value so subsequent reads are free. The
   * property stays enumerable so `JSON.stringify` and object spreads still observe `path`.
   */
  function defineLazyPath(meta: IMeta, error: Error, callerFrame: number, internalFramePatterns?: RegExp[]): void {
    Object.defineProperty(meta, "path", {
      configurable: true,
      enumerable: true,
      get(): IStackFrame {
        const resolved = resolveCallerStackFrame(error, callerFrame, internalFramePatterns);
        // Cache: swap the getter for the plain value so we only parse once.
        Object.defineProperty(meta, "path", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: resolved,
        });
        return resolved;
      },
    });
  }

  /** Provider-owned cwd cache: resolved once via `safeGetCwd()` and reused for every stack line. */
  function getWorkingDirectory(): string | undefined {
    if (cachedCwd === undefined) {
      cachedCwd = safeGetCwd() ?? null;
    }
    return cachedCwd ?? undefined;
  }

  /** Run native `formatWithOptions`, falling back to a best-effort stringify if it throws. */
  function formatWithOptionsSafe(options: InspectOptions, args: unknown[]): string {
    try {
      return formatWithOptions(options, ...args);
    } catch {
      return args.map(stringifyFallback).join(" ");
    }
  }
}

/** Last-resort value stringifier mirroring the monolith's fallback inside `formatWithOptionsSafe`. */
function stringifyFallback(value: unknown): string {
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
