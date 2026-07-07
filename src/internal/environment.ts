export function safeGetCwd(): string | undefined {
  try {
    const nodeProcess: { cwd?: () => string } | undefined = (globalThis as unknown as { process?: { cwd?: () => string } })?.process;
    if (typeof nodeProcess?.cwd === "function") {
      return nodeProcess.cwd();
    }
  } catch {
    // ignore permission or access issues
  }

  try {
    const deno: { cwd?: () => string } | undefined = (globalThis as Record<string, unknown>)?.Deno as { cwd?: () => string } | undefined;
    if (typeof deno?.cwd === "function") {
      return deno.cwd();
    }
  } catch {
    // ignore permission or access issues
  }

  return undefined;
}

export function isBrowserEnvironment(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function isWorkerEnvironment(): boolean {
  return typeof (globalThis as { importScripts?: unknown }).importScripts === "function";
}

/**
 * True on React Native (Hermes or JSC). `navigator.product === "ReactNative"` is the documented,
 * stable check; real browsers report the frozen legacy value "Gecko" so it cannot false-positive.
 */
export function isReactNativeEnvironment(): boolean {
  try {
    return (globalThis as { navigator?: { product?: string } }).navigator?.product === "ReactNative";
  } catch {
    return false;
  }
}

/** Read the process-style env bag (Node/Bun/Deno-with-permissions) at call time; never throws. */
function readEnvBag(): Record<string, string | undefined> | undefined {
  try {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })?.process;
    if (proc?.env != null) {
      return proc.env;
    }
  } catch {
    // ignore — env may be unreadable (e.g. Deno without --allow-env)
  }
  return undefined;
}

/**
 * Read ONE env var via a guarded property GET; never throws. On Deno, `process.env` is a permission-
 * checked proxy: obtaining the bag succeeds, but each individual property read throws `NotCapable`
 * without `--allow-env` — so every read (not just the bag lookup) must sit inside a try/catch, or
 * merely importing/constructing a logger crashes a permissionless Deno process.
 */
export function safeEnvGet(key: string): string | undefined {
  try {
    return readEnvBag()?.[key];
  } catch {
    return undefined;
  }
}

/**
 * Whether `NO_COLOR` is set to a non-empty value (https://no-color.org). When true, colorized/styled
 * output should be suppressed even in a pretty/TTY context.
 */
export function noColorRequested(): boolean {
  const value = safeEnvGet("NO_COLOR");
  return value != null && value !== "";
}

/** Whether `FORCE_COLOR` is set to a non-empty, non-"0" value, explicitly opting back into styled output. */
export function forceColorRequested(): boolean {
  const value = safeEnvGet("FORCE_COLOR");
  return value != null && value !== "" && value !== "0";
}

/** Whether the runtime's stdout is an interactive TTY (Node/Bun expose `process.stdout.isTTY`). */
export function stdoutIsTTY(): boolean {
  try {
    const proc = (globalThis as { process?: { stdout?: { isTTY?: boolean } } })?.process;
    return proc?.stdout?.isTTY === true;
  } catch {
    return false;
  }
}

/**
 * Resolve the default output `type` when the user did not set one (M3.2).
 *
 * The default is ALWAYS `"pretty"` — on every runtime, TTY or not, CI or not. Pretty output is what a
 * human reads, and non-TTY output (a pipe, a redirect, `docker logs`, a CI build log) is still read by a
 * human the overwhelming majority of the time. TTY-ness is too weak a signal for "this wants machine-
 * readable JSON", so it never switches the format here — it only controls whether pretty output is
 * COLORIZED (resolved separately in `pretty.style`: colored on a TTY, uncolored when piped).
 *
 * Structured JSON is a deliberate production decision, so it is opt-in: set `type: "json"`, use
 * `Logger.fromEnv()` / `TSLOG_TYPE=json`, or attach a JSON transport/sink. That keeps the consequential
 * choice explicit and where it belongs, instead of guessing it from an ambiguous environment probe.
 */
export function resolveDefaultType(): "pretty" | "json" {
  return "pretty";
}

export function consoleSupportsCssStyling(): boolean {
  if (!isBrowserEnvironment() && !isWorkerEnvironment()) {
    return false;
  }

  const navigatorObj = (globalThis as { navigator?: { userAgent?: string } })?.navigator;
  const userAgent = navigatorObj?.userAgent ?? "";
  if (/firefox/i.test(userAgent)) {
    return true;
  }

  const windowObj = globalThis as unknown as { chrome?: unknown; CSS?: { supports?: (property: string, value: string) => boolean } };
  if (windowObj?.CSS?.supports?.("color", "#000")) {
    return true;
  }

  // Safari < 10 supports basic %c styling, rely on document default console implementation
  return /safari/i.test(userAgent) && !/chrome/i.test(userAgent);
}
