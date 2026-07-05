import type { FetchLike, HttpRequestInit, HttpResponseLike } from "../src/subpaths/transports/http.js";
import { httpTransport } from "../src/subpaths/transports/http.js";

/** A controllable fake `fetch` that records every request and lets a test choose each response. */
function makeFakeFetch(opts?: { fail?: boolean; status?: number; ok?: boolean }) {
  const calls: { url: string; init: HttpRequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init): Promise<HttpResponseLike> => {
    calls.push({ url, init });
    if (opts?.fail) {
      throw new Error("network down");
    }
    return { ok: opts?.ok ?? true, status: opts?.status ?? 200 };
  };
  return { calls, fetchImpl };
}

const record = {} as never;

describe("httpTransport", () => {
  test("buffers until batchSize, then POSTs one NDJSON batch", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 3, fetchImpl });

    transport.write(record, '{"a":1}');
    transport.write(record, '{"a":2}');
    // Below batchSize → nothing sent yet.
    expect(calls).toHaveLength(0);

    transport.write(record, '{"a":3}');
    // Reaching batchSize triggers a send; await the flush tail to be deterministic.
    await transport.flush?.();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://logs.example/ingest");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["content-type"]).toBe("application/x-ndjson");
    expect(calls[0].init.body).toBe('{"a":1}\n{"a":2}\n{"a":3}');
  });

  test("flush() sends whatever is buffered even below batchSize", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 100, fetchImpl });

    transport.write(record, '{"x":1}');
    transport.write(record, '{"x":2}');
    expect(calls).toHaveLength(0);

    await transport.flush?.();

    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBe('{"x":1}\n{"x":2}');
  });

  test("flush() on an empty buffer sends nothing and resolves", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({ url: "https://logs.example/ingest", fetchImpl });
    await expect(transport.flush?.()).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("bodyFormat 'array' encodes a JSON array with application/json", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({ url: "https://logs.example/ingest", bodyFormat: "array", batchSize: 2, fetchImpl });

    transport.write(record, '{"a":1}');
    transport.write(record, '{"a":2}');
    await transport.flush?.();

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers["content-type"]).toBe("application/json");
    expect(calls[0].init.body).toBe('[{"a":1},{"a":2}]');
    expect(JSON.parse(calls[0].init.body)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test("custom headers merge over defaults and can override content-type", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      headers: { authorization: "Bearer t0ken", "content-type": "application/custom" },
      batchSize: 1,
      fetchImpl,
    });

    transport.write(record, '{"a":1}');
    await transport.flush?.();

    expect(calls[0].init.headers.authorization).toBe("Bearer t0ken");
    expect(calls[0].init.headers["content-type"]).toBe("application/custom");
  });

  test("network errors are isolated: write/flush never throw, onError is notified with the batch", async () => {
    const { calls, fetchImpl } = makeFakeFetch({ fail: true });
    const seen: { error: unknown; lines: readonly string[] }[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 2,
      retries: 0,
      fetchImpl,
      onError: (error, lines) => seen.push({ error, lines }),
    });

    expect(() => transport.write(record, '{"a":1}')).not.toThrow();
    expect(() => transport.write(record, '{"a":2}')).not.toThrow();
    await expect(transport.flush?.()).resolves.toBeUndefined();

    expect(calls).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect((seen[0].error as Error).message).toBe("network down");
    expect(seen[0].lines).toEqual(['{"a":1}', '{"a":2}']);
  });

  test("non-2xx responses are reported as an error with the status, batch isolated", async () => {
    const { calls, fetchImpl } = makeFakeFetch({ ok: false, status: 503 });
    const seen: unknown[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 1,
      retries: 0,
      fetchImpl,
      onError: (error) => seen.push(error),
    });

    transport.write(record, '{"a":1}');
    await transport.flush?.();

    expect(calls).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toContain("503");
  });

  test("a throwing onError callback never escapes the transport", async () => {
    const { fetchImpl } = makeFakeFetch({ fail: true });
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 1,
      retries: 0,
      fetchImpl,
      onError: () => {
        throw new Error("callback blew up");
      },
    });
    transport.write(record, '{"a":1}');
    await expect(transport.flush?.()).resolves.toBeUndefined();
  });

  test("flushIntervalMs flushes time-bounded batches without reaching batchSize", async () => {
    vi.useFakeTimers();
    try {
      const { calls, fetchImpl } = makeFakeFetch();
      const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1000, flushIntervalMs: 50, fetchImpl });

      transport.write(record, '{"t":1}');
      expect(calls).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(50);
      await transport.flush?.();

      expect(calls).toHaveLength(1);
      expect(calls[0].init.body).toBe('{"t":1}');
    } finally {
      vi.useRealTimers();
    }
  });

  test("forwards the per-transport format and default name to the Transport shape", () => {
    const { fetchImpl } = makeFakeFetch();
    const transport = httpTransport({ url: "https://logs.example/ingest", format: "json", fetchImpl });
    expect(transport.name).toBe("http");
    expect(transport.format).toBe("json");

    const named = httpTransport({ url: "https://logs.example/ingest", name: "loki", fetchImpl });
    expect(named.name).toBe("loki");
  });

  test("asyncDispose flushes the buffer and stops the interval timer", async () => {
    vi.useFakeTimers();
    try {
      const { calls, fetchImpl } = makeFakeFetch();
      const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1000, flushIntervalMs: 50, fetchImpl });

      transport.write(record, '{"d":1}');
      await transport[Symbol.asyncDispose]?.();
      expect(calls).toHaveLength(1);

      // Timer cleared: advancing further triggers no additional sends.
      await vi.advanceTimersByTimeAsync(500);
      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("throws when no fetch is available and none injected", () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    // biome-ignore lint/performance/noDelete: test needs to truly remove the global to simulate a fetch-less runtime
    delete (globalThis as { fetch?: unknown }).fetch;
    try {
      expect(() => httpTransport({ url: "https://logs.example/ingest" })).toThrow(/no fetch implementation/);
    } finally {
      if (original !== undefined) {
        (globalThis as { fetch?: unknown }).fetch = original;
      }
    }
  });

  test("uses the global fetch when no fetchImpl is provided", async () => {
    const calls: { url: string; init: HttpRequestInit }[] = [];
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = async (url: string, init: HttpRequestInit): Promise<HttpResponseLike> => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };
    try {
      const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1 });
      transport.write(record, '{"g":1}');
      await transport.flush?.();
      expect(calls).toHaveLength(1);
      expect(calls[0].init.body).toBe('{"g":1}');
    } finally {
      if (original === undefined) {
        // biome-ignore lint/performance/noDelete: restore the fetch-less state the test started from
        delete (globalThis as { fetch?: unknown }).fetch;
      } else {
        (globalThis as { fetch?: unknown }).fetch = original;
      }
    }
  });
});

