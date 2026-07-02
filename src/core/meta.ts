import type { RuntimeMetaStatic } from "../env/shared.js";
import type { IMeta, IStackFrame } from "../interfaces.js";

/**
 * `core/meta.ts` — the single source of truth for assembling the per-log {@link IMeta} block and for
 * the lazy `_meta.path` getter (M1.2).
 *
 * The v4 monolith built meta inside `createLoggerEnvironment().getMeta` and eagerly parsed the caller
 * stack frame on every log (`getCallerStackFrame(..., new Error(), ...)`). That cost the frame parse
 * even when nothing ever read `_meta.path`. v5 centralizes meta assembly here and makes `path` a lazy,
 * self-caching getter so the (relatively expensive) frame parsing only happens on first read.
 *
 * Every per-runtime provider (`environment.node.ts`, `environment.browser.ts`, `environment.universal.ts`)
 * delegates its `getMeta` to {@link buildMeta} so all runtimes share identical lazy semantics — the
 * only thing that varies per runtime is HOW a captured `Error` is turned into a caller frame (the
 * stack-line parser and ignore patterns), which the provider supplies via {@link MetaDeps}.
 */

/**
 * Runtime-specific dependency the meta builder needs: resolve the caller's stack frame from a captured
 * `Error`. This mirrors the monolith's `getCallerStackFrame` closure — it owns the runtime's stack-line
 * parser (server vs. browser), cwd handling, and the auto-detect ignore patterns. Keeping it as an
 * injected callback lets `core/meta.ts` stay free of any environment import so the lazy semantics live
 * in exactly one place across Node, browsers, Deno, and Bun.
 */
export interface MetaDeps {
  /**
   * Resolve the caller's stack frame from `error`, honoring a manual `callerFrame` index (>= 0, finite)
   * or auto-detecting the first external frame, with optional extra `internalFramePatterns` to skip.
   * Mirrors `EnvironmentProvider.getCallerStackFrame` / the monolith's `getCallerStackFrame`.
   */
  resolveCallerStackFrame: (error: Error, callerFrame: number, internalFramePatterns?: RegExp[]) => IStackFrame;
}

/**
 * Install a lazy, self-caching `path` getter on `meta` (M1.2).
 *
 * The getter parses `error`'s frames on first read (via `resolveCallerStackFrame`) and then replaces
 * itself with the resolved value so subsequent reads are free (memoized). The property stays
 * `enumerable` and `configurable` so `JSON.stringify` and object spreads still observe `path`, exactly
 * like the eager value the monolith produced.
 *
 * This is the single implementation the providers call so all runtimes share lazy semantics.
 */
export function defineLazyPath(meta: IMeta, error: Error, callerFrame: number, internalFramePatterns: RegExp[] | undefined, deps: MetaDeps): void {
  Object.defineProperty(meta, "path", {
    configurable: true,
    enumerable: true,
    get(): IStackFrame {
      const resolved = deps.resolveCallerStackFrame(error, callerFrame, internalFramePatterns);
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

/**
 * Build the per-log {@link IMeta} block: the logger's static runtime fields (runtime, version,
 * hostname/browser) plus the per-log dynamic fields (name, parentNames, date, level), and — when stack
 * capture is on — a lazy `path` getter.
 *
 * Field order matches the monolith's `Object.assign({}, staticMeta, { name, parentNames, date,
 * logLevelId, logLevelName })` with `path` appended last, so spreads and `JSON.stringify` produce the
 * same key ordering. When `hideLogPosition` is true, capture is off and `path` is left undefined (no
 * getter, no own key) — identical to the monolith leaving `path: undefined`.
 *
 * @param staticMeta - the logger's static runtime meta (built once per provider via `createRuntimeMeta`).
 * @param callerFrame - manual stack-frame index, or `NaN` to auto-detect the first external frame.
 * @param hideLogPosition - when true, skip stack capture entirely so `path` stays undefined.
 * @param internalFramePatterns - extra RegExp patterns (e.g. from a wrapper logger) to treat as
 *   internal during auto-detection so the reported position lands on the wrapper's caller.
 */
export function buildMeta(
  staticMeta: RuntimeMetaStatic,
  logLevelId: number,
  logLevelName: string,
  callerFrame: number,
  hideLogPosition: boolean,
  name: string | undefined,
  parentNames: string[] | undefined,
  internalFramePatterns: RegExp[] | undefined,
  deps: MetaDeps,
): IMeta {
  // Only attach `name`/`parentNames` when actually set. Emitting them when undefined produced the ugly
  // `"name":"[undefined]"` / `"parentNames":"[undefined]"` in JSON output and cost extra serialize time;
  // an unnamed root logger now omits them entirely (named sub-loggers still carry both).
  const meta = Object.assign({}, staticMeta, {
    date: new Date(),
    logLevelId,
    logLevelName,
  }) as IMeta;
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
  defineLazyPath(meta, new Error(), callerFrame, internalFramePatterns, deps);
  return meta;
}
