# tslog Recipes

Copy-paste patterns for common logging tasks, with a focus on production services and AI/agentic apps. All patterns use the public v5 API. Settings are **grouped** (`mask`, `json`, `pretty`, `stack`, `meta`) — there are no flat keys.

## 1. Structured JSON for observability / LLM ingestion

```ts
import { Logger } from "tslog";

const log = new Logger({ type: "json", minLevel: "INFO" });

// Fields-first (pino-style) or string-first — both work:
log.info({ event: "request", method: "GET", path: "/users", status: 200, durationMs: 12 });
log.info("request complete", { status: 200 });
// → one flat, fields-first JSON object per line:
//   { "message": "...", "level": "INFO", "time": "…", "status": 200, "_meta": { "v": 5, … } }
```

The default `type` is environment-aware: `new Logger()` is pretty + colorized in an interactive
terminal, and JSON in CI / non-TTY (`NO_COLOR` just strips colors). Pass `type` to pin it.

## 2. Per-request (or per-agent) child logger

Child loggers inherit settings, names, prefixes, and transports — create one per request, job, or agent step. `child(...)` is an alias for `getSubLogger(...)`.

```ts
const log = new Logger({ type: "json", name: "api" });

function handleRequest(req) {
  const requestLog = log.getSubLogger({ name: "req" }); // or log.child({ name: "req" })
  requestLog.info("started", { method: req.method, path: req.url });
}
```

## 3. Automatic request correlation with `runInContext` (AsyncLocalStorage)

`runInContext(ctx, fn)` attaches its fields onto every log emitted inside `fn` — across `await`, timers, and nested sub-loggers — without threading ids through your code. Backed by `AsyncLocalStorage`, auto-resolved on Node/Deno/Bun; a graceful no-op in browsers. `getContext()` reads the active fields.

```ts
const log = new Logger({ type: "json" });

function withRequest(req, next) {
  return log.runInContext({ requestId: req.id, traceId: req.traceId }, next);
}

// Anywhere inside the request — including deep sub-loggers — every log carries the ids under _meta:
log.info("processing");
```

On **Cloudflare Workers**, auto-resolution can't work — inject the storage instead (enable the `nodejs_als` or `nodejs_compat` compatibility flag in `wrangler.toml`):

```ts
import { AsyncLocalStorage } from "node:async_hooks";

const log = new Logger({ type: "json", contextStorage: new AsyncLocalStorage() });

export default {
  async fetch(request, env, ctx) {
    return log.runInContext({ requestId: crypto.randomUUID() }, () => handle(request));
  },
};
```

## 4. Redact secrets, PII, and prompts

Mask by key, by dotted path (`*` matches one segment), or by regex — all grouped under `mask`.

```ts
const log = new Logger({
  type: "json",
  mask: {
    keys: ["password", "apiKey", "authorization", "token", "prompt", "completion"],
    caseInsensitive: true,
    paths: ["user.password", "*.token", "headers.authorization"],
    regex: [/\b[A-Za-z0-9]{32,}\b/g], // long token-like substrings in strings
    // censor: "remove",             // delete the key instead of replacing the value
    // censor: (v) => `****${String(v).slice(-4)}`,
  },
});

log.info({ user: "alice", password: "hunter2", apiKey: "sk-..." }, "auth");
// → { "message": "auth", "user": "alice", "password": "[***]", "apiKey": "[***]", ... }
```

## 5. Logging LLM calls (tokens, cost, latency, model) with the genai preset

`tslog/presets/genai` maps a friendly input to OpenTelemetry `gen_ai.*` attributes plus a compact summary. Spread the result into a log call.

```ts
import { genai } from "tslog/presets/genai";

const log = new Logger({ type: "json", name: "llm" });

log.info("chat completion", genai({
  model: "claude-opus-4",
  inputTokens: 1200,
  outputTokens: 350,
  costUsd: 0.021,
  latencyMs: 845,
  tool: "search",
}));
// emits gen_ai.* attributes + a { model, tokens, costUsd, latencyMs } summary
```

## 6. Route levels to the right console method

```ts
const log = new Logger({
  type: "pretty",
  pretty: {
    levelMethod: { WARN: console.warn, ERROR: console.error, FATAL: console.error, "*": console.log },
  },
});
```

