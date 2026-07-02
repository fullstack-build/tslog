/**
 * Package root entry — the universal build.
 *
 * Re-exports everything from {@link import("./index.universal.js")} so importing from the package root
 * (`tslog`) resolves to the runtime-agnostic universal logger that auto-detects Node, browsers, Deno,
 * Bun, and workers at construction time. The Node- and browser-specific builds live in
 * `./index.node.js` and `./index.browser.js` and are selected via the package's conditional exports.
 *
 * Exposed names: `Logger`, `BaseLogger`, the ready-made `log` instance, and all interface/enum types.
 * NOTE (BC11): the v4 `loggerEnvironment` / `createLoggerEnvironment` exports were removed in v5 — the
 * environment is now an injected provider (`src/env/*`), not a module-level singleton.
 */
export * from "./index.universal.js";
