## Project Overview

tslog is a TypeScript logger for browsers, Node.js, Deno, and Bun, React Native, and workers. It supports JSON and pretty-printed output, stack traces, error formatting, custom transports, and sub-loggers. v5 adds an always-`pretty` default `type` (colorization and `pretty.passObjectsNatively` — on by default in real browsers — are the env-aware parts, never the format), flat fields-first JSON, async-context correlation, path/regex masking, a middleware chain, and pino/otel/genai presets. Current version: 5.x (the `5` line; `_logMeta.v` in JSON output is `5`).

### Settings are grouped (v5)

There are no flat settings keys. Configuration is organized into groups passed to `new Logger({ ... })`:

- Top-level: `type` (`"json" | "pretty" | "hidden"`, defaults to `"pretty"`), `name`, `minLevel` (name or 0..6), `prefix`, `customLevels`, `strictConfig`, `clock` (injectable `() => Date`).
- `mask: { keys, paths, regex, caseInsensitive, placeholder, censor }` — redact secrets/PII/prompts by key, dotted path (`*` = one segment), or regex.
- `json: { messageKey, levelKey, levelIdKey, timeKey, time, errorKey, numericLevel, stableKeyOrder }` — structured-output key names/shape (`time`: `"iso" | "epoch" | false | fn`).
- `pretty: { enabled, template, errorTemplate, style, timeZone, styles, levelMethod, inspectOptions, ... }`.
- `stack: { capture: "off" | "lazy" | "auto" | "full", internalFramePatterns }`.
- `meta: { property, attachContext }`.

New runtime surface: `getSubLogger`/`child` (aliases), `runInContext`/`getContext` (AsyncLocalStorage correlation), `attachTransport`, `use` (middleware), `flush`, `addLevel`, `isLevelEnabled`, `[Symbol.asyncDispose]`/`[Symbol.dispose]`, `Logger.fromEnv`, and the `defineConfig` helper. Presets ship as subpaths: `tslog/presets/pino`, `tslog/otel`, `tslog/presets/genai`; transports as `tslog/transports/{file,http,ringbuffer}`.


## Quick Reference

```bash
npm install          # Install dependencies
npm test             # Run Vitest test suite
npm run test:browser # Run Playwright browser tests (Chromium, Firefox, WebKit)
npm run test:bun     # Run Vitest under Bun
npm run test:deno    # Build + run Deno test adapter
npm run build        # Full build: types → ESM → browser IIFE bundle → prepare dist
npm run lint         # Biome lint check
npm run format       # Biome format all files
npm run check        # Biome lint + format (write)
npm run coverage     # Run tests with coverage report
npm run test:e2e-apps # Framework E2E: real Next.js (Turbopack) + TanStack Start dev servers (needs network + prior build)
```

## Build System

- **ESM-only.** There is no CJS build and no `require("tslog")` — v5 dropped dual publishing.
- **tsgo** (`@typescript/native-preview`, the TypeScript 7 native compiler) emits the ESM output (`dist/esm/`) and the declaration files (`dist/types/`).
- **esbuild** (`build.js`) bundles the browser IIFE (`dist/browser/index.js`, global `tslog`) from `src/index.browser.ts`.
- `"type": "module"` — the project is ESM throughout.
- `npm run build` = `clean-dist` (wipes `dist/` so stale files never ship) → `build-types` → `build-esm` → `build-browser` → `prepare-publish`.
- **Conditional exports** in `package.json` pick the entry per runtime: `node` → `index.node.js`, `browser`/`worker` → `index.browser.js`, `deno`/`bun`/`react-native`/`default` → `index.universal.js`. Subpaths (`tslog/transports/*`, `tslog/presets/*`, `tslog/otel`, `tslog/serializers`, `tslog/lite`, `tslog/slim`, `tslog/console`, `tslog/testing`, `tslog/pretty/box`, `tslog/throttle`, `tslog/cli`) are individually mapped and tree-shakeable (`sideEffects: false`, audited by `npm run audit-sideeffects`; gzip budgets for the slim/full browser bundles enforced by `npm run check-bundle-size`).
- The `tslog` bin (NDJSON pretty-printer) is `dist/esm/subpaths/cli.js`.

### Build configs

| Config | Purpose |
|---|---|
| `tsconfig.json` | Base (ES2022, strict, NodeNext) |
| `tsconfig.esm.json` | ESM output (`dist/esm/`) |
| `tsconfig.types.json` | Declaration files only (`dist/types/`) |

