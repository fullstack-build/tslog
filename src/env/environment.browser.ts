import type { IMeta } from "../interfaces.js";
import { type FormatWithOptions, resolveInspect } from "../render/inspect.js";
import type { EnvironmentProvider } from "./environment.js";
import { createProviderBase } from "./providerBase.js";
import { detectRuntimeInfo, type RuntimeInfo } from "./shared.js";

/**
 * Browser {@link EnvironmentProvider}.
 *
 * The `"adaptive"` flavor of `./providerBase.js` with the browser-specific pieces the monolith's
 * `createLoggerEnvironment()` selected when running in a DOM or web-worker scope:
 *  - stack lines are parsed with the browser parser (Hermes/Safari/Chrome format) on browser/worker
 *    runtimes, with the React Native hybrid and server parsers still handled when a bundler forces the
 *    browser condition onto another target;
 *  - the inspect implementation comes from {@link resolveInspect} (native `util.formatWithOptions`
 *    where a runtime exposes it, otherwise the bundled polyfill — never a static `node:util` import),
 *    resolved LAZILY on the first pretty format call rather than at construction;
 *  - `transportFormatted` takes the CSS `%c` styling path when the console supports it.
 *
 * Created lazily by the browser entry's Logger constructor — NEVER at module top level — so
 * `sideEffects: false` keeps holding.
 */
export function createBrowserEnvironment(): EnvironmentProvider {
  const runtimeInfo: RuntimeInfo = detectRuntimeInfo();
  // Lazily memoized: the polyfill (or native util where the runtime exposes one) is resolved on the
  // FIRST pretty format call, not at construction.
  let formatWithOptions: FormatWithOptions | undefined;

  const base = createProviderBase({
    runtimeInfo,
    flavor: "adaptive",
    getFormatWithOptions(): FormatWithOptions {
      if (formatWithOptions == null) {
        formatWithOptions = resolveInspect();
      }
      return formatWithOptions;
    },
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
  };
}
