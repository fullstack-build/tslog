# Migrating from tslog v4 to v5

> [!IMPORTANT]
> **4.11.0 is the safe staying point. Stay on it until you are ready to follow this guide — do not pressure-upgrade.**
>
> Most of the v5 performance wins and the GitHub-issue fixes were back-ported into **tslog 4.11.0**: the
> faster lazy stack capture, the transport isolation hardening, the masking `$`-escape and numeric-key
> fixes, and the new 4.11.0 settings all ship there with **zero breaking changes**. If you are on the 4.x
> line today, `npm install tslog@4.11.0` gets you those wins for free and keeps your existing settings,
> CJS `require`, Node 16+, and JSON shape exactly as they are.
>
> v5 is a deliberate, breaking redesign (ESM-only, grouped settings, a new default JSON shape, middleware
> instead of `overwrite.*`). Upgrade to v5 when you actually want the new capabilities below — not because
> a number changed. There is no deprecation pressure: 4.11.0 is a fine place to live for a long time.

---

## What's new in v5 / why upgrade

You should upgrade to v5 when you want one or more of these. None of them exist on the 4.x line.

- **Environment-aware default output.** `new Logger()` and the ready-made `log` are now **pretty in an
  interactive TTY and JSON in CI / non-TTY / `NO_COLOR`** — the right thing in both dev and prod with no
  config. (v4 was always `pretty`.)
- **Flat, fields-first JSON.** The default `type: "json"` output is now a flat, observability-friendly
  object — `message` / `level` / `levelId` / `time` at the top level, your fields spread next to them,
  runtime metadata nested under `_meta` with a `v: 5` schema version. No more positional args under
  numeric keys or the level buried inside `_meta`. Every key name is configurable via the `json` group
  (`messageKey`, `levelKey`, `timeKey`, `errorKey`, …).
- **Drop-in presets** (tree-shakeable subpaths, off by default):
  - `tslog/presets/pino` — `pinoFormat()` / `pinoTransport()` emit pino-compatible NDJSON (numeric
    `level`, `time` ms epoch, `msg`), so existing pino tooling (`pino-pretty`, transports) keeps working.
  - `tslog/otel` — `otelFormat()` / `otelTraceContext()` emit OpenTelemetry log records with the right
    `SeverityNumber` and trace/span correlation.
  - `tslog/presets/genai` — `genai()` / `genaiAttributes()` / `genaiSummary()` build GenAI/agentic
    semantic-convention attributes (model, tokens, tool calls) for LLM apps.
- **JSONPath-lite masking.** The `mask` group adds `paths` (dotted paths with `*` wildcards, e.g.
  `"user.password"`, `"*.token"`) alongside key/regex masking, plus a per-match `censor` that can be a
  replacement string, `"remove"`, a function, or **`"hash"`** — a fast, synchronous, non-cryptographic
  correlation token (`"[hash:1a2b3c4d]"`) so you can correlate a redacted secret across logs without
  exposing it.
- **Async-context propagation (ALS).** `logger.runInContext(ctx, fn)` / `logger.getContext()` thread
  request/trace fields onto every log's `_meta` across `await`, timers, and nested calls (Node/Bun/Deno;
  graceful no-op on browsers/edge).
- **Async transports + lifecycle.** `attachTransport` accepts a full `Transport` (per-transport
  `minLevel`, `format`, async `write`, `flush`, `[Symbol.asyncDispose]`) **and returns a detach
  function**. `logger.flush()` drains buffered transports; `await using log = new Logger()` disposes them.
  First-class file (`tslog/transports/file`), HTTP/NDJSON (`tslog/transports/http`), and ring-buffer
  (`tslog/transports/ringbuffer`) transports ship as subpaths.
- **Middleware via `logger.use(...)`.** A single composable chain replaces the eight `overwrite.*` hooks:
  enrich, rewrite, sample, or drop a log. Plus exported, tree-shakeable middleware (`serialize(...)` for
  pino-style serializers, `otelTraceContext(...)`).
- **Faster lazy stack capture.** Stack frames are parsed only when actually needed, driven by the
  `stack.capture` mode (`"off" | "lazy" | "auto" | "full"`); JSON defaults to `"off"`, pretty to `"auto"`.
