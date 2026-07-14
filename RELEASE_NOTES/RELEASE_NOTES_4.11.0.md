# tslog 4.11.0

This is a feature-and-fix release with **no breaking changes** — a clean upgrade from any `4.10.x`. It adds several frequently-requested features, fixes a batch of reported bugs, and makes code-position detection work identically across every runtime. It's also the last `4.x` feature release before **v5** (see *What's next* below).

## Highlights

### Code position now works the same everywhere
Previously the browser build relied on hardcoded stack depths (a special case for Safari vs. everything else), which was brittle as engines evolved. tslog now uses a single, pattern-based detection that finds the first stack frame outside the library — and it's verified to land on the right caller across **Node, Bun, Deno, web workers, Chrome, and Safari/WebKit**. You get accurate file:line in every runtime with zero configuration, and manual `stackDepthLevel` overrides still work.

If you wrap tslog in your own logger, the new **`internalFramePatterns`** setting lets you mark your wrapper's frames as "internal" so logs point at *your* caller, not your wrapper:

```ts
const logger = new Logger({ internalFramePatterns: [/my-logging-lib/] });
```

### Route log levels to specific console methods
`prettyLogLevelMethod` maps each level to a `console` method — great for browser DevTools filtering and log collectors:

```ts
const logger = new Logger({
  type: "pretty",
  prettyLogLevelMethod: {
    WARN: console.warn,
    ERROR: console.error,
    FATAL: console.error,
    "*": console.log,
  },
});
```

### Typed default log levels
The default levels are now exported as a `DefaultLogLevels` enum, so you can write `minLevel: DefaultLogLevels.WARN` instead of a magic number.

### Extend the default meta in custom `addMeta`
With `overwrite.includeDefaultMetaInAddMeta: true`, your custom `addMeta` handler receives the default runtime meta as a fourth argument, so you can add to it instead of rebuilding it.

### Logging never takes down your app
Attached transports now run in isolation — a transport that throws (a flaky network sink, say) no longer crashes logging or stops your other transports and console output. The error is reported via `console.error` and logging continues.

## Bug fixes

- **BigInt** values now print as `100n` instead of an empty `{}`. (#334)
- **Invalid `Date`** values render as `Invalid Date` instead of throwing `RangeError`. (#266)
- **Local-timezone timestamps** (`{{rawIsoStr}}`) now carry the correct offset (e.g. `+02:00`) instead of a misleading `Z`. (#207)
- **Web workers** (notably in Firefox) get proper CSS styling instead of leaking ANSI control characters into the console. (#262)
- **`prettyInspectOptions`** (`depth`, `colors`, …) are now actually applied. (#331, #285, #327)
- **Secret masking** is safer: `maskValuesRegEx` placeholders containing `$1`/`$&` are inserted literally (no accidental leak via regex substitution), and numeric `maskValuesOfKeys` now match correctly.
- **Pretty error formatting** no longer crashes on errors with null-prototype properties or hostile `toString`/`Symbol.toPrimitive`. (#335, #294)
- **Types:** `IMetaStatic` now exposes `hostname`, `runtimeVersion`, and `browser` (no more casts); `IPrettyLogStyles` includes `fileNameWithLine`. (#268, #310)

## Under the hood

- Test toolchain moved to **Vitest + Playwright**, with a cross-runtime suite and a per-engine browser matrix (Chromium, Firefox, WebKit) and 100% coverage on the measured source.
- Linting/formatting moved to **Biome**; docs moved to **Starlight**; git hooks to **Husky v9**.

## Upgrading

`npm install tslog@4.11.0` — no code changes required. If you previously passed a custom `stackDepthLevel` to work around the Safari frame-count, you can likely remove it; auto-detection now handles it.

---

## What's next: v5

v5 is a **major release with breaking changes**, focused on performance, modularity, and a cleaner API. Direction (subject to change):

- **Up to ~10× faster** in production by making stack capture lazy/opt-out — the call-site lookup, not the rest of the pipeline, is the dominant cost today.
- **Smaller bundles via tree-shaking** — JSON-only and Node users stop shipping the browser inspect polyfill and CSS styling they never run.
- **Smarter secret redaction** — optional JSON-path redaction (e.g. `user.password`) that avoids the blind deep-clone, with safer, explicit defaults (no more silent `password`-only masking).
- **Leaner API** — merged/grouped settings, async transports, and a cleaner extensibility model.

We'll publish a migration guide with v5. 4.11.0 is a safe place to sit until then.
