# tslog Recipes

Copy-paste patterns for common logging tasks, with a focus on production services and AI/agentic apps. All patterns use the public API only.

## 1. Structured JSON for observability / LLM ingestion

```ts
import { Logger } from "tslog";

const log = new Logger({ type: "json", minLevel: "INFO" });

log.info({ event: "request", method: "GET", path: "/users", status: 200, durationMs: 12 });
// → one JSON object per line, ready for Datadog / Loki / OpenTelemetry / another LLM to parse
```

## 2. Per-request (or per-agent) child logger

Child loggers inherit settings, names, prefixes, and transports — create one per request, job, or agent step.

```ts
const log = new Logger({ type: "json", name: "api" });

function handleRequest(req) {
  const requestLog = log.getSubLogger({ name: "req" });
  requestLog.info("started", { method: req.method, path: req.url });
  // ... requestLog.debug/info/error within this request
}
```

## 3. Automatic request correlation with AsyncLocalStorage

Function-valued fields on the default `logObj` are evaluated on every log, so a `requestId` (or `traceId`) is attached automatically to everything logged within the request — including from deep sub-loggers — without threading it through your code.

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { Logger } from "tslog";

const store = new AsyncLocalStorage<{ requestId: string }>();

const log = new Logger<{ requestId?: string | (() => string | undefined) }>(
  { type: "json" },
  { requestId: () => store.getStore()?.requestId }, // evaluated per log
);

// In your middleware:
function withRequestId(requestId: string, next: () => Promise<void>) {
  return store.run({ requestId }, next);
}

// Anywhere inside the request, every log includes the current requestId:
log.info("processing");
```

## 4. Redact secrets and prompts

Keep passwords, API keys, and (for AI apps) prompts and PII out of your logs.

```ts
const log = new Logger({
  type: "json",
  maskValuesOfKeys: ["password", "apiKey", "authorization", "token", "prompt", "completion"],
  // also redact substrings inside strings (e.g. env secrets, emails):
  maskValuesRegEx: [/\b[A-Za-z0-9]{32,}\b/g],
});

log.info("auth", { user: "alice", password: "hunter2", apiKey: "sk-..." });
// → { "user": "alice", "password": "[***]", "apiKey": "[***]", ... }
```

## 5. Logging LLM calls (tokens, cost, latency, model)

A consistent shape makes multi-agent economics easy to aggregate downstream.

```ts
const log = new Logger({ type: "json", name: "llm" });

async function callModel(prompt: string) {
  const start = Date.now();
  const res = await client.complete(prompt);
  log.info("llm_call", {
    model: res.model,
    promptTokens: res.usage.prompt_tokens,
    completionTokens: res.usage.completion_tokens,
    costUsd: res.usage.cost,
    latencyMs: Date.now() - start,
  });
  return res;
}
```

## 6. Route levels to the right console method

Useful for browser DevTools filtering and log collectors that key off the console method.

```ts
const log = new Logger({
  type: "pretty",
  prettyLogLevelMethod: {
    WARN: console.warn,
    ERROR: console.error,
    FATAL: console.error,
    "*": console.log,
  },
});
```

## 7. Ship logs to a backend (custom transport)

Transports run in isolation — a transport that throws never crashes logging or stops other transports.

```ts
const log = new Logger({ type: "json" });

log.attachTransport((logObj) => {
  // logObj is the full structured object (including _meta)
  if (logObj._meta.logLevelId >= 4 /* WARN+ */) {
    void fetch("https://logs.example.com/ingest", {
      method: "POST",
      body: JSON.stringify(logObj),
    });
  }
});
```

## 8. Write to a file (Node) with rotation

tslog stays zero-dependency, so file rotation is a tiny composition with `rotating-file-stream`.

```ts
import { Logger } from "tslog";
import { createStream } from "rotating-file-stream";

const stream = createStream("app.log", { size: "10M", interval: "1d", compress: "gzip" });

const log = new Logger({ type: "json" });
log.attachTransport((logObj) => stream.write(JSON.stringify(logObj) + "\n"));
```

## 9. Fast production logging

Skip stack capture (the dominant per-log cost) when you don't need code position in production.

```ts
const log = new Logger({ type: "json", hideLogPositionForProduction: true });
```
