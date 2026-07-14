/**
 * Shared process/page exit hooks for buffering transports.
 *
 * A buffering sink (file stream, HTTP batch, worker queue) silently loses its tail when the process
 * exits before a flush. This module gives transports one guarded place to register for the runtime's
 * end-of-life signals:
 *
 *  - Node `process.on("beforeExit")` — the event loop is still alive, so an ASYNC flush can run
 *    (scheduling I/O keeps the process alive until it settles, then a later `beforeExit` finds nothing
 *    left to do and the process exits).
 *  - Node `process.on("exit")` — synchronous-only territory: each hook's `drainSync` runs (e.g. the
 *    file transport's `flushSync`). This also covers `process.exit(...)` and uncaught exceptions.
 *  - Browser `pagehide` — best-effort: `drainSync` runs and `flushAsync` is kicked off (a
 *    `fetch(..., { keepalive: true })` can outlive the page).
 *
 * Deliberately NOT covered: signal handlers (`SIGTERM`/`SIGINT`). Installing those from a library
 * changes process semantics (a listener suppresses the default termination); graceful signal shutdown
 * belongs to the application — see the shutdown recipe in RECIPES.md.
 *
 * No import-time side effects: listeners are installed lazily on the first registration (once per
 * process, shared by all hooks) and the registry is a plain module-level Set.
 */

/** What a transport wants to run at end-of-life. Both members are optional and independently guarded. */
export interface ExitHook {
  /** Synchronous best-effort drain, safe to call from `process.on("exit")`. Must not throw. */
  drainSync?: () => void;
  /** Asynchronous flush for `beforeExit`/`pagehide`. Errors are swallowed. */
  flushAsync?: () => Promise<void> | void;
}

const hooks = new Set<ExitHook>();
let installed = false;
// `beforeExit` fires again whenever a handler schedules new work. An application handler that LOGS on
// every tick (a common shutdown pattern) plus our flush (which schedules I/O) would ping-pong forever:
// log → flush → I/O keeps loop alive → beforeExit → log → … So the async flush cascade runs AT MOST
// ONCE per process; later ticks only re-run the (side-effect-free-when-empty) sync drains, and the
// `exit` drain still catches anything logged after the cascade.
let flushCascadeRan = false;

function runSyncDrains(): void {
  for (const hook of hooks) {
    try {
      hook.drainSync?.();
    } catch {
      // an exit hook must never turn an orderly exit into a crash
    }
  }
}

function runAsyncFlushes(): void {
  if (flushCascadeRan) {
    return;
  }
  flushCascadeRan = true;
  for (const hook of hooks) {
    try {
      const result = hook.flushAsync?.();
      if (result != null && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // swallowed — see above
    }
  }
}

function installOnce(): void {
  if (installed) {
    return;
  }
  installed = true;

  try {
    const proc = (globalThis as { process?: { on?: (event: string, listener: (...args: unknown[]) => void) => unknown } }).process;
    if (typeof proc?.on === "function") {
      proc.on("beforeExit", runAsyncFlushes);
      proc.on("exit", runSyncDrains);
      return;
    }
  } catch {
    // fall through to the browser path
  }

  try {
    const win = globalThis as { addEventListener?: (event: string, listener: () => void) => void; document?: unknown };
    if (typeof win.addEventListener === "function" && win.document != null) {
      win.addEventListener("pagehide", () => {
        runSyncDrains();
        runAsyncFlushes();
      });
    }
  } catch {
    // no exit signal available on this runtime — hooks simply never fire
  }
}

/**
 * Register an end-of-life hook. Returns an unregister function (idempotent); transports call it from
 * their disposer so a disposed transport never runs at exit.
 */
export function registerExitHook(hook: ExitHook): () => void {
  installOnce();
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}
