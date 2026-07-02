import { createAsyncContextStore, resolveAsyncLocalStorage } from "../src/core/asyncContext.js";
import { Logger } from "../src/index.js";

// M2.13 — async context (AsyncLocalStorage) propagation: logger.runInContext(ctx, fn) attaches the active
// context's fields onto every log's _meta, and getContext() exposes the active context (otel trace getter).

interface CtxLog {
  _meta: { requestId?: string; traceId?: string; region?: string; logLevelName?: string };
}

describe("runInContext attaches context fields onto _meta", () => {
  test("synchronous log inside runInContext sees the context", () => {
    const logger = new Logger<CtxLog>({ type: "hidden" });
    const record = logger.runInContext({ requestId: "req-1" }, () => logger.info("hello"));
    expect(record?._meta.requestId).toBe("req-1");
  });

  test("a log outside any context has no context fields", () => {
    const logger = new Logger<CtxLog>({ type: "hidden" });
    const record = logger.info("no context");
    expect(record?._meta.requestId).toBeUndefined();
  });

  test("context propagates across awaits", async () => {
    const logger = new Logger<CtxLog>({ type: "hidden" });
    const record = await logger.runInContext({ requestId: "req-async" }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return logger.info("after awaits");
    });
    expect(record?._meta.requestId).toBe("req-async");
  });

  test("nested contexts inherit and override parent fields", () => {
    const logger = new Logger<CtxLog>({ type: "hidden" });
    const result = logger.runInContext({ requestId: "outer", region: "eu" }, () => {
      const outer = logger.info("outer");
      const inner = logger.runInContext({ requestId: "inner" }, () => logger.info("inner"));
      const afterInner = logger.info("after inner");
      return { outer, inner, afterInner };
    });
    expect(result.outer?._meta.requestId).toBe("outer");
    expect(result.outer?._meta.region).toBe("eu");
    // nested context overrides requestId but inherits region from the parent
    expect(result.inner?._meta.requestId).toBe("inner");
    expect(result.inner?._meta.region).toBe("eu");
    // leaving the nested scope restores the parent context
    expect(result.afterInner?._meta.requestId).toBe("outer");
  });

  test("concurrent contexts do not bleed into each other", async () => {
    const logger = new Logger<CtxLog>({ type: "hidden" });
    const [a, b] = await Promise.all([
      logger.runInContext({ requestId: "A" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return logger.info("a");
      }),
      logger.runInContext({ requestId: "B" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return logger.info("b");
      }),
    ]);
    expect(a?._meta.requestId).toBe("A");
    expect(b?._meta.requestId).toBe("B");
  });

  test("sub-loggers inherit the parent's active context", () => {
    const parent = new Logger<CtxLog>({ type: "hidden" });
    const record = parent.runInContext({ requestId: "shared" }, () => {
      const child = parent.getSubLogger({ name: "child" });
      return child.info("from child");
    });
    expect(record?._meta.requestId).toBe("shared");
  });

  test("middleware-stashed meta wins over an inherited context field", () => {
    const logger = new Logger<CtxLog>({ type: "hidden" });
    logger.use((ctx) => {
      ctx.meta.requestId = "from-middleware";
      return ctx;
    });
    const record = logger.runInContext({ requestId: "from-context" }, () => logger.info("collision"));
    expect(record?._meta.requestId).toBe("from-middleware");
  });
});

describe("attachContextToMeta toggles the auto-attach", () => {
  test("disabled: context is NOT attached to _meta but getContext still works", () => {
    const logger = new Logger<CtxLog>({ type: "hidden", meta: { attachContext: false } });
    const record = logger.runInContext({ requestId: "req-x" }, () => {
      expect(logger.getContext()?.requestId).toBe("req-x");
      return logger.info("not attached");
    });
    expect(record?._meta.requestId).toBeUndefined();
  });
});

describe("getContext as an otel-style trace getter", () => {
  test("returns the active context inside runInContext and undefined outside", () => {
    const logger = new Logger<CtxLog>({ type: "hidden" });
    expect(logger.getContext()).toBeUndefined();
    logger.runInContext({ traceId: "trace-abc" }, () => {
      expect(logger.getContext()?.traceId).toBe("trace-abc");
    });
    expect(logger.getContext()).toBeUndefined();
  });
});

describe("graceful no-op fallback when AsyncLocalStorage is unavailable", () => {
  test("a no-op store runs the function but propagates no context", () => {
    // Simulate the browser/edge path: a runtime where the resolved AsyncLocalStorage constructor throws on
    // instantiation. createAsyncContextStore must catch and fall back to the graceful no-op store.
    const ThrowingCtor = class {
      constructor() {
        throw new Error("AsyncLocalStorage unavailable");
      }
    } as unknown as new <T>() => { run<R>(s: T, f: () => R): R; getStore(): T | undefined };
    const store = createAsyncContextStore(ThrowingCtor);
    expect(store.enabled).toBe(false);
    const value = store.run({ requestId: "ignored" }, () => {
      expect(store.getStore()).toBeUndefined();
      return 42;
    });
    expect(value).toBe(42);
  });

  test("resolveAsyncLocalStorage finds AsyncLocalStorage on Node", () => {
    // On Node this resolves a constructor (via process.getBuiltinModule); the enabled store propagates.
    const ctor = resolveAsyncLocalStorage();
    expect(typeof ctor).toBe("function");
    const store = createAsyncContextStore(ctor);
    expect(store.enabled).toBe(true);
    const seen = store.run({ k: "v" }, () => store.getStore());
    expect(seen).toEqual({ k: "v" });
  });

  test("resolveAsyncLocalStorage prefers a global AsyncLocalStorage when present", () => {
    // Some runtimes/polyfills expose AsyncLocalStorage on globalThis; that path takes precedence.
    const g = globalThis as { AsyncLocalStorage?: unknown };
    const original = g.AsyncLocalStorage;
    const Sentinel = function Sentinel() {} as unknown;
    try {
      g.AsyncLocalStorage = Sentinel;
      expect(resolveAsyncLocalStorage()).toBe(Sentinel);
    } finally {
      if (original === undefined) {
        delete g.AsyncLocalStorage;
      } else {
        g.AsyncLocalStorage = original;
      }
    }
  });

  test("createAsyncContextStore() returns a no-op store when no AsyncLocalStorage is resolvable", () => {
    // Hide both resolution paths so resolveAsyncLocalStorage() yields undefined and the default no-op runs.
    const g = globalThis as { AsyncLocalStorage?: unknown };
    const proc = (globalThis as { process?: { getBuiltinModule?: unknown } }).process;
    const originalGlobal = g.AsyncLocalStorage;
    const originalGetBuiltin = proc?.getBuiltinModule;
    try {
      delete g.AsyncLocalStorage;
      if (proc != null) {
        delete proc.getBuiltinModule;
      }
      expect(resolveAsyncLocalStorage()).toBeUndefined();
      const store = createAsyncContextStore();
      expect(store.enabled).toBe(false);
      expect(store.run({ x: 1 }, () => store.getStore())).toBeUndefined();
    } finally {
      if (originalGlobal !== undefined) {
        g.AsyncLocalStorage = originalGlobal;
      }
      if (proc != null && originalGetBuiltin !== undefined) {
        proc.getBuiltinModule = originalGetBuiltin as never;
      }
    }
  });
});
