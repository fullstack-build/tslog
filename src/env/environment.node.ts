import { createRequire } from "node:module";
import { formatWithOptions } from "node:util";
import { type AsyncContextStore, createAsyncContextStore } from "../core/asyncContext.js";
import { buildMeta, type MetaDeps } from "../core/meta.js";
import type { IMeta } from "../interfaces.js";
import type { EnvironmentProvider } from "./environment.js";
import { createProviderBase } from "./providerBase.js";
import { detectRuntimeInfo, type RuntimeInfo } from "./shared.js";
import { createSourceMapResolver } from "./sourceMap.node.js";
import { getStdoutJsonSink } from "./stdoutSink.node.js";

/**
 * Node.js {@link EnvironmentProvider}.
 *
 * Mirrors the server-side half of the v4 `createLoggerEnvironment()` singleton, but as a per-entry
 * factory (BC11 — no module-level singleton). The node entry (`index.node.ts`) injects the provider
 * returned here into `BaseLogger` via the constructor.
 *
 * The shared method set comes from `./providerBase.js` with the `"server"` flavor: Node frames are
 * always parsed server-style and the CSS `%c` console path never applies.
 *
 * Inspect strategy (M0.5/2.2): this provider passes `formatWithOptions` imported DIRECTLY from
 * `node:util` (native, higher fidelity than the bundled polyfill). The universal/browser providers use
 * the polyfill/`resolveInspect()` instead; core never statically imports `node:util`.
 *
 * Source-map resolution (issue #307): `resolveSourceMap` (from `./sourceMap.node.js`) is wired in so
 * server-style frames remap through a source map when one is discoverable, outside production (see
 * {@link createSourceMapResolver}). `undefined` in production — `parseServerStackLine` then skips
 * resolution entirely.
 *
 * Lazy stack capture (M1.2): when stack capture is on, `getMeta` does NOT eagerly parse frames. It
 * captures the `Error` cheaply and installs an enumerable, self-caching getter on `_logMeta.path` that
 * parses the frames on first read. The lazy semantics (and the `hideLogPosition` / name / parentNames
 * assembly) live in the shared `../core/meta.js` `buildMeta`/`defineLazyPath`; this provider just
 * supplies the runtime-specific `resolveCallerStackFrame` via {@link MetaDeps} so the getter and the
 * key ordering are identical across every runtime that opts into lazy paths.
 */
export function createNodeEnvironment(): EnvironmentProvider {
  const runtimeInfo: RuntimeInfo = detectRuntimeInfo();
  const base = createProviderBase({
    runtimeInfo,
    flavor: "server",
    getFormatWithOptions: () => formatWithOptions,
    resolveSourceMap: createSourceMapResolver(),
  });

  // The runtime-specific dependency `core/meta.ts` needs: turn a captured `Error` into a caller frame
  // using this provider's server-style parser and ignore patterns. `buildMeta`'s lazy `path` getter
  // invokes this on first read.
  const metaDeps: MetaDeps = { resolveCallerStackFrame: base.resolveCallerStackFrame };

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
      return buildMeta(base.staticMeta, logLevelId, logLevelName, callerFrame, hideLogPosition, name, parentNames, internalFramePatterns, metaDeps);
    },
    // The default json sink (review 13): batched fd-1 writes instead of per-line console.log. The
    // sink singleton (and its exit hooks) is created on the FIRST json line, so pretty/hidden loggers
    // never touch it and importing this module stays side-effect free.
    writeJsonLine(line: string): void {
      getStdoutJsonSink().write(line);
    },
    flushJsonSink(): Promise<void> {
      return getStdoutJsonSink().flush();
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
}