- **Tree-shakeable subpath architecture & zero import-time side effects** (`sideEffects: false`): the core
  stays tiny and presets/transports/serializers/testing/box are pulled in only when imported.
- **Better AI / agentic DX.** Fields-first call signatures (`log.info({ userId: 42 }, "msg")`), additive
  custom levels (`customLevels`), `Logger.fromEnv()`, strict-config validation (`strictConfig` →
  `TslogConfigError`), a `tslog/testing` helper, and a `tslog/pretty/box` renderer.

---

## Prerequisites & install

| | v4 | v5 |
|---|---|---|
| Module system | ESM **and** CJS (`require` worked) | **ESM-only** — no CJS, no `require` |
| Node.js | 16+ | **20+** |
| TS target | es2020 | **es2022** |
| Runtime deps | none | none |

```bash
npm install tslog@5
```

v5 publishes **ESM only** with conditional exports. There is no `dist/cjs` and no `require("tslog")`.

```js
// v4 (CommonJS) — NO LONGER SUPPORTED in v5
const { Logger } = require("tslog");

// v5 — ESM import
import { Logger } from "tslog";
```

If you cannot move your app to ESM yet, **stay on 4.11.0**. The interop options for an ESM-only dependency
from a CJS file are a dynamic `import()` (`const { Logger } = await import("tslog")`) or a bundler —
neither is required if you remain on 4.x.

Set your `tsconfig.json` to es2022 and a NodeNext module resolution, and write relative imports with `.js`
extensions if you author ESM TypeScript.

---

## 1. ESM-only

**Breaking:** v5 ships no CommonJS build. `require("tslog")` throws.

```js
// BEFORE (v4, CJS)
const { Logger, log } = require("tslog");

// AFTER (v5, ESM)
import { Logger, log } from "tslog";
```

The package root (`tslog`) resolves, via conditional exports, to the universal build, which auto-detects
Node, browsers, Deno, Bun, and workers at construction time. The named exports are unchanged: `Logger`,
`BaseLogger`, the ready-made `log` instance, and all interface/enum types.

---

## 2. Flat settings → grouped settings (full mapping table)

**Breaking:** every flat `prettyLog*` / `maskValues*` / `stack*` / `meta*` key is gone. Settings are now
organized into the `pretty`, `json`, `mask`, `stack`, and `meta` groups, with a handful of top-level keys
(`type`, `name`, `minLevel`, `customLevels`, `middleware`, `prefix`, `attachedTransports`,
`strictConfig`, …). **There is no flat-key fallback** — an old flat key is silently ignored.

```ts
// BEFORE (v4) — flat keys
const log = new Logger({
  type: "pretty",
  minLevel: "warn",
  prettyLogTimeZone: "local",
  stylePrettyLogs: true,
  prettyLogTemplate: "{{logLevelName}}\t{{filePathWithLine}}\t",
  maskValuesOfKeys: ["password", "apiKey"],
  maskValuesOfKeysCaseInsensitive: true,
  maskPlaceholder: "[REDACTED]",
  metaProperty: "$meta",
});

// AFTER (v5) — grouped
const log = new Logger({
  type: "pretty",
  minLevel: "WARN",
  pretty: {
    timeZone: "local",
    style: true,
    template: "{{logLevelName}}\t{{filePathWithLine}}\t",
  },
  mask: {
    keys: ["password", "apiKey"],
    caseInsensitive: true,
    placeholder: "[REDACTED]",
  },
  meta: { property: "$meta" },
});
```

### Mapping table — every v4 flat key → v5 grouped path

