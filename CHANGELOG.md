# Changelog

All notable changes to this project are documented here. This project adheres to [Semantic Versioning](https://semver.org/).

## [5.0.1] - 2026-07-16

A patch release that makes source-mapped error positions work out of the box with modern bundler output (Turbopack/Next.js dev, Rollup, Webpack) — verified end-to-end against live Next.js 16 (`next dev --turbopack`) and TanStack Start (Vite) dev servers — and fixes the default browser console output (error styling, stack parsing, log positions), verified in real Chromium, Firefox, and WebKit. No API or settings changes.

### Added
- **Framework E2E suite** (`e2e/`, CI job `test-e2e-apps`) — boots real Next.js + Turbopack and TanStack Start + Vite dev servers against the packed tslog tarball and asserts that logged error frames and call-site positions resolve to the original `.ts` sources. The fixtures track the latest framework releases, so upstream bundler changes surface in CI instead of in user issues.

### Fixed
- **Indexed source maps (`sections`)** — the resolver now understands the sectioned map format emitted by Turbopack (Next.js dev) and other concatenating bundlers: section offsets are walked, positions are shifted into the section's coordinate space, and per-section sub-maps (inline `map` or external `url`) resolve like flat maps. Previously such frames kept pointing at the generated chunk. Everything — including section sub-maps — is parsed once per file and cached, so logging through a sectioned map stays as cheap as through a flat one. Verified against real Rollup and Webpack (ts-loader) output in the test suite.
- **Source-map resolution inside bundled server apps** — bundlers rewrite tslog's dynamic `require(name)` into an always-throwing stub (Turbopack: "expression is too dynamic"), which silently disabled resolution in bundled apps even when the maps were fine. `node:fs` is now acquired via `process.getBuiltinModule` first (a plain runtime call bundlers leave untouched), with `createRequire` kept as the fallback for Node < 20.16.
- **Percent-encoded `sourceMappingURL`s** — the reference is a URL, so file names with `[`/`]` arrive percent-encoded (Turbopack: `%5Broot-of-the-server%5D__x._.js.map`); it is now decoded for the on-disk lookup, with the raw name as fallback for files literally containing `%`.
- **Turbopack virtual source paths** — bracket-prefixed sources such as `[project]/src/app.ts` now reduce to the clean project-relative `src/app.ts` in log output (as `webpack://` sources already did) instead of being wrongly anchored to the map's directory.
- **Caller detection around bundler runtime frames** — unremapped Turbopack runtime chunks (`[root-of-the-server]__….js`, `[turbopack]_runtime.js`) are skipped when locating the user's call site.
- **Browser console error styling** — pretty-printed errors (`logger.error(new Error(…))`) reached the browser console carrying raw ANSI escape codes, which only Chromium's DevTools interprets; Firefox and Safari printed literal `[97m[101m…` noise. Error blocks are now re-expressed as `%c` CSS segments (same red badge and colors as the terminal output, styled in every engine); literal `%` in error text is escaped so it can never consume a `%c` style argument. When `pretty.passObjectsNatively` trails native args, the error text follows them ANSI-stripped instead.
- **Browser stack parsing on dev servers** — a `host:port` authority (i.e. every `localhost:5173`-style dev server) broke browser stack-frame matching, and root-level scripts (`/app.js`) were rejected by the parser's two-segment minimum: log-position meta came up empty and pretty errors printed a bare `error stack:` label with no frames. The scheme + authority is now stripped before path matching (the full URL still lands in `fullFilePath`), so `filePath` is consistently the origin-relative path — previously port-less hosts leaked into it as a bogus first segment (`/example.com/script.js`).
- **Error message noise on Firefox/Safari** — Firefox stamps `fileName`/`lineNumber`/`columnNumber` and WebKit `line`/`column`/`sourceURL` as own properties on every `Error`, and the pretty message line (which joins own properties) rendered them: `Error  http://localhost:5173/app.js, 3, 14, test`. Engine position properties are now excluded, as is an own `name` property (the `this.name = "HttpError"` subclass pattern) — the name is already rendered as the error badge, so `HttpError  Not Found, HttpError, 404` collapses to `HttpError  Not Found, 404`. Custom properties (`err.code` etc.) still join the message.
- **Log position pointed into the tslog bundle for `<script src>`/CDN usage** — the browser IIFE has no `import.meta.url`, so tslog couldn't recognize its own stack frames and caller auto-detection reported tslog's internal frame (`tslog.js:24`) as every log's position. The browser provider now detects the file it is served from at construction time (from a stack capture inside tslog code) and skips that file's frames — exact-match, so same-origin app scripts are unaffected, and when tslog is inlined into the app bundle behavior falls back to the previous first-frame result.


## [5.0.0] - 2026-07-14

A ground-up rewrite. tslog is now ESM-only, zero-dependency, Node >=20, and built with TypeScript 7 / ES2022. Settings are grouped, JSON output is fields-first, and the logger gains a middleware pipeline, async transports, JSONPath masking, OpenTelemetry/pino/GenAI presets, ready-made file/http/ringbuffer/worker transports, and tree-shakeable subpath modules. v5 also adds first-class support for agents and LLMs — fields-first calls, agent/session correlation, and OTel-GenAI attributes; [OpenClaw](https://openclaw.ai) uses tslog for its agent logging. This is a breaking release — see [MIGRATION_v4_to_v5.md](MIGRATION_v4_to_v5.md) for the upgrade path.

### Added
- **Grouped settings** — related options now live under `pretty`, `json`, `mask`, `stack`, and `meta` groups instead of a flat list of `prettyLog*`/`maskValues*` keys. Sub-loggers merge groups rather than overwrite them.
- **Fields-first JSON output** — every level method is overloaded pino-style: `info(fields, message?, ...args)` as well as `info(message, ...args)`. A single object spreads its fields to the top level, a leading object plus string spreads fields and sets `message`, and positional args land under `message`/`"1"`/… Runtime metadata moves under `_logMeta` carrying a `v: 5` schema marker. All JSON keys are configurable via the `json` group.
- **Middleware pipeline** — `logger.use(middleware)` runs functions over each log context to mutate `logObj`/`meta` or drop the log entirely (return `null`/`false`).
- **Async transports** with `attachTransport()` returning a detach function, `logger.flush()`, and `Symbol.asyncDispose`/`Symbol.dispose` support (`await using`). Each transport may declare its own `minLevel` and `format` (`"pretty"`, `"json"`, or a custom formatter).
- **Advanced masking** — `mask.paths` (JSONPath-ish patterns such as `user.password` or `*.token`), `mask.regex`, and a `mask.censor` of `"remove"`, `"hash"`, a string, or a function (with `mask.hashLabel`).
- **Presets** — `tslog/presets/pino` (`pinoFormat`, `pinoTransport`, `toPinoLevel`), `tslog/otel` (`otelFormat`, `toOtelRecord`, `levelToSeverityNumber`, `OtelSeverityNumber`, `otelTraceContext`, `stringifyOtelRecord`), and `tslog/presets/genai` (`genai`, `genaiAttributes`, `genaiSummary` emitting OTel `gen_ai.*` fields).
- **Built-in transports** — `tslog/transports/file` (`fileTransport`, non-blocking, flush/dispose), `tslog/transports/http` (`httpTransport`, batched), `tslog/transports/ringbuffer` (`ringBufferTransport` with `.dump()`/`.clear()`), and `tslog/transports/worker` (`workerTransport`, Node-only off-thread sink I/O).
- **Standard serializers** — `tslog/serializers` exports `stdSerializers` (`err`, `req`, `res`, `user`), the individual serializers, and a `serialize(map)` middleware helper.
- **Context propagation** — `runInContext(ctx, fn)` uses AsyncLocalStorage to attach context fields to `_logMeta` when `meta.attachContext` is enabled. Auto-resolves on Node/Deno/Bun; on Cloudflare Workers inject one via the `contextStorage` setting (graceful no-op in browsers, with a one-time development warning).
- **Custom levels** via the `customLevels` setting and `log(levelId, levelName, ...args)`.
- **New API surface** — `child()` (alias of `getSubLogger()`), `isLevelEnabled()`, `getContext()`, `addLevel()`, `logger.if(condition)`, `Logger.fromEnv()`, `defineConfig()`, and `TslogConfigError` (thrown when `strictConfig` is on).
- **Subpath modules** (all tree-shakeable) — `tslog/lite` (minimal console wrappers preserving native line numbers), `tslog/cli` (also the `tslog` bin, an NDJSON pretty-printer for stdin), `tslog/testing` (`createTestLogger`, `mockLogger`), `tslog/throttle` (rate-limit middleware), `tslog/pretty/box` (`box`, `tree`), and `tslog/console` (`wrapConsole`, `restoreConsole`, `isConsoleWrapped`).
- **Env-aware colorization** — when `type` is omitted, output is `pretty` everywhere (server, CI, browser, React Native); only the coloring adapts to the environment: colored on an interactive TTY (CSS in the browser) and uncolored when stdout is piped/redirected/CI, so no ANSI escapes leak into files or log collectors. Structured JSON is opt-in via `type: "json"`, `TSLOG_TYPE=json`, or a JSON transport. `NO_COLOR` strips colors without switching the format; `FORCE_COLOR` forces styled pretty. Applies to both `new Logger()` and the ready-made `log`.
- **React Native support** — detected via `navigator.product` (`_logMeta.runtime: "react-native"`, Hermes engine version when available), Hermes/JSC stack frames parsed with a hybrid parser, pretty output by default.
- **Real hostname in server JSON logs** — `_logMeta.hostname` resolves from `HOSTNAME`/`HOST`/`COMPUTERNAME`, then the OS hostname (`Deno.hostname()` / `node:os` via `process.getBuiltinModule`), instead of defaulting to `"unknown"`.
- **Tree-shakeable exports** — `sideEffects: false` (audited) with per-runtime conditional exports.
- **`tslog/slim`** — the smallest structured-JSON build (~9KB gzip vs ~19KB for the full browser entry, budget-checked in CI): the same pipeline minus masking, pretty output, and stack capture; `mask` settings and `type: "pretty"` throw instead of silently degrading.
- **Buffered stdout sink (Node)** — the Node entry writes `type: "json"` lines through a batched `process.stdout.write` (one write per event-loop turn, early flush past ~8KB) instead of per-line `console.log`; drained by `logger.flush()`, `await using`, and guarded `beforeExit`/`exit` hooks (a bare `process.exit()` loses nothing). Browser/universal entries keep `console.log`.
- **Time seam** — an injectable top-level `clock: () => Date` (deterministic tests, offset/monotonic stamping; inherited by sub-loggers, hostile clocks ignored) and `json.time: "iso" | "epoch" | false | fn` controlling the top-level timestamp representation (`_logMeta.date` stays UTC ISO).
- **Deterministic test output** — `createTestLogger(settings, { now, normalize })`: `now` freezes only that logger's clock (no fake-timer sledgehammer), `normalize: true` yields snapshot-stable records/lines; plus a standalone `normalizeMeta(recordOrLine)` scrubber (all in `tslog/testing`).
- **Real OTLP/JSON in `tslog/otel`** — `otlpFormat`/`toOtlpJson`/`toOtlpLogRecord`/`toOtlpAnyValue`/`stringifyOtlpRequest` emit the collector wire format (camelCase proto3 fields, typed attributes, `resourceLogs[].scopeLogs[].logRecords[]` envelope, `exception.*` semconv mapping for logged errors), and `otlpBatchBody` pairs with the http transport's new `encodeBody` option to POST merged batches straight to `/v1/logs`.
- **`httpTransport({ encodeBody })`** — custom body encoder for endpoints whose payload is neither NDJSON nor a JSON array (used by the OTLP pairing above).
- **Conditional logging** — `logger.if(condition)` returns the logger when the condition is truthy and a no-op stand-in when falsy, so a per-call guard reads as a fluent chain (`log.if(!ok).warn("failed", { id })`). Use `isLevelEnabled()` to skip expensive payload construction.
- **Browser-native pretty objects** — `pretty.passObjectsNatively` hands non-`Error` arguments to the console by reference (on by default in real browsers), so DevTools renders collapsible, interactive trees; pair with `pretty.levelMethod` for native warn/error stack groups. Set `false` for log-time snapshots or text-matchable console output.
- **Source-mapped error positions** — on Node, Bun, and Deno, logged `Error` stack frames resolve through discoverable source maps back to original `.ts` file/line/column (automatic outside production; override with `TSLOG_SOURCE_MAPS=on`/`off`).

### Changed
- **ESM-only** and **Node >=20**; the project now targets **TypeScript 7 / ES2022**.
- **JSON output on Node no longer goes through `console.log`** (see the buffered stdout sink above) — code intercepting `console.log` must spy on `process.stdout.write` or use `type: "hidden"` plus a transport.
- **`tslog/otel` resource precedence** — in `toOtelRecord`, `resource` attributes now win over colliding per-record fields (resource identity semantics); in the OTLP shape they live in the envelope, separate from record attributes.
- The default JSON shape is fields-first with `_logMeta.v: 5`; `name`/`parentNames` appear only when set (no `"[undefined]"` noise).
- **Masking is off by default** — `mask.keys` starts empty; enable it explicitly.

### Removed
- The **CommonJS build** and `require("tslog")` — the package is ESM-only.
- The **`overwrite.*` hooks** (`mask`, `toLogObj`, `addMeta`, `formatMeta`, `formatLogObj`, `transportFormatted`, `transportJSON`, `addPlaceholders`) — use middleware and per-transport `format` instead.
- **Flat settings keys** — `prettyLogTemplate`/`prettyError*`/`prettyLog*`, `stylePrettyLogs`, `maskValuesOfKeys`/`maskValuesRegEx`/`maskPlaceholder`, `metaProperty`, and `stackDepthLevel` (now the `callerFrame` constructor parameter).
- **`hideLogPositionForProduction`** — superseded by the `stack` group and env-aware defaults.
- The **`loggerEnvironment`/`createLoggerEnvironment` singleton** — each entry point exports its own environment factory (`createNodeEnvironment`, `createBrowserEnvironment`, `createUniversalEnvironment`/`selectEnvironment`).
- The nested `{"0": message}` JSON shape.

### Fixed
- During the rewrite: `URL` values now render correctly instead of as empty objects; caller-frame detection no longer over-matches internal frames; the pino fields-first overload no longer collides with the string-first signature; and bare `Error` arguments preserve their `cause` chain instead of dropping it.
- The browser stack parser now handles Windows drive-letter paths served by Vite (`/@fs/C:/…`), so log positions resolve correctly on Windows instead of being truncated to `/@fs/C`. (#323, #302)


## [4.11.0] - 2026-07-07

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
