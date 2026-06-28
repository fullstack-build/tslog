# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## [4.11.0] - Unreleased

A backward-compatible release that adds several requested features, fixes a batch of reported bugs, unifies code-position detection across every runtime, and modernises the test/build tooling. No breaking changes — see the upcoming **v5** for those.

### Added
- **`prettyLogLevelMethod`** — map log levels to specific `console` methods (e.g. route `WARN` to `console.warn`, `ERROR`/`FATAL` to `console.error`), with a `*` fallback and `console.log` default. Useful for browser DevTools filtering and log aggregators. (#330)
- **`DefaultLogLevels` enum** — the default log level ids (`SILLY`…`FATAL`) are now exported as a typed enum, usable for `minLevel` and custom loggers. (#308)
- **`includeDefaultMetaInAddMeta`** — when set, a custom `overwrite.addMeta` handler receives the default runtime meta as a fourth argument so it can extend rather than replace it. (#303)
- **`internalFramePatterns`** — register additional stack-frame patterns to treat as "internal" when auto-detecting the calling code position, so wrapper/custom loggers report *their* caller instead of the wrapper file. (#282)
- **`fileNameWithLine`** added to `IPrettyLogStyles` so it can be styled like other placeholders; the inline `prettyLogStyles` type now reuses `IPrettyLogStyles`. (#310)
- **`IMetaStatic` types** now expose `hostname`, `runtimeVersion`, and `browser`, which were already populated at runtime but missing from the public type. (#268)

### Changed
- **Unified code-position detection across all runtimes.** The browser entry no longer uses hardcoded Safari/other stack depths (`4`/`5`); both entry points now use the same pattern-based auto-detection that finds the first non-tslog frame. Verified to resolve the correct caller on Node, Bun, Deno, web workers, Chrome, and Safari/WebKit. Manual `stackDepthLevel` overrides still work.
- Attached transports are now invoked in isolation: a transport that throws no longer crashes logging or prevents other transports (and the default console output) from running; the error is reported via `console.error`.
- Migrated the test toolchain to **Vitest** and **Playwright** (replacing Jest/Puppeteer), added a cross-runtime suite (Node, browser, Deno, Bun, workers) and a per-engine browser matrix (Chromium, Firefox, WebKit), and reached 100% coverage on the measured source.
- Replaced ESLint/Prettier with **Biome**, switched docs from docsify to **Starlight**, and modernised git hooks (Husky v9).

### Fixed
- BigInt values are rendered with the trailing `n` (e.g. `100n`) instead of as an empty object `{}`. (#334)
- Invalid `Date` values render as `Invalid Date` instead of throwing `RangeError: Invalid time value`. (#266)
- In `local` time zone, `{{rawIsoStr}}` now carries the real UTC offset (e.g. `+02:00`) instead of a misleading `Z`, and round-trips to the correct instant. (#207)
- Web workers are detected as CSS-capable consoles, so they receive `%c` styling instead of leaking ANSI control characters (notably in Firefox workers). (#262)
- `maskValuesRegEx` placeholders containing `$1`, `$&`, etc. are now inserted literally instead of being interpreted as regex substitution patterns (which could leak parts of a masked value).
- Numeric `maskValuesOfKeys` (e.g. `[123]`) now correctly match string property names.
- Inspect options passed via `prettyInspectOptions` (e.g. `depth`, `colors`) are now actually applied; previously `_extend` mutated a discarded copy of the context. (#331, #285, #327)
- Logging an error whose property is a null-prototype object or has a throwing `toString`/`Symbol.toPrimitive` no longer crashes formatting. (#335, #294)

## [4.10.2] - 2025-09-30

### Fixed
- Fixed the CommonJS build and included the `README` in the published `dist` folder.

## [4.10.1] - 2025-09-30

### Changed
- Internal release-tooling fixes: refactored the pre-commit hook and corrected `package.json` paths used during publishing. No user-facing changes.

## [4.10.0] - 2025-09-25

### Breaking
- Custom `transportFormatted` overrides now receive `logMeta` as the fourth argument; pass five parameters to also receive `settings`, otherwise adjust implementations that previously read `settings` from the fourth position.
- Deprecated runtime entry points under `src/runtime/**` and related browser mappings have been removed; use the primary `Logger` export instead of importing runtime-specific helpers.
- Logger metadata now exposes lowercase runtime identifiers (for example `node`, `browser`, `deno`, `bun`, `worker`) and normalized versions without the leading `v`; adjust consumers that compared against `Nodejs` or relied on the old format.

### Added
- Introduced universal runtime detection that recognises Node.js, browsers, web workers, Deno, and Bun, enriching metadata with runtime versions and hostnames when available.
- Documented first-class Deno and Bun usage, refreshed examples under `examples/server`, and aligned development scripts (`npm run dev-ts*`).
- Pretty transports now detect when the browser console supports CSS, rendering styled output with `%c` tokens and gracefully falling back when styling is unavailable.
- Error formatting captures chained `Error.cause` entries (up to depth five) and includes them in both pretty error blocks and JSON error objects.

### Changed
- The core logger automatically locates the first user stack frame instead of relying on hard-coded depths, producing stable file and line metadata across bundlers; manual `stackDepthLevel` overrides continue to work.
- Placeholder formatting now routes through a shared `buildPrettyMeta` utility, improving consistency for custom templates and nested style tokens.
- Masking internals normalise and cache case-insensitive keys, reducing repeated allocations and keeping behaviour consistent when toggling mask options.
- Browser styling defaults keep ANSI colouring enabled unless explicitly disabled, letting CSS-capable consoles honour `stylePrettyLogs` without runtime-specific tweaks.

### Fixed
- Runtime error detection now treats objects with an `Error`-suffixed name as errors, ensuring they are formatted via the error transport.
- Browser stack parsing guards against malformed frames, avoiding crashes when devtools emit unexpected stack entries.
- Logging no longer fails when `process.cwd()` throws (for example under restricted permissions); environment helpers fall back to cached working directories and hostname detection across Node, Deno, and Bun.
