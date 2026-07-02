import type { AsyncContextStore } from "../core/asyncContext.js";
import type { ILogObjMeta, IMeta, ISettings, IStackFrame } from "../interfaces.js";

/**
 * The environment seam (BC11) — the contract every per-runtime provider implements.
 *
 * The v4 monolith created a single `LoggerEnvironment` via `createLoggerEnvironment()` and stored it
 * in a module-level singleton. v5 DELETES that singleton: `BaseLogger` receives an
 * `EnvironmentProvider` through its constructor and stores it as `this.runtime`. Each entry injects
 * its own provider:
 *  - `index.node.ts`      -> `createNodeEnvironment()`      (native `node:util` inspect)
 *  - `index.browser.ts`   -> `createBrowserEnvironment()`   (inspect polyfill, CSS `%c` styling)
 *  - `index.universal.ts` -> `createUniversalEnvironment()` (native inspect if present, else polyfill)
 *
 * Providers MUST be created lazily by factory functions (inside the entry's Logger constructor or a
 * memoized accessor) — NEVER at module top level — so `sideEffects: false` continues to hold and the
 * tree-shaking audit passes.
 *
 * The runtime-AGNOSTIC pieces every provider reuses (stack-line parsers, path normalization, error/
 * stack formatting, ANSI stripping, the console-method picker, and runtime detection) live in
 * `./shared.js`. The runtime-SPECIFIC pieces (`transportFormatted`/`transportJSON` console targets,
 * `prettyFormatLogObj`/`prettyFormatErrorObj`, inspect source and CSS styling) live in the providers.
 */
export interface EnvironmentProvider {
  /**
   * Build the per-log {@link IMeta} block (static runtime fields + date/level + optional code position).
   *
   * @param callerFrame - manual stack-frame index, or `NaN` to auto-detect the first external frame.
   * @param hideLogPosition - when true, skip stack capture entirely so `path` is left undefined.
   * @param internalFramePatterns - extra RegExp patterns (e.g. from a wrapper logger) to treat as
   *   internal during auto-detection so the reported position lands on the wrapper's caller.
   */
  getMeta(
    logLevelId: number,
    logLevelName: string,
    callerFrame: number,
    hideLogPosition: boolean,
    name?: string,
    parentNames?: string[],
    internalFramePatterns?: RegExp[],
  ): IMeta;
  /**
   * Resolve the calling code's stack frame from `error` (a freshly captured `Error` by default),
   * honoring a manual `callerFrame` index or auto-detecting the first external frame.
   */
  getCallerStackFrame(callerFrame: number, error?: Error, internalFramePatterns?: RegExp[]): IStackFrame;
  /** Parse an error's full stack trace into structured frames. */
  getErrorTrace(error: Error): IStackFrame[];
  /** Best-effort `Error` detection (also matches cross-realm and error-like objects). */
  isError(value: unknown): value is Error;
  /** Whether the value is a Node.js `Buffer` (always false on runtimes without `Buffer`). */
  isBuffer(value: unknown): boolean;
  /** Split masked args into plain args and pre-formatted error strings for pretty output. */
  prettyFormatLogObj<LogObj>(maskedArgs: unknown[], settings: ISettings<LogObj>): { args: unknown[]; errors: string[] };
  /** Render a single error (name, message, stack, cause chain) through the pretty error template. */
  prettyFormatErrorObj<LogObj>(error: Error, settings: ISettings<LogObj>): string;
  /**
   * Build the plain-text pretty log line (meta markup + inspected args + rendered errors) as a string,
   * WITHOUT writing it anywhere. This is the runtime-agnostic "prettyFormat path" the format pipeline's
   * `pretty()` stage delegates to so attached transports and per-transport `format: "pretty"` get a
   * pretty line. ANSI styling follows `settings.pretty.style`; browser CSS `%c` styling is NOT applied
   * here (that is exclusive to the live console via {@link transportFormatted}).
   *
   * @param maskedArgs - the masked log arguments (errors are split out and rendered into the line).
   * @param meta - the record's {@link IMeta} block (drives the meta markup and the log-level method).
   */
  prettyFormatLine<LogObj>(maskedArgs: unknown[], meta: IMeta | undefined, settings: ISettings<LogObj>): string;
  /** Print a formatted (pretty) log line to the runtime's console, applying CSS styling where supported. */
  transportFormatted<LogObj>(logMetaMarkup: string, logArgs: unknown[], logErrors: string[], logMeta: IMeta | undefined, settings: ISettings<LogObj>): void;
  /** Print a JSON log object as a single line to the runtime's console. */
  transportJSON<LogObj>(json: LogObj & ILogObjMeta): void;
  /**
   * Build the {@link AsyncContextStore} backing `logger.runInContext` (M2.13) for this runtime.
   *
   * Optional: a provider that omits it (or returns a no-op store) means ALS context is unavailable on that
   * runtime and `runInContext` degrades gracefully (runs the function, propagates nothing). Server providers
   * resolve `AsyncLocalStorage` lazily — and only when first asked — so importing the provider never pulls
   * in `node:async_hooks` and `sideEffects:false` keeps holding.
   */
  createAsyncContextStore?(): AsyncContextStore;
}

/**
 * Factory signature implemented by each per-runtime provider module
 * (`createNodeEnvironment`, `createBrowserEnvironment`, `createUniversalEnvironment`).
 */
export type EnvironmentProviderFactory = () => EnvironmentProvider;

/**
 * `selectEnvironment()` — implemented by the universal entry, NOT here.
 *
 * The real per-runtime providers live in separate modules (`environment.node.ts`,
 * `environment.browser.ts`, `environment.universal.ts`). The universal entry owns the runtime probe
 * that picks one of them at construction time; defining it here would force this module to statically
 * import all three providers (pulling `node:util` and the inspect polyfill into every bundle and
 * breaking `sideEffects: false`). The node and browser entries skip selection entirely and inject
 * their provider directly.
 *
 * This declaration documents the seam's shape for the integrator; the universal entry provides the
 * implementation. Intentionally not exported as a value to avoid a top-level provider import here.
 */
export type SelectEnvironment = () => EnvironmentProvider;