| v4 flat key | v5 grouped path |
|---|---|
| `type` | `type` *(unchanged top-level; default now env-aware — see §6)* |
| `name` | `name` *(unchanged)* |
| `parentNames` | `parentNames` *(unchanged)* |
| `minLevel` | `minLevel` *(unchanged; still accepts a name or numeric id)* |
| `argumentsArrayName` | `argumentsArrayName` *(unchanged)* |
| `prefix` | `prefix` *(unchanged)* |
| `prettyLogTemplate` | `pretty.template` |
| `prettyErrorTemplate` | `pretty.errorTemplate` |
| `prettyErrorStackTemplate` | `pretty.errorStackTemplate` |
| `prettyErrorParentNamesSeparator` | `pretty.errorParentNamesSeparator` |
| `prettyErrorLoggerNameDelimiter` | `pretty.errorLoggerNameDelimiter` |
| `stylePrettyLogs` | `pretty.style` |
| `prettyLogTimeZone` | `pretty.timeZone` |
| `prettyLogStyles` | `pretty.styles` |
| `prettyInspectOptions` | `pretty.inspectOptions` |
| *(new)* | `pretty.enabled` — explicit pretty on/off, overriding the env-aware default |
| *(new)* | `pretty.levelMethod` — map a level name (or `"*"`) to a `console` method |
| `maskValuesOfKeys` | `mask.keys` — **default is now `[]` (masking OFF); see §5** |
| `maskValuesOfKeysCaseInsensitive` | `mask.caseInsensitive` |
| `maskValuesRegEx` | `mask.regex` |
| `maskPlaceholder` | `mask.placeholder` |
| *(new)* | `mask.paths` — JSONPath-lite dotted paths with `*` wildcards |
| *(new)* | `mask.censor` — `"remove"` / `"hash"` / replacement string / function |
| *(new)* | `mask.hashLabel` — label inside the `"hash"` token (`"[<label>:…]"`) |
| `metaProperty` | `meta.property` |
| *(new)* | `meta.attachContext` — async-context auto-attach (default `true`) |
| `hideLogPositionForProduction` | **REMOVED → `stack.capture: "off"`** (or leave default `"auto"`); see §3 |
| `stackDepthLevel` *(constructor arg)* | **renamed → `callerFrame`** (constructor arg); see §7 |
| *(new)* | `stack.capture` — `"off" \| "lazy" \| "auto" \| "full"` |
| *(new)* | `stack.internalFramePatterns` — extra wrapper-file patterns |
| *(new)* | `json.messageKey` / `levelKey` / `levelIdKey` / `timeKey` / `errorKey` |
| *(new)* | `json.numericLevel` / `json.stableKeyOrder` |
| `attachedTransports` | `attachedTransports` *(now `Transport \| TransportFn`; see §8)* |
| `overwrite.*` | **REMOVED → `middleware` / `logger.use()` / per-transport `format`; see §4** |
| *(new)* | `middleware` — middleware chain seed |
| *(new)* | `customLevels` — additive custom levels |
| *(new)* | `strictConfig` — throw `TslogConfigError` on misconfiguration |

> Tip: `defineConfig({ ... })` (re-exported from `tslog`) gives you a typed, autocompleted settings object
> you can share across loggers and validate against the grouped shape.

---

## 3. `hideLogPositionForProduction` removed

**Breaking:** the boolean is gone. Code-position capture is now controlled by `stack.capture`.

```ts
// BEFORE (v4)
const log = new Logger({ type: "json", hideLogPositionForProduction: true });

// AFTER (v5) — never capture a stack (cheapest)
const log = new Logger({ type: "json", stack: { capture: "off" } });
```

`stack.capture` modes:

- `"off"` — never capture (equivalent to the old `hideLogPositionForProduction: true`); the default for
  `type: "json"`.
- `"lazy"` — capture the `Error` cheaply, parse frames only on first read of `_meta.path`.
- `"auto"` — capture only when the pretty template references a code-position placeholder; the default for
  `type: "pretty"`.
- `"full"` — always capture and parse eagerly.

If you set `type: "json"` you already get `"off"` by default, so most production configs can simply drop
`hideLogPositionForProduction` with no replacement.

---

## 4. `overwrite.*` hooks removed → `logger.use()` middleware + per-transport `format`

**Breaking:** the entire `overwrite` object (`mask`, `toLogObj`, `addMeta`, `addPlaceholders`,
`formatMeta`, `formatLogObj`, `transportFormatted`, `transportJSON`) is gone. Its responsibilities split
cleanly into two well-defined extension points:

- **`logger.use(middleware)`** (or the `middleware: []` seed) — runs on every log *before* the record is
  built. Enrich/rewrite the `LogContext` (`logLevelId`, `logLevelName`, `args`, `meta`) or drop the log by
  returning `null` / `false`.
- **A custom `Transport` with a `format` / `write`** — owns turning the finished record into a line and
  sending it somewhere. Use a per-transport `format` (a `LogFormatter`) for output shape, and `write` for
  the sink.

