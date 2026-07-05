import type { FetchLike, HttpResponseLike } from "../src/subpaths/transports/http.js";

// Covers the exit-hook wiring of the HTTP transport: the `flushAsync` closure it registers is only ever
// invoked when the process is about to exit, so this file mocks the exit-hook registry to capture the
// hook and drive its `flushAsync` directly. It lives in its own file (no static import of the transport)
// so the per-test `vi.doMock` reliably applies, and undoes the mock in afterEach so nothing leaks.

const record = {} as never;

async function loadHttpTransport(onRegister: (hook: { flushAsync?: () => Promise<void> | void }) => void) {
  const realHooks = await vi.importActual<typeof import("../src/internal/exitHooks.js")>("../src/internal/exitHooks.js");
  vi.doMock("../src/internal/exitHooks.js", () => ({
    ...realHooks,
    registerExitHook: (hook: { flushAsync?: () => Promise<void> | void }) => {
      onRegister(hook);
      return () => undefined;
    },
  }));
  vi.resetModules();
  return (await import("../src/subpaths/transports/http.js")).httpTransport;
}

describe("httpTransport exit-hook flushAsync", () => {
  afterEach(() => {
    vi.doUnmock("../src/internal/exitHooks.js");
    vi.resetModules();
  });

  test("the registered exit hook's flushAsync flushes the buffer through fetch", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (_url, init): Promise<HttpResponseLike> => {
      calls.push(init.body);
      return { ok: true, status: 200 };
    };
    let captured: { flushAsync?: () => Promise<void> | void } | undefined;
    const httpTransport = await loadHttpTransport((hook) => {
      captured = hook;
    });

    // Large batchSize so the write buffers without an automatic drain; the exit hook is registered on write.
    const transport = httpTransport({ url: "https://logs.example/ingest", batchSize: 1000, fetchImpl });
    transport.write(record, '{"exit":1}');
    expect(captured).toBeDefined();
    expect(typeof captured?.flushAsync).toBe("function");
    expect(calls).toHaveLength(0);

    // Invoke the captured flushAsync closure (http.ts 319): it calls transport.flush?.() -> the buffer
    // drains through fetch.
    await Promise.resolve(captured?.flushAsync?.());
    expect(calls).toEqual(['{"exit":1}']);

    await transport[Symbol.asyncDispose]?.();
  });
});
