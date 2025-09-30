# Changelog

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