### Hook-by-hook mapping

| v4 `overwrite.*` hook | v5 replacement |
|---|---|
| `overwrite.mask(args)` | A `middleware` that rewrites `ctx.args`, or the built-in `mask` group / `serialize()` middleware. |
| `overwrite.toLogObj(args, logObj)` | A `middleware` that rewrites `ctx.args` into the shape you want. |
| `overwrite.addMeta(logObj, id, name)` | A `middleware` that writes onto `ctx.meta` (attached under `_meta`). |
| `overwrite.addPlaceholders(meta, values)` | A `middleware` that stashes values on `ctx.meta` for a formatter to read. |
| `overwrite.formatMeta(meta)` | A custom `LogFormatter` (per-transport `format`) or `pretty.template`. |
| `overwrite.formatLogObj(args, settings)` | A custom `LogFormatter` (per-transport `format`). |
| `overwrite.transportFormatted(markup, …)` | A `Transport` whose `format` produces the line and `write` consumes it. |
| `overwrite.transportJSON(json)` | A `Transport` with `format: "json"` (or a custom formatter) and `write`. |

### Examples

Enrich every log and drop everything below INFO:

```ts
// BEFORE (v4)
const log = new Logger({
  overwrite: {
    addMeta: (logObj, id, name) => {
      (logObj as any)._meta = { traceId: getTraceId() };
      return logObj as any;
    },
  },
});

// AFTER (v5)
const log = new Logger();
log.use((ctx) => {
  ctx.meta.traceId = getTraceId();      // ends up under _meta
  return ctx.logLevelId >= 3 ? ctx : null; // drop below INFO
});
```

Custom transport output shape (replaces `transportFormatted` / `transportJSON`):

```ts
// BEFORE (v4)
const log = new Logger({
  overwrite: {
    transportJSON: (json) => myBackend.send(json),
  },
});

// AFTER (v5)
import type { LogFormatter } from "tslog";

const log = new Logger();
log.attachTransport({
  name: "backend",
  format: "json",                          // or a custom LogFormatter
  write: (_record, line) => myBackend.send(line),
});
```

A custom per-transport formatter (replaces `formatLogObj` / `formatMeta`):

```ts
import type { LogFormatter } from "tslog";

const csv: LogFormatter<MyLog> = (record, settings) => {
  const meta = record[settings.meta.property];
  return `${meta.logLevelName},${meta.date.toISOString()}`;
};

log.attachTransport({ name: "csv", format: csv, write: (_r, line) => append(line) });
```

---

## 5. Masking is now OFF by default

**Breaking behavior change:** v4 shipped with `maskValuesOfKeys: ["password"]` — passwords were masked out
of the box. v5's `mask.keys` defaults to `[]`, so **nothing is masked unless you opt in**.

```ts
// BEFORE (v4) — "password" masked implicitly
const log = new Logger();
log.info({ password: "hunter2" }); // → password rendered as [***]

// AFTER (v5) — masking OFF unless configured
const log = new Logger({
  mask: { keys: ["password", "apiKey", "authorization", "token"] },
});
log.info({ password: "hunter2" }); // → password rendered as [***]
```

**Audit every logger and set `mask.keys` (and/or `mask.paths`) explicitly.** If you relied on the implicit
`"password"` masking, you must add it back — silently logging plaintext passwords is the failure mode here.

New v5 masking capabilities you may want while you are in there:

```ts
const log = new Logger({
  mask: {
    keys: ["password", "apiKey", "prompt"],   // key masking
    caseInsensitive: true,                      // also masks "Password"/"PASSWORD"
    paths: ["user.password", "*.token"],        // JSONPath-lite (M*: dotted, * = one segment)
    regex: [/\b[A-Za-z0-9]{32,}\b/g],           // long token-like strings
    censor: "hash",                             // "[hash:1a2b3c4d]" correlation token
    hashLabel: "id",                            // → "[id:1a2b3c4d]"
  },
});
```

`censor` accepts a replacement string, `"remove"` (delete the key), `"hash"` (a fast, synchronous,
**non-cryptographic** correlation token — same value always hashes to the same token, never use it as a
security primitive), or a function `(value, path) => unknown`.

---