## Testing

- **Vitest** for Node.js and Bun tests
- **Playwright** for browser tests across **Chromium, Firefox, and WebKit** (via `playwright.config.ts`)
- **Deno.test** adapter (`tests/deno_runner.ts`) imports from `dist/esm/`
- Test files: `tests/*.test.ts` (numbered by feature area)
- Browser test files: `tests/*.browser.test.ts` — run only by Playwright, excluded from Vitest via the `tests/**/*.browser.test.ts` glob in `vitest.config.ts`
- Browser specs run against the IIFE bundle exposed as the global `window.tslog`; shared helpers in `tests/support/browser/browserHarness.ts` (`inPage` for logObj/return-value assertions, `captureConsole` for printed output) keep `page.evaluate` boilerplate out of the specs
- Browser coverage mirrors the runtime-relevant Node suites (masking, log types, settings, sub-loggers/prefixes, errors, placeholders, log objects, recursion); Node-only behavior (file paths, `process` transports, `util.inspect` ANSI, workers) is intentionally not ported
- Test timeout: 100 seconds (Vitest); Playwright timeout is 60 seconds per test
- The browser test server (`test-browser-serve` script) serves the bundle and a demo page on port 4444; Playwright starts it automatically
- Run a single Node test: `npx vitest run tests/1_json_loglevel.test.ts`
- Run a single browser test on one engine: `npx playwright test tests/26_advanced_masking.browser.test.ts --project=chromium`
- First-time browser setup: `npx playwright install firefox webkit` (Chromium ships with the runner)
- **Framework E2E** (`e2e/`): `npm run test:e2e-apps` packs `dist/` and runs real dev servers from `e2e/fixtures/` (Next.js + Turbopack on port 43117, TanStack Start + Vite on 43118), asserting via each app's `/api/boom` probe that log positions resolve to original `.ts` sources. Fixtures install the **latest** framework versions on purpose (upstream-change canary). Not part of `npm test` (needs network + a prior `npm run build`); CI runs it as the `test-e2e-apps` job. Run one fixture: `node e2e/run-e2e-apps.mjs next-turbopack`

## Code Style

- **Double quotes**, **semicolons required**, **Unix (LF) line endings**
- **2-space indentation**, max **160 character** line length
- **Biome** (`biome.json`) for linting and formatting (replaces ESLint + Prettier)
- EditorConfig (`.editorconfig`) enforces formatting in editors

## Source Architecture

v5 is organized into `core/` (runtime-agnostic logic), `env/` (per-runtime environment providers), `internal/` (small shared helpers), `render/` (output), and `subpaths/` (tree-shakeable add-ons). The entry points differ only in which environment factory they bind; the `Logger` class itself is shared.

