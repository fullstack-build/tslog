import type { InspectOptions } from "../internal/InspectOptions.interface.js";
import { formatWithOptions as polyfillFormatWithOptions } from "./inspect.polyfill.js";

/**
 * The shape of `util.formatWithOptions` used by tslog. Kept identical to the polyfill's
 * {@link polyfillFormatWithOptions} so providers can swap implementations transparently.
 */
export type FormatWithOptions = (inspectOptions: InspectOptions, ...args: unknown[]) => string;

/**
 * Resolve the `formatWithOptions` implementation for the universal and browser providers.
 *
 * Prefers the runtime's native `util.formatWithOptions` when it is available — Deno and Bun expose
 * `node:util` through their Node-compatibility layer and produce higher-fidelity output than the
 * bundled polyfill. Browsers (and any runtime without `node:util`) fall back to the polyfill.
 *
 * The native module is resolved through a runtime `require`, with the specifier hidden from static
 * analysis so the browser bundle never tries to bundle `node:util`. The Node provider does NOT use
 * this helper; it imports `node:util` directly.
 */
export function resolveInspect(): FormatWithOptions {
  return tryGetNativeFormatWithOptions() ?? polyfillFormatWithOptions;
}

function tryGetNativeFormatWithOptions(): FormatWithOptions | undefined {
  // Browsers and workers never expose node:util; skip the lookup entirely so bundlers can drop it.
  if (typeof window !== "undefined" || typeof (globalThis as { importScripts?: unknown }).importScripts === "function") {
    return undefined;
  }

  // A synchronous, browser-safe handle on node:util is only reliably reachable through a global `require`
  // (Bun and CommonJS Node both provide one). Runtimes without one fall back to the polyfill.
  const nodeRequire = (globalThis as { require?: (specifier: string) => unknown }).require;
  if (typeof nodeRequire !== "function") {
    return undefined;
  }

  try {
    // Build the specifier dynamically so esbuild/other bundlers do not statically resolve "node:util".
    const utilSpecifier = `node:${"util"}`;
    const util = nodeRequire(utilSpecifier) as { formatWithOptions?: unknown } | undefined;
    if (util != null && typeof util.formatWithOptions === "function") {
      return util.formatWithOptions as FormatWithOptions;
    }
  } catch {
    // Native util is unavailable (e.g. permissions, missing node-compat) — fall back to the polyfill.
  }

  return undefined;
}
