# AGENTS.md — tslog

## Project Overview

tslog is a TypeScript logger for Node.js, browsers, Deno, and Bun. It supports JSON and pretty-printed output, stack traces, error formatting, custom transports, and sub-loggers. Current version: 4.10.2.

## Quick Reference

```bash
npm install          # Install dependencies
npm test             # Run Vitest test suite
npm run test:browser # Run Playwright browser tests (Chromium, Firefox, WebKit)
npm run test:bun     # Run Vitest under Bun
npm run test:deno    # Build + run Deno test adapter
npm run build        # Full build: types → ESM/CJS → browser bundle → prepare dist
npm run lint         # Biome lint check
npm run format       # Biome format all files
npm run check        # Biome lint + format (write)
npm run coverage     # Run tests with coverage report
npm run dev-ts       # Watch mode (nodemon + ts-node on examples)
```

## Build System

- **TypeScript (tsc)** for ESM (`dist/esm/`) and CJS (`dist/cjs/`) builds
- **esbuild** (`build.js`) for browser IIFE bundle (`dist/browser/`)
- **Type declarations** generated separately to `dist/types/`
- Dual ESM/CJS publishing with conditional exports in package.json
- `"type": "module"` — project uses ESM by default

### Build configs

| Config | Purpose |
|---|---|
| `tsconfig.json` | Base (ES2020, strict, NodeNext) |
| `tsconfig.esm.json` | ESM output |
| `tsconfig.cjs.json` | CJS output |
| `tsconfig.types.json` | Declaration files only |

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

## Code Style

- **Double quotes**, **semicolons required**, **Unix (LF) line endings**
- **2-space indentation**, max **160 character** line length
- **Biome** (`biome.json`) for linting and formatting (replaces ESLint + Prettier)
- EditorConfig (`.editorconfig`) enforces formatting in editors

## Source Architecture

```
src/
├── BaseLogger.ts          # Core logger: settings, masking, formatting, transports
├── index.ts               # Logger class (extends BaseLogger), default log levels
├── index.browser.ts       # Browser entry point (Safari detection, CSS styling)
├── interfaces.ts          # All TypeScript interfaces and types
├── formatTemplate.ts      # Template string replacement
├── prettyLogStyles.ts     # Default pretty-print styles
└── internal/
    ├── environment.ts     # Runtime detection (Node, browser, Deno, Bun, worker)
    ├── stackTrace.ts      # Stack trace parsing
    ├── errorUtils.ts      # Error chain collection
    ├── metaFormatting.ts  # Metadata formatting for pretty output
    └── jsonStringifyRecursive.ts  # Circular-safe JSON serialization
```

**Log lifecycle:** `log()` → mask → toLogObj → addMeta → format → transport

**7 log levels:** silly(0), trace(1), debug(2), info(3), warn(4), error(5), fatal(6)

## Git Workflow

- **master** — stable releases, CI runs on push/PR
- **development** — active development branch
- Pre-commit hook via **Husky v9** (`.husky/pre-commit`) runs: test → check (biome) → build
- CI: GitHub Actions on Node 20 (coverage + browser), Bun (latest), Deno (v2.x); uploads to Codecov

## Publishing

- Uses **np** for releases (`npm run release`)
- Publishes from `dist/` directory (`publishConfig.directory: "dist"`)
- `scripts/prepare-publish.mjs` copies package.json/LICENSE/README into dist with adjusted paths
- Supports: Node.js (ESM/CJS), browsers (IIFE), Deno, Bun, React Native

## Key Conventions

- Node.js 16+ required (`.nvmrc`)
- npm only (engine-strict in `.npmrc`)
- No additional runtime dependencies
- TypeScript strict mode throughout
- Tests are numbered by feature area (e.g., `1_json_loglevel`, `5_pretty_Log_Types`)
- Browser-specific code isolated in `index.browser.ts` and `tests/support/`

## Quality Standards

- Target **100% test coverage** — but only with meaningful tests, no padding
- Every new feature **must** have corresponding tests
- Every new feature **must** be reflected in the docs (`docs/`)
- Don't write tests just to hit coverage numbers; each test should verify real behavior