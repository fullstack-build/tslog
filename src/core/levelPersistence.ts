/**
 * Opt-in browser log-level persistence (M4.6).
 *
 * Reads/writes a logger's `minLevel` from `localStorage` so verbosity can be flipped live from the devtools
 * console and survive a page reload. Everything here is:
 *  - GUARDED: every `localStorage` access is wrapped in `try/catch` (Safari private mode and disabled storage
 *    throw on access), so a hostile environment never crashes logging.
 *  - NO-OP off-browser: when there is no usable `localStorage` (Node/Bun/Deno/workers), reads return
 *    `undefined` and writes do nothing — keeping Node behavior byte-for-byte unchanged.
 *  - SIDE-EFFECT FREE at import time: nothing runs until a function is called, so `sideEffects: false` holds.
 */

/** Default `localStorage` key used to persist the active log level. */
export const DEFAULT_PERSIST_LEVEL_KEY = "tslog:level";

/**
 * Resolve a usable `localStorage` object, or `undefined` when none is available (off-browser) or access throws
 * (private mode / blocked storage). Never throws.
 */
function getLocalStorage(): Storage | undefined {
  try {
    // `localStorage` may be undefined (Node), or a getter that throws (privacy modes / sandboxed iframes).
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    return storage != null && typeof storage.getItem === "function" ? storage : undefined;
    /* v8 ignore next 3 -- defensive: some engines throw merely on touching the property */
  } catch {
    return undefined;
  }
}

/**
 * Read the persisted level token (a numeric id like `"2"` or a name like `"WARN"`) from `localStorage`, or
 * `undefined` when persistence is unavailable / the key is unset. Caller resolves the token to a numeric id.
 */
export function readPersistedLevel(key: string = DEFAULT_PERSIST_LEVEL_KEY): string | undefined {
  const storage = getLocalStorage();
  if (storage == null) {
    return undefined;
  }
  try {
    const value = storage.getItem(key);
    return value == null || value === "" ? undefined : value;
    /* v8 ignore next 3 -- defensive: getItem can throw in restricted contexts */
  } catch {
    return undefined;
  }
}

/**
 * Persist the given numeric level id to `localStorage`. NO-OP (and never throws) when persistence is
 * unavailable. Stored as the numeric id so it round-trips deterministically regardless of custom-level names.
 */
export function writePersistedLevel(levelId: number, key: string = DEFAULT_PERSIST_LEVEL_KEY): void {
  const storage = getLocalStorage();
  if (storage == null) {
    return;
  }
  try {
    storage.setItem(key, String(levelId));
    /* v8 ignore next 3 -- defensive: setItem can throw (quota / private mode) */
  } catch {
    // never let persistence crash logging
  }
}