```
src/
├── index.ts                  # Logger class (extends BaseLogger) + shared exports
├── index.node.ts             # Node entry — binds createNodeEnvironment
├── index.universal.ts        # Deno/Bun/React Native/default entry
├── index.browser.ts          # Browser/worker entry (Safari detect, CSS styling)
├── BaseLogger.ts             # Core logger plumbing
├── interfaces.ts             # All TypeScript interfaces and types
├── formatTemplate.ts         # Template string replacement
├── formatNumberAddZeros.ts   # Zero-padding for template date/time parts
├── urlToObj.ts               # URL → plain-object serialization
├── core/                     # Runtime-agnostic logic
│   ├── settings.ts           # Grouped-settings normalization/merge + v4-key migration warnings
│   ├── config.ts             # defineConfig + TslogConfigError
│   ├── pipeline.ts           # log() → mask → logObj → meta → format → transport
│   ├── masking.ts            # keys / paths / regex / censor masking
│   ├── logObj.ts             # Build the structured log object
│   ├── meta.ts               # _logMeta assembly
│   ├── levels.ts             # DefaultLogLevels + custom levels
│   ├── transports.ts         # Transport registry + isolation
│   ├── asyncContext.ts       # runInContext / getContext (AsyncLocalStorage)
│   ├── fromEnv.ts            # Logger.fromEnv (TSLOG_LEVEL/TYPE/NAME)
│   ├── levelPersistence.ts   # persistLevel (browser localStorage)
│   ├── features.ts           # CoreFeatures seam (what a build ships: masking, JSON renderer, …)
│   └── features.full.ts      # Full feature set injected by the standard entries
├── env/                      # Per-runtime environment providers
│   ├── environment.ts        # EnvironmentProvider contract + factory types
│   ├── environment.node.ts   # createNodeEnvironment
│   ├── environment.browser.ts# createBrowserEnvironment
│   ├── environment.universal.ts # createUniversalEnvironment / selectEnvironment
│   ├── environment.slim.ts   # Minimal provider for tslog/slim
│   ├── providerBase.ts       # Shared provider base (meta markup, transport formatting)
│   ├── shared.ts             # Helpers shared across providers (paths, meta text)
│   ├── stackTrace.ts         # Stack capture/parse
│   ├── sourceMap.node.ts     # Source-map error-position resolution (Node/Bun/Deno)
│   └── stdoutSink.node.ts    # Buffered stdout sink (Node JSON output)
├── internal/                 # Small shared helpers
│   ├── environment.ts        # Runtime detection, TTY/color probing, resolveDefaultType
│   ├── errorUtils.ts         # Error introspection helpers
│   ├── exitHooks.ts          # Process/page exit flushing for transports
│   ├── jsonStringifyRecursive.ts # Circular-safe JSON stringify
│   ├── metaFormatting.ts     # Pretty meta template rendering
│   ├── nativeConsole.ts      # Untouched console method access
│   └── InspectOptions.interface.ts # Runtime-free InspectOptions type
├── render/                   # Output formatting
│   ├── json.ts               # JSON serialization (flat, fields-first, _logMeta.v)
│   ├── inspect.ts            # native util.inspect (Node)
│   ├── inspect.polyfill.ts   # off-Node inspect polyfill
│   └── styles.ts             # pretty styling
└── subpaths/                 # Tree-shakeable add-ons (each its own export)
    ├── presets/{pino,otel,genai}.ts
    ├── transports/{file,http,ringBuffer,worker,worker.runner}.ts
    ├── serializers/std.ts    ├── pretty/box.ts
    ├── lite.ts   ├── slim.ts   ├── testing.ts   ├── throttle.ts
    ├── wrapConsole.ts        └── cli.ts   # tslog bin (NDJSON pretty-printer)
```

**Log lifecycle:** `log()` → mask → build logObj → attach `_logMeta` → middleware (`use`) → format → transports (`render/` formats; per-transport `format` can override).

**7 default log levels:** silly(0), trace(1), debug(2), info(3), warn(4), error(5), fatal(6). Add more via the `customLevels` setting or `addLevel()`.

## Git Workflow

- **master** — stable releases, CI runs on push/PR
- **development** — active development branch
- Pre-commit hook via **Husky v9** (`.husky/pre-commit`) runs: test → check (biome) → build
- CI: GitHub Actions on Node 20 (coverage + browser), Bun (latest), Deno (v2.x); uploads to Codecov

## Publishing

- Uses **np** for releases (`npm run release`)
- Publishes from `dist/` directory (`publishConfig.directory: "dist"`)
- `scripts/prepare-publish.mjs` writes a dist-relative `package.json` and copies `LICENSE`, `README.md`, `llms.txt`, `RECIPES.md`, and `MIGRATION_v4_to_v5.md` into `dist/`
- Supports: Node.js (ESM), browsers (IIFE), Deno, Bun, React Native — all ESM, no CJS

## Key Conventions

- Node.js 20+ required (`package.json` `engines`); ES2022 target
- npm only (engine-strict in `.npmrc`)
- Zero runtime dependencies
- TypeScript 7 (tsgo) strict mode throughout; ESM-only
- Tests are numbered by feature area (e.g., `1_json_loglevel`, `5_pretty_Log_Types`)
- Browser-specific code isolated in `index.browser.ts` and `tests/support/`

## Quality Standards

- Target **100% test coverage** — but only with meaningful tests, no padding
- Every new feature **must** have corresponding tests
- Every new feature **must** be reflected in the docs (`docs/`)
- Don't write tests just to hit coverage numbers; each test should verify real behavior

### AI-facing docs (`llms.txt`, `RECIPES.md`)

- `llms.txt` (machine-readable API surface for code generation) and `RECIPES.md` (copy-paste patterns) are published with the package and must stay consistent with each other and with the public API. When you change a public setting/method or one of these files, update both — and the README — in the same change.
- `npm run check-doc-sync` (part of `npm run check`, run by the pre-commit hook and CI) enforces the mechanical invariants: every setting/symbol named in the docs exists in the source, the masking examples don't conflict, and relative links resolve.
- The script only checks structural drift. For semantic accuracy/completeness, run the deeper `audit-ai-docs` workflow before a release.
