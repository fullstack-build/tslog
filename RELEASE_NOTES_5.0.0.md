# tslog 5.0.0

tslog v5 is a ground-up, ESM-only rewrite for modern runtimes: **readable pretty output everywhere by default** (colored on a TTY, uncolored when piped), with **structured JSON one opt-in away** for prod. The core is small and tree-shakeable, presets and transports live behind opt-in subpaths, and the default JSON shape is flat, fields-first, and built to drop straight into observability backends and AI/agentic ingestion. It is a **major release with breaking changes**.

> [!IMPORTANT]
> **4.11.0 is a safe place to stay — do not pressure-upgrade.** Most of the v5 performance wins and the GitHub-issue fixes were back-ported into **tslog 4.11.0** (faster lazy stack capture, transport isolation, the masking `$`-escape and numeric-key fixes) with **zero breaking changes** and your CJS `require`, Node 16+, settings, and JSON shape untouched. Move to v5 when you actually want the new capabilities below — not because a number changed.

## Highlights

### Readable pretty output by default, env-aware colorization
`new Logger()` and the ready-made `log` render **pretty everywhere** — server, CI, browser, and React Native. Only the coloring adapts to the environment: colored on an interactive TTY (CSS in the browser), and uncolored when stdout is piped/redirected/CI, so no ANSI escapes leak into files or log collectors. `NO_COLOR` strips colors without switching the format; `FORCE_COLOR` forces styled pretty. Structured JSON is an explicit opt-in — set `type: "json"`, `TSLOG_TYPE=json`, or attach a JSON transport.

```ts
import { log } from "tslog";
log.info({ userId: 42 }, "request handled"); // pretty everywhere — colored in your terminal, uncolored when piped
```

### Flat, fields-first JSON with `_logMeta.v: 5`
The default `type: "json"` output is a flat, observability-friendly record: `message` / `level` / `levelId` / `time` promoted to the top level, your fields spread next to them, and runtime metadata nested under a versioned `_logMeta`. No positional args under numeric keys, no level buried inside meta.

```ts
log.info({ userId: 42 }, "hi");
// {"message":"hi","level":"INFO","levelId":3,"time":"2026-06-29T22:40:05.935Z","userId":42,
//  "_logMeta":{"v":5,"date":"...","hostname":"...","logLevelId":3,"logLevelName":"INFO","runtime":"node","runtimeVersion":"24.15.0"}}
```

Every key is configurable via the `json` group (`messageKey`, `levelKey`, `levelIdKey`, `timeKey`, `errorKey`, `numericLevel`, `stableKeyOrder`).

### Grouped settings
Settings are organized into groups instead of a flat bag of `prettyLog*` / `maskValues*` keys: `pretty`, `json`, `mask`, `stack`, and `meta`, alongside top-level `type`, `name`, `minLevel`, `customLevels`, and friends.

```ts
const logger = new Logger({
  type: "json",
  json: { messageKey: "msg", numericLevel: true },
  mask: { paths: ["user.password", "*.token"], censor: "hash" },
  stack: { capture: "off" },
});
```

### Middleware replaces `overwrite.*`
A single composable chain replaces the eight `overwrite.*` hooks. Enrich, rewrite, sample, or drop a log — return the context, or `null`/`false` to drop it.

```ts
logger.use((ctx) => {
  ctx.meta.region = process.env.REGION;
  return ctx; // return null/false to drop the log
});
```

### Async transports, flush, and per-transport level/format
`attachTransport` accepts a full `Transport` — with per-transport `minLevel`, `format` (`"pretty"` | `"json"` | a formatter), async `write`, `flush`, and `[Symbol.asyncDispose]` — and **returns a detach function**. `logger.flush()` drains buffered transports, and `await using log = new Logger()` disposes them on scope exit. First-class file, HTTP/NDJSON, and ring-buffer transports ship as subpaths.

```ts
const detach = logger.attachTransport({
  name: "errors", minLevel: "ERROR", format: "json",
  async write(record, line) { await sink(line); },
});
await logger.flush();
detach();
```

### JSONPath masking + hash censor
The `mask` group adds `paths` — dotted paths with `*` wildcards (`"user.password"`, `"*.token"`) — alongside `keys` and `regex`. A per-match `censor` can be a replacement string, `"remove"`, a function, or **`"hash"`**: a fast, synchronous, non-cryptographic correlation token so you can track a redacted secret across logs without exposing it. Note: masking is now **off by default** (no more silent `password`-only masking).

### First-class support for agents and LLMs
v5 treats agent and LLM apps as a primary use case, not an afterthought. Fields-first calls make structured, queryable tool-call and trace logs the natural default; `runInContext` threads an agent/session/request id onto every log across `await` boundaries; `isLevelEnabled()` guards expensive prompt/token payloads before you build them; and `tslog/presets/genai` — `genai()` / `genaiAttributes()` / `genaiSummary()` — emits OTel-GenAI `gen_ai.*` semantic-convention attributes (model, input/output tokens, tool calls) straight into your observability backend.

```ts
import { genai } from "tslog/presets/genai";
log.info(genai({ model: "claude", inputTokens: 318, outputTokens: 142 }), "completion");
```