describe("httpTransport delivery hardening", () => {
  test("a failed batch is retried with backoff and eventually delivers without onError", async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("network down");
      }
      return { ok: true, status: 200 };
    };
    const seen: unknown[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 1,
      retries: 2,
      retryBaseMs: 1,
      fetchImpl,
      onError: (error) => seen.push(error),
    });

    transport.write(record, '{"a":1}');
    await transport.flush?.();

    expect(attempts).toBe(3);
    expect(seen).toHaveLength(0);
  });

  test("exhausted retries drop the batch and report once", async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts++;
      throw new Error("network down");
    };
    const seen: unknown[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 1,
      retries: 1,
      retryBaseMs: 1,
      fetchImpl,
      onError: (error) => seen.push(error),
    });

    transport.write(record, '{"a":1}');
    await transport.flush?.();

    expect(attempts).toBe(2);
    expect(seen).toHaveLength(1);
  });

  test("a hard 4xx fails fast without retrying", async () => {
    let attempts = 0;
    const fetchImpl: FetchLike = async () => {
      attempts++;
      return { ok: false, status: 400 };
    };
    const seen: unknown[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 1,
      retries: 3,
      retryBaseMs: 1,
      fetchImpl,
      onError: (error) => seen.push(error),
    });

    transport.write(record, '{"a":1}');
    await transport.flush?.();

    expect(attempts).toBe(1);
    expect((seen[0] as Error).message).toContain("400");
  });

  test("a hung request is aborted by timeoutMs so later batches still deliver", async () => {
    let call = 0;
    const delivered: string[] = [];
    const fetchImpl: FetchLike = (_url, init) => {
      call++;
      if (call === 1) {
        // Hang until the per-attempt AbortSignal fires.
        return new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal | undefined;
          if (signal != null) {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      delivered.push(init.body);
      return Promise.resolve({ ok: true, status: 200 });
    };
    const seen: unknown[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 1,
      retries: 0,
      timeoutMs: 30,
      fetchImpl,
      onError: (error) => seen.push(error),
    });

    transport.write(record, '{"a":1}');
    await transport.flush?.();
    transport.write(record, '{"a":2}');
    await transport.flush?.();

    expect(seen).toHaveLength(1);
    expect(delivered).toEqual(['{"a":2}']);
  });

  test("the buffer cap drops the oldest lines while a send is in flight and reports a sample", async () => {
    const bodies: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let call = 0;
    const fetchImpl: FetchLike = (_url, init) => {
      call++;
      bodies.push(init.body);
      if (call === 1) {
        // A slow collector: the first batch hangs until released, so later writes pile into the buffer.
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ ok: true, status: 200 });
        });
      }
      return Promise.resolve({ ok: true, status: 200 });
    };
    const seen: { error: unknown; lines: readonly string[] }[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 2,
      maxBufferedLines: 3,
      fetchImpl,
      onError: (error, lines) => seen.push({ error, lines }),
    });

    transport.write(record, '{"n":1}');
    transport.write(record, '{"n":2}'); // pump takes [1,2]; the send hangs
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 3; i <= 7; i++) {
      transport.write(record, `{"n":${i}}`); // buffer capped at 3: 3 and 4 are dropped
    }

    releaseFirst?.();
    await transport.flush?.();

    expect(bodies[0].split("\n")).toEqual(['{"n":1}', '{"n":2}']);
    // Only the newest 3 lines survived the cap, delivered in order across subsequent batches.
    expect(bodies.slice(1).join("\n").split("\n")).toEqual(['{"n":5}', '{"n":6}', '{"n":7}']);
    expect(String(seen[0]?.error)).toContain("dropped");
    expect(seen[0]?.lines).toEqual(['{"n":3}']); // the dropped sample
  });

  test("the buffer-full drop report re-fires every 1000th dropped line", async () => {
    let releaseFirst: (() => void) | undefined;
    let call = 0;
    const fetchImpl: FetchLike = () => {
      call++;
      if (call === 1) {
        // Hang the first send so every later write piles into the capped buffer and drops.
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ ok: true, status: 200 });
        });
      }
      return Promise.resolve({ ok: true, status: 200 });
    };
    const reports: number[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 2,
      maxBufferedLines: 2,
      retries: 0,
      fetchImpl,
      onError: (error) => {
        const match = /dropped (\d+) lines/.exec(String(error));
        if (match != null) {
          reports.push(Number(match[1]));
        }
      },
    });

    // Two writes start the (hanging) pump; then flood far past 1000 drops. droppedTotal reports at 1 and
    // then every 1000th line (http.ts 329, the `droppedTotal % 1000 === 0` branch).
    transport.write(record, '{"n":0}');
    transport.write(record, '{"n":1}');
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 1100; i++) {
      transport.write(record, `{"n":${i + 2}}`);
    }

    // The first drop reports at 1, and the 1000th drop reports at 1000.
    expect(reports).toContain(1);
    expect(reports).toContain(1000);

    releaseFirst?.();
    await transport.flush?.();
    await transport[Symbol.asyncDispose]?.();
  });

  test("a cap smaller than the batch size still drains (threshold clamps to the cap)", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 100,
      maxBufferedLines: 3,
      fetchImpl,
    });

    transport.write(record, '{"n":1}');
    transport.write(record, '{"n":2}');
    transport.write(record, '{"n":3}');
    await transport.flush?.();

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].init.body.split("\n")).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  test("keepalive is passed through to the request init", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1, keepalive: true, fetchImpl });

    transport.write(record, '{"a":1}');
    await transport.flush?.();

    expect(calls[0].init.keepalive).toBe(true);
  });
});