## 7. Ship logs to a backend (custom transport + middleware)

Transports run in isolation — a transport that throws never crashes logging or stops siblings. Use `use(...)` middleware to enrich or drop logs before they are formatted.

```ts
const log = new Logger({ type: "json" });

// Enrich every log, then sample below WARN:
log.use((ctx) => { ctx.meta.region = "eu"; return ctx; });
log.use((ctx) => (ctx.logLevelId >= 4 || Math.random() < 0.1 ? ctx : null));

// A sink that only sees WARN+ and receives a JSON line regardless of the logger's type:
const detach = log.attachTransport({
  name: "http",
  minLevel: "WARN",
  format: "json",
  write: (record, line) => { void fetch("https://logs.example.com/ingest", { method: "POST", body: line }); },
});
```

## 8. Emit pino-shaped NDJSON (drop-in for pino consumers)

```ts
import { pinoTransport } from "tslog/presets/pino";

const log = new Logger({ type: "hidden" }); // suppress console, let the transport own output
log.attachTransport(pinoTransport((line) => process.stdout.write(line + "\n")));
log.info({ userId: 42 }, "user logged in");
// → {"level":30,"time":1751191872000,"pid":12345,"hostname":"…","msg":"user logged in","userId":42}
// Errors ship in pino's serializer shape: err: { type, message, stack: "<raw multi-line string>", cause? }
// (pino-pretty and error trackers parse it as-is; pinoFormat({ errorShape: "tslog" }) keeps frame arrays.)
```

## 9. OpenTelemetry logs — POST straight to a collector (OTLP/JSON)

`otlpFormat` emits real OTLP/JSON (camelCase proto3 fields, typed attributes, `exception.*` mapping
for logged errors); `otlpBatchBody` merges each HTTP batch into ONE envelope, so the transport can
POST directly to a collector's `/v1/logs` endpoint.

```ts
import { otlpFormat, otlpBatchBody } from "tslog/otel";
import { httpTransport } from "tslog/transports/http";

const log = new Logger({ type: "hidden" });
log.attachTransport(
  httpTransport({
    url: "http://collector:4318/v1/logs",
    format: otlpFormat({ resource: { "service.name": "checkout" }, getSpanContext: () => log.getContext() }),
    encodeBody: otlpBatchBody,
  }),
);
```

For a custom (non-collector) pipeline that prefers the spec's prose field names (`Timestamp`, `Body`,
`Attributes`, ...), use `otelFormat`/`toOtelRecord` instead — collectors do not ingest that shape.

## 10. Write to a file (Node), with flush on shutdown

The `tslog/transports/file` transport buffers and flushes; `await using` (or `flush()`) drains it before exit.

```ts
import { Logger } from "tslog";
import { fileTransport } from "tslog/transports/file";

await using log = new Logger({ type: "json" });
log.attachTransport(fileTransport({ path: "./logs/app.log", format: "json" }));
log.info("ready");
// the buffered file output is flushed when the `await using` scope ends
```

Built-in exit safety: the file transport registers guarded exit hooks by default (`exitHooks: false`
opts out) — an async flush on `beforeExit` and a synchronous drain on `exit`, so even a bare
`process.exit(0)` or an uncaught exception does not lose the buffered tail. fs errors (disk full,
permissions) are contained and reported via `onError` (default: one `console.error` per error burst);
a failed open is retried on the next write. The http and worker transports flush on `beforeExit`
(and `pagehide` in browsers) the same way.

## 10b. Graceful shutdown on SIGTERM/SIGINT (app-owned)

Signal handling belongs to the application — a library installing a `SIGTERM` listener would change
your process's termination semantics. Wire the logger into your own handler:

```ts
import { Logger } from "tslog";

const log = new Logger({ type: "json" });

async function shutdown(code: number): Promise<void> {
  await log.flush(); // awaits async transport writes AND each transport's own flush()
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(130));
process.on("uncaughtException", (error) => {
  log.fatal("uncaught exception", error);
  void shutdown(1);
});
```

Note: disposing a sub-logger (`await using child = log.child(...)`) flushes shared transports but
only *disposes* transports the child itself attached — a request-scoped child can never terminate
the root logger's sinks.