## 6. Default `type` is now environment-aware

**Breaking behavior change:** v4's default `type` was always `"pretty"`. In v5, both `new Logger()` and the
ready-made `log` instance resolve the default `type` from the environment:

- interactive **TTY** → `"pretty"` (colorized)
- **CI / non-TTY / `NO_COLOR`** → `"json"` (structured)

```ts
// BEFORE (v4) — always pretty, even when piped to a file or in CI
const log = new Logger();

// AFTER (v5) — pretty in a TTY, JSON otherwise
const log = new Logger();

// Force a specific format explicitly when you need determinism:
const pretty = new Logger({ type: "pretty" });
const json   = new Logger({ type: "json" });
// or via the pretty group, leaving the env-default for everything else:
const maybePretty = new Logger({ pretty: { enabled: false } }); // → falls back to json
```

If your tests or downstream parsers assumed pretty output everywhere, set `type: "pretty"` explicitly. If
they assumed your CI logs were already pretty, note they will now be JSON unless forced.

---

## 7. Default JSON shape changed (flat, fields-first, `_meta.v: 5`)

**Breaking behavior change:** the structured (`type: "json"`) output is a different shape. **Update your
log parsers, queries, dashboards, and alerts.**

v4 produced a near-1:1 `JSON.stringify` of the internal log object: positional args under numeric keys,
the message buried under `"0"`, the level only reachable inside `_meta`.

```jsonc
// BEFORE (v4) — log.info("user logged in", { userId: 42 })
{
  "0": "user logged in",
  "1": { "userId": 42 },
  "_meta": {
    "runtime": "Nodejs",
    "logLevelId": 3,
    "logLevelName": "INFO",
    "date": "2026-06-29T10:11:12.000Z",
    "path": { /* ... */ }
  }
}
```

```jsonc
// AFTER (v5) — log.info("user logged in", { userId: 42 })
{
  "message": "user logged in",   // configurable: json.messageKey
  "level": "INFO",               // the level NAME: json.levelKey
  "levelId": 3,                  // the numeric id: json.levelIdKey (only when json.numericLevel)
  "time": "2026-06-29T10:11:12.000Z", // ISO timestamp from _meta.date: json.timeKey
  "userId": 42,                  // your own fields spread at the top level
  "_meta": {                     // runtime meta, key name from meta.property
    "v": 5,                       // schema version
    "runtime": "Nodejs",
    "logLevelId": 3,
    "logLevelName": "INFO",
    "path": { /* ... */ }
  }
}
```

Query migration (jq examples):

```diff
- # v4: message and level
- jq '."0"'            # message
- jq '._meta.logLevelName'  # level
+ # v5
+ jq '.message'
+ jq '.level'
```

Call-site mapping in v5:

- `log.info("hi")` → `{ message: "hi" }`.
- `log.info({ userId: 42 })` → fields spread: `{ userId: 42 }`.
- `log.info({ userId: 42 }, "hi")` (pino-style fields-first) → `{ message: "hi", userId: 42 }`.
- `log.info("hi", a, b)` → `{ message: "hi", "1": a, "2": b }` (or all under `argumentsArrayName` when set).
- Any logged `Error`(s) → under `error` (`json.errorKey`), serialized with the `cause` chain preserved.

Every key name is configurable via the `json` group — to match pino, ECS, etc.:

```ts
// pino-style head keys
new Logger({ type: "json", json: { messageKey: "msg", levelKey: "level", timeKey: "time", numericLevel: true } });

// Elastic Common Schema-ish
new Logger({ type: "json", json: { levelKey: "log.level", timeKey: "@timestamp", numericLevel: false } });
```

Or skip manual key-mapping entirely and use the pino preset, which emits pino-compatible NDJSON:

```ts
import { pinoTransport } from "tslog/presets/pino";
const log = new Logger({ type: "hidden" });
log.attachTransport(pinoTransport((line) => process.stdout.write(`${line}\n`)));
```

---

## 8. `stackDepthLevel` → `callerFrame`; `loggerEnvironment` removed (BC11)

**Breaking:** the manual stack-frame index constructor argument was renamed `stackDepthLevel` → `callerFrame`.

