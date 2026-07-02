# Beautiful logging experience for TypeScript

[![lang: Typescript](https://img.shields.io/badge/Language-Typescript-Blue.svg?style=flat-square)](https://www.typescriptlang.org)
![License: MIT](https://img.shields.io/npm/l/tslog?logo=tslog&style=flat-square)
[![npm version](https://img.shields.io/npm/v/tslog?color=76c800&logoColor=76c800&style=flat-square)](https://www.npmjs.com/package/tslog)
![CI: GitHub](https://github.com/fullstack-build/tslog/actions/workflows/ci.yml/badge.svg)
[![codecov.io](https://codecov.io/github/fullstack-build/tslog/coverage.svg?branch=master)](https://codecov.io/github/fullstack-build/tslog?branch=master)
[![code style: biome](https://img.shields.io/badge/code_style-biome-60a5fa.svg?style=flat-square)](https://biomejs.dev)
[![](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/fullstack-build)
[![GitHub stars](https://img.shields.io/github/stars/fullstack-build/tslog.svg?style=social&label=Star)](https://github.com/fullstack-build/tslog)


> Powerful, fast and expressive logging for TypeScript and JavaScript

![tslog pretty output](https://raw.githubusercontent.com/fullstack-build/tslog/master/docs/assets/tslog.png "tslog pretty output in browser and Node.js")

> [!NOTE]
> **This is `tslog` v5.** It is a deliberate, breaking redesign — ESM-only, grouped settings, a new
> fields-first JSON shape, and middleware instead of `overwrite.*`. **If you are on the 4.x line, `4.11.0`
> is a safe place to stay** — most of the v5 performance wins were back-ported there with zero breaking
> changes. Upgrade when you want the new capabilities. See **[Upgrading from v4?](#upgrading-from-v4)**.


## Highlights

🏗 **Universal** — one logger for Node.js, the browser, Deno, Bun, workers and React Native<br>
🧱 **Structured, fields-first JSON** — flat, observability-ready output that drops straight into log pipelines<br>
🧭 **Env-aware output** — pretty in your terminal, JSON in CI / non-TTY / `NO_COLOR`, with no config<br>
🤖 **AI / agent friendly** — fields-first calls, an `llms.txt`, presets for OTel-GenAI, and request correlation<br>
🌳 **Tree-shakeable subpaths** — transports, presets and helpers ship as opt-in modules, `sideEffects: false`<br>
🪶 **Zero runtime dependencies** — nothing pulled into your bundle but `tslog` itself<br>
👮 **Fully typed** — written in TypeScript 7, native ESM, accurate source-mapped line numbers<br>
🙊 **Secret masking** — keys, JSONPath-lite paths, regex, and a hashing censor for correlation<br>
👨‍👧‍👦 **Sub-loggers with inheritance** — `child()` / `getSubLogger()` with merged settings and accumulated names<br>
🔌 **Pluggable transports & middleware** — per-transport level/format, a `use()` pipeline, `flush()` and disposal<br>
🤓 **Pretty errors & stack traces** — structured, fully serializable, lazy by default for speed<br>


## Example

```typescript
import { Logger } from "tslog";

// `new Logger()` is environment-aware: pretty + colorized in an interactive terminal,
// flat JSON in CI / non-TTY / when NO_COLOR is set. Omit `type` to get the right thing
// per environment, or set `type: "pretty" | "json" | "hidden"` to pin it.
const log = new Logger({ minLevel: "INFO" });

// Fields-first (pino-style) OR string-first — both overloads work:
log.info({ port: 3000 }, "server started");
log.info("server started");

// A child logger per request or agent — name, settings and fields are inherited.
// `child(...)` is an alias for `getSubLogger(...)`:
const requestLog = log.getSubLogger({ name: "agent:planner" });
requestLog.info({ tool: "search", durationMs: 142, tokens: 318 }, "tool call complete");
// JSON → {"message":"tool call complete","level":"INFO","levelId":3,"time":"…",
//         "tool":"search","durationMs":142,"tokens":318,
//         "_meta":{"v":5,"name":"agent:planner",…}}

// Keep secrets, PII and prompts out of your logs (settings are grouped under `mask`):
const safeLog = new Logger({
  type: "json",
  mask: {
    keys: ["password", "apiKey", "token", "prompt"],
    paths: ["user.password", "*.token"],
  },
});
safeLog.info({ user: { name: "Ada", password: "hunter2" } });
// → {"message":…,"user":{"name":"Ada","password":"[***]"}, …}
```


## [Become a Sponsor](https://github.com/sponsors/fullstack-build)
Donations help me allocate more time for my open source work.

[![](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/fullstack-build)


## Install

`tslog` is published to npm as a single ESM package. **How you pull it in depends on the runtime** — npm
for Node.js, `bun add` for Bun, an `npm:` specifier (or import map) for Deno, and a CDN URL for the browser:

| Runtime     | Install / import                                                  |
|-------------|-------------------------------------------------------------------|
| **Node.js** | `npm install tslog` → `import { Logger } from "tslog";`           |
| **Bun**     | `bun add tslog` → `import { Logger } from "tslog";`               |
| **Deno**    | no install step — `import { Logger } from "npm:tslog";`           |
| **Browser** | no install step — `import { Logger } from "https://esm.sh/tslog";`|

The per-runtime details are below.

> [!IMPORTANT]
> **tslog v5 is ESM-only and requires Node.js ≥ 20.** There is no CommonJS build and no `require("tslog")`.
> If you cannot move to ESM or off Node 16/18 yet, stay on **`tslog@4.11.0`** — it keeps CJS, Node 16+ and
> the v4 JSON shape. See **[Upgrading from v4?](#upgrading-from-v4)**.

### Node.js

```bash
npm install tslog
```

Set `"type": "module"` in your `package.json` and run Node with source maps for accurate line numbers:

```json5
{
  "name": "NAME",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p .",
    "start": "node --enable-source-maps dist/index.js"
  },
  "dependencies": {
    "tslog": "^5"
  }
}
```

After building (`npm run build`), start your app with `npm start`.

To run TypeScript directly, use a current ESM-aware runner, e.g.
`node --enable-source-maps --import tsx src/index.ts`.

### Deno

There is no install step in Deno — the `npm:` specifier pulls `tslog` from npm and caches it on first run
(or add it to an import map / `deno add npm:tslog` if you prefer a bare `"tslog"` import):

```ts
// main.ts
import { Logger } from "npm:tslog";

const logger = new Logger();
logger.info("Hello from Deno");
```

```bash
deno run main.ts
# grant optional metadata access: deno run --allow-env main.ts
```

### Bun

Add the package with Bun's own installer, then import it by name:

```bash
bun add tslog
```

```ts
// main.ts
import { Logger } from "tslog";

const logger = new Logger();
logger.info("Hello from Bun");
```

```bash
bun run main.ts
```

### Browser

```html
<script type="module">
  import { Logger } from "https://esm.sh/tslog";
  const logger = new Logger();
  logger.silly("I am a silly log.");
</script>
```

A prebuilt IIFE bundle is also published for `<script src="tslog.js">` usage, exposing the global
`window.tslog`. In the browser, env-aware output renders pretty logs with CSS styling.

**Enable TypeScript source-map support** so `tslog` can point at the correct line in your source:

```json5
// tsconfig.json
{
  compilerOptions: {
    "inlineSourceMap": true, // <!-- here
    "target": "es2022",
  },
}
```


## Comparison with other loggers

How `tslog` compares to the most popular JavaScript loggers. **This table looks only at what each
library does in its core package, out of the box** — because most of these can be extended with
plugins, and a fair comparison has to draw the line somewhere. The line is "what you get from a fresh
`install` with no extra packages."

**Legend:** ✅ built-in / on by default · ➕ available, but only by adding a separate plugin or package ·
🟡 partial / manual / needs hand-rolling · ❌ not available

| Feature (core package only)            | **tslog**               | pino             | winston           | bunyan           | consola        |
|----------------------------------------|-------------------------|------------------|-------------------|------------------|----------------|
| Runtime dependencies                   | **0**                   | many             | many              | heavy (native)   | 0 (bundled)    |
| Universal (Node + browser + Deno/Bun)  | ✅                      | 🟡 polyfill      | ❌ Node-only      | ❌ Node-only     | ✅             |
| Pretty output **in-process**           | ✅                      | ➕ `pino-pretty` | ✅                | ➕ CLI pipe      | ✅             |
| Structured, fields-first JSON          | ✅                      | ✅               | 🟡 via formats    | ✅               | ❌             |
| Env-aware output (pretty ↔ JSON)       | ✅                      | ❌               | ❌                | ❌               | 🟡 fancy↔basic |
| Secret masking / redaction             | ✅ keys · paths · regex | ✅ paths         | 🟡 manual format  | ❌               | ❌             |
| Pretty errors + stack traces           | ✅                      | 🟡               | 🟡                | 🟡               | 🟡             |
| Source-mapped call-site line numbers   | ✅                      | ❌               | ❌                | 🟡 `src` (slow)  | 🟡             |
| Sub-loggers with inherited settings    | ✅                      | 🟡 bound fields  | 🟡 child fields   | 🟡 bound fields  | ❌             |
| Per-transport level / format           | ✅                      | 🟡 per-target    | ✅                | 🟡 per-stream    | ❌             |
| `flush()` / disposal                   | ✅                      | ✅               | ❌                | ❌               | ❌             |
| Async-context correlation (ALS)        | ✅                      | ➕ `pino-http`   | ➕                | ❌               | ❌             |
| OpenTelemetry / GenAI presets          | ✅                      | ➕               | ➕                | ❌               | ❌             |
| File / HTTP / ring-buffer transports   | ➕ subpaths             | ➕ targets       | ➕ transports     | 🟡 streams       | ❌             |
| Off-event-loop (worker-thread) sink    | ➕ subpath              | ✅ thread-stream | ❌                | ❌               | ❌             |
| First-class TypeScript types           | ✅                      | ✅               | 🟡 loose          | 🟡               | ✅             |

> [!NOTE]
> A ➕ does **not** mean a competitor "can't" do something — pino, winston and the rest have rich plugin
> ecosystems, and a ➕ is often a one-line `install` away. The point of comparing core packages is that
> `tslog` aims to give you universal runtime support, pretty **and** structured output, masking, error
> formatting and correlation **from a single zero-dependency install**, with transports/presets opting in
> as tree-shakeable subpaths only when you need them.

Different jobs still favor different tools: reach for **pino** when raw server-side JSON throughput is the
only thing that matters, **winston** when you want its mature transport ecosystem and don't mind the
configuration, and **consola** for pure CLI/terminal flair. `tslog` is built for the case where one logger
has to be good in the browser *and* the server, readable in dev *and* machine-parseable in prod.


## Core concepts

### Log levels

`tslog` ships seven default levels (the exported `LogLevel` enum):

| id | name  | method        |
|----|-------|---------------|
| 0  | SILLY | `log.silly()` |
| 1  | TRACE | `log.trace()` |
| 2  | DEBUG | `log.debug()` |
| 3  | INFO  | `log.info()`  |
| 4  | WARN  | `log.warn()`  |
| 5  | ERROR | `log.error()` |
| 6  | FATAL | `log.fatal()` |

```typescript
import { Logger } from "tslog";

const log = new Logger({ name: "myLogger" });
log.silly("I am a silly log.");
log.trace("I am a trace log.");
log.debug("I am a debug log.");
log.info("I am an info log.");
log.warn("I am a warn log with an object:", { foo: "bar" });
log.error("I am an error log.");
log.fatal(new Error("I am a pretty Error with a stacktrace."));
```

Use `minLevel` to suppress everything below a threshold (number or name). The `LogLevel` enum
avoids magic numbers:

```typescript
import { Logger, LogLevel } from "tslog";

const log = new Logger({ minLevel: LogLevel.WARN }); // or minLevel: "WARN"
log.info("hidden");
log.warn("visible");

log.setMinLevel("DEBUG"); // change at runtime
```

**Custom levels** are declared with `customLevels` and dispatched through the generic `log()` method
(`log(levelId, levelName, ...args)`):

```typescript
const log = new Logger({
  customLevels: { audit: 8, metric: 9 },
});
log.log(8, "AUDIT", { actor: "ada" }, "deleted account");
```

### Sub-loggers — `child()` / `getSubLogger()`

A sub-logger inherits the parent's settings (group-merged) and default `logObj`. Names accumulate into
`_meta.parentNames`, so you can trace which module or request produced a line. `child()` is an alias for
`getSubLogger()`.

```typescript
const main = new Logger({ name: "app" });
const db = main.getSubLogger({ name: "db" });
const query = db.child({ name: "query", minLevel: "DEBUG" });

query.debug("select 1");
// _meta.name = "query", _meta.parentNames = ["app", "db"]
```

You can override the default `logObj` per child by passing a second argument:
`main.getSubLogger({ name: "worker" }, { tenant: "acme" })`.

### Settings are grouped

v5 settings are organized into **groups** — there are no flat keys like `prettyLogTemplate`,
`maskValuesOfKeys`, or `hideLogPositionForProduction` anymore. Top-level keys cover identity and routing;
the groups cover everything else.

**Top-level:** `type` (`"pretty" | "json" | "hidden"` — omit for env-aware), `name`, `parentNames`,
`minLevel`, `argumentsArrayName`, `prefix`, `attachedTransports`, `middleware`, `customLevels`,
`persistLevel` / `persistLevelKey` (browser opt-in), `strictConfig` (throw a typed `TslogConfigError`
on bad config — including unknown/typo'd keys and carried-over v4 flat keys, which otherwise warn in
development with a did-you-mean suggestion).

| Group     | Keys |
|-----------|------|
| `pretty`  | `template`, `errorTemplate`, `errorStackTemplate`, `errorParentNamesSeparator`, `errorLoggerNameDelimiter`, `style` (boolean), `timeZone` (`"UTC" \| "local"`), `styles`, `levelMethod`, `inspectOptions`, `enabled` |
| `json`    | `messageKey` (`"message"`), `levelKey` (`"level"`), `levelIdKey` (`"levelId"`), `timeKey` (`"time"`), `errorKey` (`"error"`), `numericLevel` (`true`), `stableKeyOrder` (`false`) |
| `mask`    | `keys` (`[]`), `caseInsensitive`, `regex` (`RegExp[]`), `placeholder` (`"[***]"`), `paths` (JSONPath-lite), `censor` (`string \| "remove" \| "hash" \| fn`), `hashLabel` (`"hash"`) |
| `stack`   | `capture` (`"off" \| "lazy" \| "auto" \| "full"`), `internalFramePatterns` (`RegExp[]`) |
| `meta`    | `property` (`"_meta"`), `attachContext` |

```typescript
const log = new Logger({
  type: "json",
  name: "api",
  minLevel: "INFO",
  json: { messageKey: "msg", timeKey: "ts" },
  mask: { keys: ["password"], censor: "hash" },
  stack: { capture: "lazy" },
});
```

### Env-aware type resolution

When `type` is omitted, `tslog` picks the output for the environment:

- **Interactive TTY** (not CI, `NO_COLOR` unset) → `pretty`, colorized
- **CI / non-TTY / `NO_COLOR`** → `json`
- **Browser** → `pretty` with CSS styling

It honors `NO_COLOR` and `FORCE_COLOR`, and applies to both `new Logger()` and the ready-made `log` export.
`Logger.fromEnv(overrides?)` additionally reads `TSLOG_LEVEL` / `TSLOG_TYPE` / `TSLOG_NAME` (overrides win).


## Structured JSON output

`tslog`'s JSON is **flat and fields-first** — message, level and time at the top, your fields spread next
to them, and runtime metadata nested under `_meta` with a schema version (`v: 5`).

```typescript
const log = new Logger({ type: "json" });
log.info({ userId: 42 }, "hi");
```

```json
{
  "message": "hi",
  "level": "INFO",
  "levelId": 3,
  "time": "2026-06-29T22:37:07.599Z",
  "userId": 42,
  "_meta": {
    "v": 5,
    "date": "2026-06-29T22:37:07.599Z",
    "hostname": "unknown",
    "logLevelId": 3,
    "logLevelName": "INFO",
    "runtime": "node",
    "runtimeVersion": "24.15.0"
  }
}
```

How arguments map to output:

| Call | Result |
|------|--------|
| `log.info("hi")` | `message: "hi"` |
| `log.info({ a: 1 })` | fields spread top-level: `a: 1` |
| `log.info({ a: 1 }, "hi")` | fields spread + `message: "hi"` |
| `log.info("a", "b")` | `message: "a"`, `"1": "b"` |
| `log.error(new Error("x"))` | serialized under `error` (cause chain preserved) |

`name` / `parentNames` only appear when set (no `[undefined]` noise). Every key name is configurable via
the `json` group, so you can match an existing schema:

```typescript
new Logger({
  type: "json",
  json: { messageKey: "msg", levelKey: "severity", timeKey: "@timestamp", errorKey: "err" },
});
```


## Masking secrets

One of the most common ways secrets leak is through logs. Configure masking once on the logger and it
applies recursively to every log. All masking lives under the `mask` group.

```typescript
const log = new Logger({
  type: "json",
  mask: {
    keys: ["password", "apiKey", "token"], // mask by key name
    caseInsensitive: true,                  // also match Password, TOKEN, …
    regex: [/Bearer\s+[A-Za-z0-9._-]+/],    // mask by value pattern
    paths: ["user.password", "*.token"],    // JSONPath-lite, "*" wildcard
    placeholder: "[***]",                   // replacement (default)
  },
});
```

Masking is leak-proof by construction: `regex` patterns are always applied **globally** (every
occurrence in a string is redacted, whether or not you wrote the `g` flag), shared references and
circular structures resolve to the same *masked* clone (a secret can never escape through a second
reference to the same object), and `mask.keys` / `regex` also apply **inside `Map` and `Set`**
contents (`mask.paths` does not descend into them).

The `censor` option controls *how* a match is replaced:

- a **string** — replace with that literal
- `"remove"` — drop the key entirely
- a **function** — custom logic returning the replacement
- `"hash"` — replace with a fast, synchronous, non-cryptographic correlation token
  (e.g. `"[hash:1a2b3c4d]"`, label configurable via `hashLabel`) so you can correlate a redacted value
  across logs without ever storing it

```typescript
const log = new Logger({ mask: { keys: ["ssn"], censor: "hash", hashLabel: "hash" } });
```


## Transports

A transport receives every (level-permitted) log record and decides where it goes — a file, an HTTP
endpoint, an in-memory buffer, Slack, anything. `tslog` ships file, HTTP, ring-buffer and worker-thread
transports as tree-shakeable subpaths, and you can write your own against the `Transport` contract.

```ts
interface Transport<LogObj> {
  name?: string;
  minLevel?: number | TLogLevelName;                  // per-transport level
  format?: "pretty" | "json" | LogFormatter<LogObj>;  // per-transport format
  write(record, line): void | Promise<void>;
  flush?(): Promise<void>;
  [Symbol.asyncDispose]?(): Promise<void>;
}
```

`attachTransport` accepts a full `Transport` object **or** a bare function, and **returns a detach
function**:

```typescript
const log = new Logger();

const detach = log.attachTransport((record) => {
  myQueue.push(record);
});

// later
detach();
```

Transports are isolated (a throwing transport cannot break logging) and inherited by sub-loggers. Flush
buffered transports and dispose cleanly:

```typescript
await log.flush();

// or scoped disposal:
await using scoped = new Logger({ /* ... */ });
```

### Built-in transport subpaths

```typescript
import { fileTransport } from "tslog/transports/file";             // Node, non-blocking
import { httpTransport } from "tslog/transports/http";             // batched fetch
import { ringBufferTransport } from "tslog/transports/ringbuffer";  // in-memory
import { workerTransport } from "tslog/transports/worker";          // Node, off-thread sink I/O

const log = new Logger();
log.attachTransport(fileTransport({ path: "app.log", append: true }));
log.attachTransport(httpTransport({ url: "https://logs.example.com", batchSize: 50, flushIntervalMs: 1000 }));

const ring = ringBufferTransport({ size: 200 });
log.attachTransport(ring);
// ring.dump(); ring.clear();

// Run the destination write on a worker thread so slow sink I/O doesn't block the event loop
// under high volume (like pino's thread-stream). Note: this does NOT speed up `log.info()` —
// the record is still built and serialized on the main thread; only the file/stream write moves
// off-thread. `flush()` drains the worker; `await using` (or attachTransport's detach) cleans it up.
log.attachTransport(workerTransport({ destination: "file", path: "app.log", format: "json" }));
```


## Middleware & pipeline

> [!IMPORTANT]
> v4's `overwrite.*` hooks (`mask`, `toLogObj`, `addMeta`, `formatMeta`, `formatLogObj`,
> `transportFormatted`, `transportJSON`, `addPlaceholders`) are **removed in v5.** Use `use()` middleware
> for log mutation/dropping and per-transport `format` for custom output shapes.

`logger.use(middleware)` appends a middleware to the pipeline. A middleware receives the log context
(`args`, `meta`, `settings`, `logLevelId`, `logLevelName`), and can mutate it or drop the log by
returning `null` / `false`:

```typescript
const log = new Logger();

// enrich every log (meta is free-form scratch space attached under _meta)
log.use((ctx) => {
  ctx.meta.env = process.env.NODE_ENV;
  return ctx;
});

// drop noisy health checks (args holds the log call's arguments)
log.use((ctx) => (ctx.args[0] === "/health" ? null : ctx));
```

For custom output formatting, set `format` on a transport (a `"pretty" | "json"` string or a
`LogFormatter` function) rather than overriding a global transport.


## Presets

Presets are tree-shakeable subpaths that emit logs in a foreign schema, so `tslog` drops into existing
tooling. They are off by default — import and wire them explicitly.

### pino — `tslog/presets/pino`

`pinoFormat()` produces pino-compatible NDJSON (integer `level` 10–60, `time` epoch ms, `msg`), so
`pino-pretty` and pino transports keep working. `pinoTransport()` wires it up in one call; `toPinoLevel(id)`
maps a tslog level id to its pino number.

```typescript
import { pinoFormat, pinoTransport } from "tslog/presets/pino";

const log = new Logger();
log.attachTransport(pinoTransport()); // or attach a transport with { format: pinoFormat() }
```

### OpenTelemetry — `tslog/otel`

`otelFormat()` / `toOtelRecord()` emit OTel log records with the correct `SeverityNumber`
(`levelToSeverityNumber`, `OtelSeverityNumber`); `otelTraceContext()` correlates with the active
trace/span; `stringifyOtelRecord()` serializes a record.

```typescript
import { otelFormat, otelTraceContext } from "tslog/otel";

const log = new Logger();
log.attachTransport({ format: otelFormat(), write: (rec, line) => sendToCollector(line) });
log.use((ctx) => (Object.assign(ctx.meta, otelTraceContext()), ctx));
```

### GenAI / agents — `tslog/presets/genai`

`genai()` / `genaiAttributes()` / `genaiSummary()` build OTel-GenAI semantic-convention attributes
(`gen_ai.*`: model, tokens, tool calls) for LLM and agent apps.

```typescript
import { genai } from "tslog/presets/genai";

log.info(genai({ model: "claude", inputTokens: 318, outputTokens: 142 }), "completion");
```


## Pretty output & templates

Pretty output is configured entirely under the `pretty` group. Templates use `{{placeholder}}` tokens
and per-placeholder styles.

```typescript
const log = new Logger({
  type: "pretty",
  pretty: {
    template: "{{dateIsoStr}}\t{{logLevelName}}\t[{{filePathWithLine}}{{name}}]\t",
    errorTemplate: "\n{{errorName}} {{errorMessage}}\nstack:\n{{errorStack}}",
    errorStackTemplate: "  • {{fileName}}\t{{method}}\n\t{{filePathWithLine}}",
    style: true,
    timeZone: "UTC",
    styles: {
      logLevelName: {
        "*": ["bold", "black", "bgWhiteBright", "dim"],
        SILLY: ["bold", "white"],
        DEBUG: ["bold", "green"],
        INFO: ["bold", "blue"],
        WARN: ["bold", "yellow"],
        ERROR: ["bold", "red"],
        FATAL: ["bold", "redBright"],
      },
      name: ["white", "bold"],
    },
  },
});
```

Route levels to specific console methods with `pretty.levelMethod`:

```typescript
new Logger({
  type: "pretty",
  pretty: {
    levelMethod: { WARN: console.warn, ERROR: console.error, FATAL: console.error, "*": console.log },
  },
});
```

On Node.js, object formatting uses native `util.inspect`; tune it with `pretty.inspectOptions`.


## AI / agent DX

`tslog` is built to be friendly to LLM apps and coding agents:

- **`llms.txt`** ships in the package, giving agents an accurate, condensed API surface to work from.
- **Fields-first calls** make structured, queryable logs the natural default for tool calls and traces.
- **`isLevelEnabled(level)`** guards expensive payloads (token counts, large prompts) without building them:

  ```typescript
  if (log.isLevelEnabled("DEBUG")) {
    log.debug({ prompt: buildExpensivePrompt() });
  }
  ```

- **`defineConfig(...)`** gives a typed, validated settings object you can share across loggers.
- **Request / agent correlation** via `runInContext(ctx, fn)` (Node ALS). When `meta.attachContext` is on,
  the context fields attach to `_meta`, so every log inside the callback carries the same correlation id:

  ```typescript
  const log = new Logger({ meta: { attachContext: true } });

  await log.runInContext({ requestId: "abc123" }, async () => {
    log.info("handling request"); // _meta carries requestId
    await doWork();
  });
  ```

  `runInContext` is a no-op off Node.


## Other subpaths

| Import | What it gives you |
|--------|-------------------|
| `tslog/lite` | `lite` (ready instance), `LiteLogger`, `createLiteLogger(opts?)` — minimal console wrappers, no mask/stack/clone, preserves native console line numbers |
| `tslog/testing` | `createTestLogger(settings?)` → `{ logger, logs, lines, clear }`, plus `mockLogger(settings?)` |
| `tslog/throttle` | `throttle({ windowMs, key?, now? })` middleware (off by default), `defaultThrottleKey` |
| `tslog/serializers` | `stdSerializers` `{ err, req, res, user }`, the `serialize(map)` middleware helper, and the individual serializers |
| `tslog/pretty/box` | `box(content, opts?)`, `tree(node, opts?)` for boxed / tree-rendered output |
| `tslog/console` | `wrapConsole(logger)`, `restoreConsole()`, `isConsoleWrapped()` — route `console.*` through tslog |
| bin `tslog` (`tslog/cli`) | NDJSON pretty-printer for stdin, with a `-l/--level` filter |

```typescript
import { createTestLogger } from "tslog/testing";

const { logger, logs, lines, clear } = createTestLogger({ type: "json" });
logger.info({ ok: true }, "tested");
// logs[0] is the captured record: logs[0]._meta.logLevelName === "INFO"
// lines[0] is the rendered line and contains the fields: lines[0].includes('"ok":true')
```


## Performance

`tslog` is fast, but this README is honest rather than chasing a leaderboard claim — **it does not claim
to be faster than pino.** The defaults are tuned for a great developer experience; for hot production
paths, the biggest lever is stack capture.

- **Lazy stack capture by default.** Stack frames (and therefore log-position lookup) are captured lazily,
  so you only pay for them when something actually reads them.
- **The stack lever.** Set `stack: { capture: "off" }` to skip code-position capture entirely on hot paths,
  or `"full"` when you want complete frames for debugging.
- **Tree-shakeable everything.** Presets, transports and helpers are opt-in subpaths with
  `sideEffects: false`, so unused features never reach your bundle.

See **[benchmarks/RESULTS.md](./benchmarks/RESULTS.md)** for measured numbers and the methodology.


## <a name="upgrading-from-v4"></a>Upgrading from v4?

> [!IMPORTANT]
> **`tslog@4.11.0` is the safe staying point.** Most of the v5 performance wins (faster lazy stack capture,
> transport isolation, masking fixes) were back-ported to **4.11.0 with zero breaking changes**. If you are
> on the 4.x line and just want the wins, `npm install tslog@4.11.0` keeps your existing settings, CJS
> `require`, Node 16+, and the v4 JSON shape exactly as they are. There is no deprecation pressure.

Move to **v5** when you actually want its new capabilities: env-aware default output, the flat fields-first
JSON shape, grouped settings, `use()` middleware, per-transport level/format, the presets, and the AI/agent
DX. v5 is ESM-only and requires Node ≥ 20.

👉 **Full guide: [MIGRATION_v4_to_v5.md](./MIGRATION_v4_to_v5.md)** — it maps every removed v4 setting
(`stylePrettyLogs`, `prettyLogTemplate`, `maskValuesOfKeys`, `metaProperty`, `hideLogPositionForProduction`,
the whole `overwrite.*` family, …) to its v5 replacement.


## License

[MIT](./LICENSE)
