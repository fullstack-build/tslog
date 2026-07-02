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
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1, fetchImpl, onError: (error) => seen.push(error) });

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