```ts
// BEFORE (v4) — 4th constructor arg
class MyLogger<T> extends Logger<T> {
  constructor(s?: ISettingsParam<T>, o?: T) {
    super(s, o, undefined, 5); // stackDepthLevel = 5
  }
}

// AFTER (v5) — same position, renamed concept (callerFrame); NaN = auto-detect
class MyLogger<T> extends BaseLogger<T> {
  constructor(s?: ISettingsParam<T>, o?: T) {
    super(s, o, getEnvironment(), 5); // callerFrame = 5
  }
}
```

For the common "my wrapper file should report its caller's position" case, prefer the declarative
`stack.internalFramePatterns` instead of a hand-counted frame index:

```ts
const log = new Logger({ stack: { internalFramePatterns: [/myLogger\.ts/] } });
```

**Also removed (BC11):** the module-level `loggerEnvironment` / `createLoggerEnvironment` exports. The
runtime environment is now an injected provider (the Node/browser/universal builds wire it in for you via
the package's conditional exports), not a singleton you import and mutate. If you imported
`loggerEnvironment` to stub the runtime in tests, use the `tslog/testing` helpers
(`createTestLogger` / `mockLogger`) or inject a provider into `BaseLogger` directly.

---

## 9. `attachTransport` is more powerful (detach, async, per-transport level/format)

**Behavior change (mostly additive, but the signature is richer):** `attachTransport` now accepts a full
`Transport` **or** a bare `TransportFn`, and **returns a detach function**. v4's bare-function callback
still works (it is wrapped into a `Transport` with no `flush`).

```ts
// BEFORE (v4) — bare function, no way to detach
log.attachTransport((logObj) => myQueue.push(logObj));

// AFTER (v5) — still works, now returns a detach fn
const detach = log.attachTransport((record) => myQueue.push(record));
detach(); // stop receiving logs

// AFTER (v5) — a full transport: own level, own format, flush, async dispose
const detach2 = log.attachTransport({
  name: "file",
  minLevel: "WARN",          // this sink only sees WARN and above
  format: "json",            // receives a JSON line regardless of the logger's `type`
  write: (_record, line) => { buffer.push(line); },
  flush: async () => { await fs.appendFile("app.log", buffer.join("\n")); buffer.length = 0; },
});
```

New lifecycle methods:

```ts
await log.flush();                 // drain every transport's flush()

// scoped disposal (drains + disposes transports on scope exit)
await using log = new Logger();
log.attachTransport(bufferedTransport);
// ...logs...
// flush + dispose happen automatically at scope end
```

Ready-made transports (tree-shakeable subpaths):

```ts
import { fileTransport } from "tslog/transports/file";
import { httpTransport } from "tslog/transports/http";
import { ringBufferTransport } from "tslog/transports/ringbuffer";
```

---

## Migration checklist

- [ ] Move the app (or the file importing tslog) to **ESM**; bump Node to **20+**, TS target to **es2022**.
- [ ] Replace `require("tslog")` with `import`.
- [ ] Translate every flat setting key to its **grouped path** (table in §2).
- [ ] Replace `hideLogPositionForProduction` with `stack.capture: "off"` (or drop it for `type: "json"`).
- [ ] Replace every `overwrite.*` hook with `logger.use(...)` middleware and/or a custom `Transport`/`format` (§4).
- [ ] **Re-add masking explicitly** — set `mask.keys` (and/or `mask.paths`); v5 masks nothing by default (§5).
- [ ] Decide whether you want the env-aware default `type` or an explicit `type` (§6).
- [ ] **Update JSON log parsers/queries/dashboards** for the flat, fields-first shape with `_meta.v: 5` (§7).
- [ ] Rename the `stackDepthLevel` constructor arg to `callerFrame`; drop `loggerEnvironment` imports (§8).
- [ ] Capture `attachTransport`'s detach fn where you need teardown; adopt `flush()` / `await using` for
      buffered/async transports (§9).
- [ ] (Optional) Adopt presets (`tslog/presets/pino`, `tslog/otel`, `tslog/presets/genai`), `tslog/testing`,
      `Logger.fromEnv()`, `customLevels`, and `strictConfig`.

---

If any of this is more churn than you have appetite for right now, that is fine — **stay on tslog 4.11.0**,
which already has the performance and bug-fix wins, and migrate to v5 when the new capabilities are worth
it to you.