## 11. Keep slow sink I/O off the event loop (Node worker thread)

The `tslog/transports/worker` transport runs its destination write on a `node:worker_threads` worker, so a slow file/stream sink under high log volume doesn't stall the application's event loop (like pino's `thread-stream`). Note: this does **not** speed up `log.info()` — the record is still built and serialized on the main thread; only the write moves off-thread. Off Node it falls back to a synchronous inline write.

```ts
import { Logger } from "tslog";
import { workerTransport } from "tslog/transports/worker";

const log = new Logger({ type: "json" });
await using sink = workerTransport({ destination: "file", path: "./logs/app.log", format: "json" });
log.attachTransport(sink);

log.info("ready");
// `await using` drains the worker queue and terminates the thread on scope exit;
// or call `await sink.flush()` then `await sink[Symbol.asyncDispose]()` manually.
```

## 12. Fast production logging

Skip stack capture (the dominant per-log cost) when you don't need code position. `type: "json"` already defaults `stack.capture` to `"off"`; set it explicitly for pretty too.

```ts
const log = new Logger({ type: "json", stack: { capture: "off" } });

// Guard expensive payload construction with isLevelEnabled:
if (log.isLevelEnabled("DEBUG")) {
  log.debug("state", expensiveSnapshot());
}
```

## 12b. Smallest browser / edge bundle (`tslog/slim`)

The full entry ships masking, pretty rendering, and stack parsing whether or not your config uses them (output `type` is a runtime value, so bundlers cannot drop them). When bundle size matters more, `tslog/slim` is the same structured-JSON pipeline at less than half the size — and it fails HONESTLY: `mask` settings and `type: "pretty"` throw instead of being silently ignored.

```ts
import { Logger } from "tslog/slim"; // ~9.6KB gzip vs ~19.9KB for the full browser entry

const log = new Logger({ name: "edge", bindings: { service: "checkout" } });
log.info("request", { requestId: crypto.randomUUID() }); // same flat fields-first JSON
```

Kept: levels, sub-loggers, bindings, custom levels, middleware, `runInContext` correlation, transports. Dropped: masking, pretty output, stack capture (`_meta.path`; error `stack` arrays are empty), `fromEnv`, settings validation. Develop against the full entry, ship slim.

## 13. Configure from environment / typed config

```ts
import { Logger, defineConfig } from "tslog";

// TSLOG_LEVEL / TSLOG_TYPE / TSLOG_NAME (plus NO_COLOR / FORCE_COLOR), overrides win:
const log = Logger.fromEnv({ name: "api" });

// defineConfig gives editor/agent autocomplete on the grouped settings:
const settings = defineConfig({ type: "json", mask: { keys: ["password"] } });
const log2 = new Logger(settings);
```

## 14. Deterministic logs in tests (snapshots without fake timers)

`createTestLogger` can freeze ONLY the logger's clock (interval-driven transports and user timers keep
running — no `vi.useFakeTimers()` sledgehammer) and normalize machine-varying meta for snapshots.

```ts
import { createTestLogger, normalizeMeta } from "tslog/testing";

// Frozen per-logger clock:
const { logger, logs, lines } = createTestLogger({ type: "json" }, { now: () => new Date("2026-01-01T00:00:00Z") });

// Snapshot-stable output (epoch clock, hostname/runtimeVersion pinned, no _meta.path):
const snap = createTestLogger({ type: "json" }, { normalize: true });
snap.logger.info("ready", { port: 3000 });
expect(snap.lines[0]).toMatchSnapshot();

// Or scrub output captured elsewhere:
expect(normalizeMeta(capturedJsonLine)).toMatchSnapshot();
```

The same seam works on any logger in production: `new Logger({ clock: () => new Date(...) })`.

## 15. Timestamp control (`json.time`)

```ts
new Logger({ type: "json", json: { time: "epoch" } }); // "time": 1751191872000 — pino-style epoch ms
new Logger({ type: "json", json: { time: false } });   // no top-level time key — diff-friendly CI output
new Logger({ type: "json", json: { time: (d) => String(BigInt(d.getTime()) * 1_000_000n) } }); // ns (Loki)
```

`_meta.date` always stays a UTC ISO string; `json.time` only shapes the top-level key.
