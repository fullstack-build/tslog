/**
 * Async context store (M2.13) — the runtime-agnostic seam behind `logger.runInContext(ctx, fn)` and the
 * automatic attach of the active context onto every log's `_meta`.
 *
 * On Node, Deno, and Bun this is backed by `node:async_hooks`' `AsyncLocalStorage`, so a context set with
 * `runInContext` propagates across `await`, `setTimeout`, promise chains, and nested calls. On runtimes
 * without `AsyncLocalStorage` (browsers, most edge runtimes) the store degrades to a graceful NO-OP: `run`
 * still invokes the function, but no context is propagated (`getStore()` returns `undefined`).
 *
 * IMPORTANT (sideEffects:false / tree-shaking): this module must NEVER statically import `node:async_hooks`
 * at the top level. The constructor — itself only invoked lazily, on first `runInContext` — resolves the
 * `AsyncLocalStorage` class through guarded global/builtin probes that work without an ESM `import`. Merely
 * importing this module pulls in no Node built-in.
 */

/** A read-only, free-form bag of context fields attached to the active async scope (e.g. `requestId`, `traceId`). */
export type AsyncContextFields = Record<string, unknown>;

/**
 * The minimal store contract `BaseLogger` consumes. Implemented either by an `AsyncLocalStorage`-backed
 * store (Node/Deno/Bun) or by the no-op store (everywhere else). Both share the same call shape so the
 * core pipeline never branches on the runtime.
 */
export interface AsyncContextStore {
  /** Run `fn` with `ctx` as the active context for the (possibly async) duration of `fn`; returns `fn`'s result. */
  run<T>(ctx: AsyncContextFields, fn: () => T): T;
  /** The context active for the current async scope, or `undefined` when none is set (or on a no-op store). */
  getStore(): AsyncContextFields | undefined;
  /** Whether this store actually propagates context (`true` for ALS-backed; `false` for the no-op fallback). */
  readonly enabled: boolean;
}

/** The structural subset of `AsyncLocalStorage` we rely on, so we can type the probed class without `node:async_hooks`. */
interface AsyncLocalStorageLike<T> {
  run<R>(store: T, fn: () => R): R;
  getStore(): T | undefined;
}
type AsyncLocalStorageCtor = new <T>() => AsyncLocalStorageLike<T>;

/**
 * Best-effort, side-effect-free resolution of the `AsyncLocalStorage` constructor across server runtimes,
 * without a top-level `node:async_hooks` import (which would break `sideEffects:false`).
 *
 * Probe order:
 * 1. `globalThis.AsyncLocalStorage` — exposed directly by some runtimes/polyfills.
 * 2. `process.getBuiltinModule("node:async_hooks")` — the synchronous, import-free builtin accessor
 *    (Node 22+, Bun, Deno) added precisely for cases like this.
 *
 * Returns `undefined` when no implementation is reachable, so the caller can fall back to the no-op store.
 */
export function resolveAsyncLocalStorage(): AsyncLocalStorageCtor | undefined {
  const fromGlobal = (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage;
  if (typeof fromGlobal === "function") {
    return fromGlobal as AsyncLocalStorageCtor;
  }

  try {
    const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
    if (typeof getBuiltinModule === "function") {
      const mod = getBuiltinModule("node:async_hooks") as { AsyncLocalStorage?: unknown } | undefined;
      if (typeof mod?.AsyncLocalStorage === "function") {
        return mod.AsyncLocalStorage as AsyncLocalStorageCtor;
      }
    }
  } catch {
    // ignore — runtime forbids builtin access or has no async_hooks; fall through to the no-op store.
  }

  return undefined;
}

/** The shared, allocation-free no-op store: runs the function but never propagates context. */
const NOOP_STORE: AsyncContextStore = {
  run: (_ctx, fn) => fn(),
  getStore: () => undefined,
  enabled: false,
};

/**
 * Build an {@link AsyncContextStore} for the current runtime.
 *
 * If `ctor` (an `AsyncLocalStorage` constructor, typically from {@link resolveAsyncLocalStorage} or a
 * provider that resolved it through `createRequire`) is supplied/resolvable, returns an ALS-backed store
 * that nests correctly (the parent's fields are inherited and shallow-merged under a child `run`). Otherwise
 * returns the singleton no-op store. Never throws.
 */
export function createAsyncContextStore(ctor: AsyncLocalStorageCtor | undefined = resolveAsyncLocalStorage()): AsyncContextStore {
  if (ctor == null) {
    return NOOP_STORE;
  }

  let als: AsyncLocalStorageLike<AsyncContextFields>;
  try {
    als = new ctor<AsyncContextFields>();
  } catch {
    // The runtime advertised an AsyncLocalStorage but it cannot be instantiated — degrade to no-op.
    return NOOP_STORE;
  }

  return wrapStorageInstance(als);
}

/**
 * Build an {@link AsyncContextStore} around a USER-SUPPLIED `AsyncLocalStorage`(-shaped) instance —
 * the `contextStorage` setting. The injection seam exists for runtimes where automatic resolution
 * cannot work, e.g. Cloudflare Workers under the `nodejs_als` compatibility flag: `node:async_hooks`
 * is importable there, but there is no `process.getBuiltinModule` and no global to probe. The same
 * nested-merge semantics as the auto-resolved store apply. A malformed instance (missing `run` or
 * `getStore`) degrades to the no-op store rather than throwing mid-request.
 */
export function createAsyncContextStoreFromInstance(instance: { run: unknown; getStore: unknown }): AsyncContextStore {
  // Guarded property reads: a hostile object with throwing `run`/`getStore` accessors must degrade to
  // the no-op store, never crash logger construction.
  try {
    if (typeof instance?.run !== "function" || typeof instance?.getStore !== "function") {
      return NOOP_STORE;
    }
  } catch {
    return NOOP_STORE;
  }
  return wrapStorageInstance(instance as AsyncLocalStorageLike<AsyncContextFields>);
}

/** Shared ALS-instance wrapper: nested `run`s inherit the parent's fields, new fields win. */
function wrapStorageInstance(als: AsyncLocalStorageLike<AsyncContextFields>): AsyncContextStore {
  return {
    enabled: true,
    run<T>(ctx: AsyncContextFields, fn: () => T): T {
      // Nested contexts inherit the parent's fields, with the new context's fields taking precedence.
      // ALWAYS copy — storing the caller's object by reference would let later mutations of it (or of
      // the bag returned by getContext()) silently rewrite the context of every log in the scope.
      const parent = als.getStore();
      const merged: AsyncContextFields = parent != null ? { ...parent, ...ctx } : { ...ctx };
      return als.run(merged, fn);
    },
    getStore(): AsyncContextFields | undefined {
      return als.getStore();
    },
  };
}
