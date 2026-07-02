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

/** Heuristically detect a CI environment from the common env flags so the default type falls back to JSON. */
export function isContinuousIntegration(): boolean {
  // The single `CI` flag covers the vast majority of providers (GitHub Actions, GitLab, CircleCI, Travis,
  // Buildkite, …); the extras catch the few that historically omitted it.
  for (const key of ["CI", "CONTINUOUS_INTEGRATION", "GITHUB_ACTIONS", "GITLAB_CI", "BUILDKITE", "TF_BUILD"]) {
    const value = safeEnvGet(key);
    if (value != null && value !== "" && value !== "false" && value !== "0") {
      return true;
    }
  }
  return false;
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
 * Browsers (and web workers) always default to `"pretty"` (CSS `%c` styling). On server runtimes the
 * choice is environment-aware: an interactive stdout TTY that is NOT a CI run and does NOT request
 * `NO_COLOR` yields `"pretty"` (great for local development); everything else (piped output, CI, non-TTY,
 * `NO_COLOR`) yields `"json"` (great for production / observability / LLM ingestion). `FORCE_COLOR`
 * forces `"pretty"` regardless of the TTY check.
 */
export function resolveDefaultType(): "pretty" | "json" {
  if (isBrowserEnvironment() || isWorkerEnvironment()) {
    return "pretty";
  }
  if (forceColorRequested()) {
    return "pretty";
  }
  if (noColorRequested() || isContinuousIntegration()) {
    return "json";
  }
  return stdoutIsTTY() ? "pretty" : "json";
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