describe("httpTransport per-attempt abort signal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("timeoutMs <= 0 disables the abort signal (no `signal` on the request)", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    // timeoutMs: 0 -> attemptSignal returns undefined immediately (http.ts 205-207); init.signal is unset.
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1, timeoutMs: 0, fetchImpl });
    transport.write(record, '{"a":1}');
    await transport.flush?.();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal).toBeUndefined();
  });

  test("no abort signal is attached when the runtime lacks AbortSignal.timeout", async () => {
    // Stub AbortSignal without a `timeout` factory: attemptSignal returns undefined (http.ts 209).
    vi.stubGlobal("AbortSignal", {});
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1, timeoutMs: 5000, fetchImpl });
    transport.write(record, '{"a":1}');
    await transport.flush?.();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal).toBeUndefined();
  });
});

describe("httpTransport error reporting and custom encoders", () => {
  test("a failed batch with no onError is silently dropped (reportError early-returns)", async () => {
    // No onError -> reportError hits the `onError == null` early return (http.ts 224-226); nothing throws.
    const fetchImpl: FetchLike = async () => {
      throw new Error("network down");
    };
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1, retries: 0, fetchImpl });
    expect(() => transport.write(record, '{"a":1}')).not.toThrow();
    await expect(transport.flush?.()).resolves.toBeUndefined();
  });

  test("a custom encodeBody controls the request body and content-type", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 2,
      fetchImpl,
      // Custom encoder takes precedence over bodyFormat (http.ts 246).
      encodeBody: (lines) => ({ body: `COUNT=${lines.length}|${lines.join(";")}`, contentType: "application/x-custom" }),
    });
    transport.write(record, '{"a":1}');
    transport.write(record, '{"a":2}');
    await transport.flush?.();
    expect(calls).toHaveLength(1);
    expect(calls[0].init.body).toBe('COUNT=2|{"a":1};{"a":2}');
    expect(calls[0].init.headers["content-type"]).toBe("application/x-custom");
  });

  test("a throwing custom encodeBody fails the batch like a delivery error (reported, dropped)", async () => {
    const { calls, fetchImpl } = makeFakeFetch();
    const seen: { error: unknown; lines: readonly string[] }[] = [];
    const transport = httpTransport({
      url: "https://logs.example/ingest",
      batchSize: 1,
      fetchImpl,
      encodeBody: () => {
        throw new Error("encoder blew up");
      },
      onError: (error, lines) => seen.push({ error, lines }),
    });
    transport.write(record, '{"a":1}');
    await transport.flush?.();
    // The encoder threw before any fetch -> no request was made, batch reported + dropped (http.ts 247-252).
    expect(calls).toHaveLength(0);
    expect(seen).toHaveLength(1);
    expect((seen[0].error as Error).message).toBe("encoder blew up");
    expect(seen[0].lines).toEqual(['{"a":1}']);
  });
});
