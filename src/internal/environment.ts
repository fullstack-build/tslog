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
    const deno: { cwd?: () => string } | undefined = (globalThis as Record<string, unknown>)?.["Deno"] as { cwd?: () => string } | undefined;
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

export function consoleSupportsCssStyling(): boolean {
  if (!isBrowserEnvironment()) {
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
