/**
 * Native-console resolution shared between the core and the `tslog/console` subpath.
 *
 * `wrapConsole(logger)` replaces the global `console.*` methods with forwarders into a logger. The
 * logger's OWN output sinks (the json/pretty console writes, transport-error reports, dev warnings)
 * resolve `console.log`/`console.error`/`console.warn` at call time — which, once wrapped, would be
 * the forwarder itself: the logger's output gets re-ingested as a brand-new log (double transport
 * delivery, nested records) and asynchronous reports (a rejected transport promise handled in a
 * microtask) can even livelock in a forward→log→report→forward loop that no synchronous latch covers.
 *
 * The seam: `wrapConsole` publishes the saved native methods on the `console` object under the
 * well-known registry symbol {@link NATIVE_CONSOLE_KEY}. Every internal sink resolves its console
 * method through {@link nativeConsoleMethod}, which prefers the published originals and falls back to
 * the live `console` method when the console is not wrapped. `Symbol.for` keeps the two sides
 * decoupled — the core never imports the subpath, and the subpath never imports the core.
 */

/** Well-known registry key under which `tslog/console` publishes the saved native console methods. */
export const NATIVE_CONSOLE_KEY: symbol = Symbol.for("tslog.console.originals");

/** The console methods the wrapper intercepts and the internal sinks resolve. */
export type NativeConsoleMethodName = "log" | "info" | "debug" | "warn" | "error";

type PublishedOriginals = Partial<Record<NativeConsoleMethodName, (...args: unknown[]) => void>>;

/**
 * Resolve the native `console[method]`, bypassing a `tslog/console` wrapper when one is installed.
 * Falls back to the live console method (the normal, unwrapped case). Never throws.
 */
export function nativeConsoleMethod(method: NativeConsoleMethodName): (...args: unknown[]) => void {
  try {
    const published = (console as unknown as Record<symbol, PublishedOriginals | undefined>)[NATIVE_CONSOLE_KEY];
    const original = published?.[method];
    if (typeof original === "function") {
      return original;
    }
  } catch {
    // a hostile console shim — fall through to the live method
  }
  return console[method] as (...args: unknown[]) => void;
}
