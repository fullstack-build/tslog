import { type AsyncContextStore, createAsyncContextStore } from "../core/asyncContext.js";
import type { IMeta } from "../interfaces.js";
import { resolveInspect } from "../render/inspect.js";
import type { EnvironmentProvider } from "./environment.js";
import { createProviderBase } from "./providerBase.js";
import { detectRuntimeInfo, type RuntimeInfo } from "./shared.js";

/**
 * The universal {@link EnvironmentProvider} — the provider injected by the universal entry
 * (`index.universal.ts`) for every runtime that is NOT specifically targeted by the Node or browser
 * entries: Deno, Bun, edge runtimes (e.g. Cloudflare Workers) and anything detected as "unknown".
 *
 * Behavior is preserved byte-for-byte from the v4 monolith's `createLoggerEnvironment()`:
 *  - runtime is detected with {@link detectRuntimeInfo} (browser/worker -> browser stack parsing,
 *    everything else -> server/V8 stack parsing) — the `"adaptive"` flavor of `./providerBase.js`;
 *  - inspect output uses the runtime's native `util.formatWithOptions` when available (Deno/Bun expose
 *    `node:util` through their compatibility layer) and falls back to the bundled polyfill otherwise
 *    (resolved via {@link resolveInspect}), so this module never statically imports `node:util`;
 *  - CSS `%c` console styling is applied only on browser/worker runtimes whose console supports it.
 *
 * The provider is created lazily by {@link createUniversalEnvironment}; nothing here runs at module
 * top level so `sideEffects: false` continues to hold.
 */
export function createUniversalEnvironment(): EnvironmentProvider {
  const runtimeInfo: RuntimeInfo = detectRuntimeInfo();
  // Resolved ONCE at construction (never at module load); per-log calls do not re-probe.
  const formatWithOptions = resolveInspect();

  const base = createProviderBase({
    runtimeInfo,
    flavor: "adaptive",
    getFormatWithOptions: () => formatWithOptions,
  });

  return {
    ...base.methods,
    getMeta(
      logLevelId: number,
      logLevelName: string,
      callerFrame: number,
      hideLogPosition: boolean,
      name?: string,
      parentNames?: string[],
      internalFramePatterns?: RegExp[],
    ): IMeta {
      // The position Error is captured HERE — in the provider method, exactly where the pre-extraction
      // code captured it — so the frame depth a manual `callerFrame` index sees is unchanged.
      return base.buildEagerMeta(logLevelId, logLevelName, callerFrame, hideLogPosition ? undefined : new Error(), name, parentNames, internalFramePatterns);
    },
    createAsyncContextStore(): AsyncContextStore {
      // Runtime-agnostic: resolve AsyncLocalStorage through the side-effect-free global/builtin probe
      // (works on Node/Deno/Bun), degrading to a no-op store on browsers/edge runtimes that lack it.
      return createAsyncContextStore();
    },
  };
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