[OpenClaw](https://openclaw.ai), an AI agent platform, uses tslog for its agent logging — its JSONL log pipeline carries agent, session, and trace context on every line.

### pino and OTel presets
Tree-shakeable, opt-in subpaths that emit other ecosystems' shapes:

- `tslog/presets/pino` — `pinoFormat()` / `pinoTransport()` emit pino-compatible NDJSON, so `pino-pretty` and pino transports keep working.
- `tslog/otel` — `otelFormat()` / `otelTraceContext()` produce OpenTelemetry log records with the right `SeverityNumber` and trace/span correlation.

### ALS correlation
`logger.runInContext(ctx, fn)` threads request/trace fields onto every log's `_logMeta` across `await`, timers, and nested calls when `meta.attachContext` is on (Node/Bun/Deno; graceful no-op on browsers/edge).

### Tree-shakeable subpaths
The core stays tiny; everything else is pulled in only when imported, with audited `sideEffects: false`:

`tslog/presets/pino`, `tslog/otel`, `tslog/presets/genai`, `tslog/transports/file`, `tslog/transports/http`, `tslog/transports/ringbuffer`, `tslog/serializers`, `tslog/pretty/box`, `tslog/lite`, `tslog/testing`, `tslog/throttle`, `tslog/console`, plus a `tslog` (also `tslog/cli`) NDJSON pretty-printer binary.

### A cleaner DX surface
- `logger.child(settings?, logObj?)` — alias for `getSubLogger`, names accumulate into `_logMeta.parentNames`.
- `logger.isLevelEnabled(level)` — guard expensive payloads.
- `Logger.fromEnv(overrides?)` — read `TSLOG_LEVEL` / `TSLOG_TYPE` / `TSLOG_NAME`.
- `defineConfig(...)` — validated, typed config (throws `TslogConfigError` under `strictConfig`).
- Fields-first signatures: `log.info({ userId: 42 }, "msg")` *and* `log.info("msg", ...args)` both work.
- `tslog/lite` (minimal console wrappers, native line numbers), `tslog/cli` (NDJSON pretty-printer), `tslog/testing` (`createTestLogger` / `mockLogger`).

### ESM-only, TypeScript 7, Node 20
ESM-only (no CJS, no `require`), built with TypeScript 7 (tsgo), targeting ES2022 on Node >=20, with **zero runtime dependencies** and per-runtime conditional exports (node/browser/worker/deno/bun). Native `util.inspect` on Node; the polyfill is shipped only where it is actually needed.

## Breaking changes

This is a major release. The headline breaks:

- **ESM-only** — no CJS build, no `require("tslog")`.
- **Node >=20**, TypeScript 7, ES2022.
- **Grouped settings** — flat keys like `prettyLogTemplate`, `stylePrettyLogs`, `maskValuesOfKeys`, `maskValuesRegEx`, `maskPlaceholder`, `metaProperty`, and `hideLogPositionForProduction` are gone; use the `pretty` / `json` / `mask` / `meta` groups.
- **`overwrite.*` hooks removed** — replaced by `logger.use()` middleware and per-transport `format`.
- **Piped pretty is now uncolored** — the default `type` is still `pretty` everywhere (unchanged from v4), but pretty output no longer emits ANSI color when stdout is piped/redirected/CI, so escapes no longer leak into files and log collectors. A cosmetic change only — the format never switches; JSON stays opt-in via `type: "json"`.
- **New default JSON shape** — flat, fields-first, `_logMeta.v: 5`; the old nested `{"0":msg}` shape is gone.
- **Masking is off by default** — no implicit `password` masking.
- **`stackDepthLevel` → `callerFrame`** (constructor param); the `loggerEnvironment` singleton is removed.

This is a summary — see **`MIGRATION_v4_to_v5.md`** for the full mapping table and per-feature migration steps.

## Performance

Honest numbers, not marketing. v5's richer, key-stable, flat JSON shape costs more per log than 4.11.0's single `JSON.stringify` of the raw record — roughly **~3.9× on a string and ~1.7× on a nested object** — and that is the point: it is what makes the output drop straight into observability backends. v5 stays competitive with or faster than winston, on par with bunyan, and far faster than anything running with stack capture on (turning stack capture off is the dominant lever, ~20×, and JSON defaults to off with a lazy `_logMeta.path` getter).

Full methodology, per-logger tables (vs pino · winston · bunyan · consola · loglevel), and the per-log time breakdown are in **`benchmarks/RESULTS.md`**.

## Upgrading

v5 is a deliberate, breaking redesign. Read the migration guide before you start: **`MIGRATION_v4_to_v5.md`** covers ESM-only, the flat-key → grouped-settings table, `overwrite.*` → middleware, masking-off-by-default, the new JSON shape, and `stackDepthLevel` → `callerFrame`.

If you are happy on 4.x, you can stay there: `npm install tslog@4.11.0` keeps your code unchanged and still gets most of the v5 performance and reliability work.

---

Thanks to everyone who filed issues, reproduced bugs, and pushed for a leaner, more modern tslog — the grouped settings, the flat JSON shape, the presets, and the tree-shakeable architecture all came out of that feedback. v5 is the logger we wanted to use ourselves: invisible config in dev, structured and correlatable in prod, and ready for the AI-shaped workloads people are running today.
