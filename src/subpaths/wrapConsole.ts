/**
 * Global `console.*` redirection for tslog (`tslog/console`, M3.10).
 *
 * `wrapConsole(logger)` replaces the global `console.log/info/warn/error/debug` methods so every call
 * is routed through a tslog {@link ConsoleLikeLogger} (any `Logger` instance qualifies). This is handy
 * when adopting tslog incrementally, or when third-party code logs through the bare `console` and you
 * want that output masked, structured, and shipped to your tslog transports like everything else.
 *
 * Mapping (console method → tslog level):
 *   - `console.log`   → `info`
 *   - `console.info`  → `info`
 *   - `console.debug` → `debug`
 *   - `console.warn`  → `warn`
 *   - `console.error` → `error`
 *
 * `restoreConsole()` puts the original methods back. Both functions are idempotent: wrapping an
 * already-wrapped console re-points it at the new logger without losing the original references, and
 * restoring an un-wrapped console is a no-op. No import-time side effects — nothing happens until you
 * call `wrapConsole`.
 *
 * @example
 * import { Logger } from "tslog";
 * import { wrapConsole, restoreConsole } from "tslog/console";
 *
 * const logger = new Logger({ type: "json" });
 * wrapConsole(logger);
 * console.log("hello");   // → logger.info("hello")
 * console.error("boom");  // → logger.error("boom")
 * restoreConsole();       // back to the native console
 */

import { NATIVE_CONSOLE_KEY } from "../internal/nativeConsole.js";

/** The console methods that `wrapConsole` intercepts. */
export type WrappedConsoleMethod = "log" | "info" | "debug" | "warn" | "error";

/**
 * The structural slice of a tslog `Logger` that `wrapConsole` needs: the level methods it forwards to.
 * Any `Logger<LogObj>` (from `tslog`, `tslog/node`, etc.) satisfies this — there is no need to import
 * the concrete class, which keeps this subpath free of the runtime entry points and tree-shakeable.
 */
export interface ConsoleLikeLogger {
  debug(...args: unknown[]): unknown;
  info(...args: unknown[]): unknown;
  warn(...args: unknown[]): unknown;
  error(...args: unknown[]): unknown;
}

/** Maps each intercepted `console` method to the tslog logger method it forwards to. */
const CONSOLE_TO_LEVEL: Readonly<Record<WrappedConsoleMethod, keyof ConsoleLikeLogger>> = Object.freeze({
  log: "info",
  info: "info",
  debug: "debug",
  warn: "warn",
  error: "error",
});

const WRAPPED_METHODS: readonly WrappedConsoleMethod[] = ["log", "info", "debug", "warn", "error"];

/** The saved native methods, captured the first time `wrapConsole` runs; `undefined` while unwrapped. */
let originalMethods: Partial<Record<WrappedConsoleMethod, (...args: unknown[]) => void>> | undefined;

/**
 * Re-entrancy latch. The logger's own sinks resolve `console.log` at log time — which, once wrapped,
 * is the forwarder itself: `console.log` → `logger.info` → `console.log` → … unbounded recursion.
 * While a forwarded call is being handled, any nested `console.*` call is routed straight to the saved
 * native method, so the logger's own output still reaches the terminal instead of recursing.
 */
let forwarding = false;

/**
 * Redirect the global `console.log/info/debug/warn/error` through the given tslog `logger`.
 *
 * Safe to call repeatedly: the original (native) methods are captured only on the first wrap, so calling
 * `wrapConsole` again simply re-targets the console at the new `logger` and a later `restoreConsole`
 * still restores the genuine originals. The bound `console` receiver is preserved for each forwarder.
 *
 * @param logger - The tslog logger (or any {@link ConsoleLikeLogger}) to receive console output.
 * @returns A `restore` function that reverts this wrap — equivalent to calling {@link restoreConsole}.
 */
export function wrapConsole(logger: ConsoleLikeLogger): () => void {
  if (originalMethods == null) {
    originalMethods = {};
    for (const method of WRAPPED_METHODS) {
      // Capture the genuine method reference (unbound) so `restoreConsole` puts back the exact original
      // function object — assigning it straight onto `console` restores native `this` binding too.
      originalMethods[method] = console[method] as (...args: unknown[]) => void;
    }
    // Publish the originals under the well-known key so the logger's OWN sinks (json/pretty console
    // writes, transport-error reports, dev warnings) bypass the wrapper instead of re-ingesting their
    // own output — including asynchronous reports the `forwarding` latch cannot cover.
    (console as unknown as Record<symbol, unknown>)[NATIVE_CONSOLE_KEY] = originalMethods;
  }

  for (const method of WRAPPED_METHODS) {
    const level = CONSOLE_TO_LEVEL[method];
    (console as Record<WrappedConsoleMethod, (...args: unknown[]) => void>)[method] = (...args: unknown[]): void => {
      if (forwarding) {
        originalMethods?.[method]?.apply(console, args);
        return;
      }
      forwarding = true;
      try {
        logger[level](...args);
      } finally {
        forwarding = false;
      }
    };
  }

  return restoreConsole;
}

/**
 * Restore the native `console.log/info/debug/warn/error` methods captured by {@link wrapConsole}.
 *
 * A no-op when the console was never wrapped (or was already restored). After restoring, the captured
 * originals are released so a subsequent `wrapConsole` captures fresh references.
 */
export function restoreConsole(): void {
  if (originalMethods == null) {
    return;
  }

  for (const method of WRAPPED_METHODS) {
    const original = originalMethods[method];
    if (original != null) {
      (console as Record<WrappedConsoleMethod, (...args: unknown[]) => void>)[method] = original;
    }
  }

  originalMethods = undefined;
  forwarding = false;
  delete (console as unknown as Record<symbol, unknown>)[NATIVE_CONSOLE_KEY];
}

/** Whether the global console is currently routed through a tslog logger via {@link wrapConsole}. */
export function isConsoleWrapped(): boolean {
  return originalMethods != null;
}
