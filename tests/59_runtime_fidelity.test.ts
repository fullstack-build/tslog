import { AsyncLocalStorage } from "node:async_hooks";
import { createUniversalEnvironment } from "../src/env/environment.universal.js";
import { createRuntimeMeta, detectRuntimeInfo, getEnvironmentHostname, resolveHermesVersion } from "../src/env/shared.js";
import { Logger, TslogConfigError } from "../src/index.node.js";
import { Logger as UniversalLogger } from "../src/index.universal.js";
import type { IMeta, IStackFrame } from "../src/interfaces.js";
import { isReactNativeEnvironment, resolveDefaultType } from "../src/internal/environment.js";

// Runtime fidelity: React Native detection, real hostname resolution, the contextStorage injection
// seam (Cloudflare Workers), and NO_COLOR yielding uncolored pretty instead of JSON on a TTY.

const globalAny = globalThis as Record<string, unknown>;

function withStubbedGlobals(run: () => void): void {
  const saved: Record<string, unknown> = {
    window: globalAny.window,
    document: globalAny.document,
    location: globalAny.location,
    Deno: globalAny.Deno,
    Bun: globalAny.Bun,
    importScripts: globalAny.importScripts,
    process: globalAny.process,
    HermesInternal: globalAny.HermesInternal,
  };
  try {
    run();
  } finally {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete globalAny[key];
      } else {
        globalAny[key] = value;
      }
    }
  }
}

describe("React Native detection", () => {
  test("navigator.product === 'ReactNative' is detected even with a process global present", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;
      // RN ships a shimmed `process` global; it must not shadow the RN detection into the node branch.
      globalAny.process = { env: {} };
      vi.stubGlobal("navigator", { product: "ReactNative" });

      expect(isReactNativeEnvironment()).toBe(true);
      const info = detectRuntimeInfo();
      expect(info.name).toBe("react-native");
      expect(info.hostname).toBeUndefined();
    });
  });

  test("a real browser's frozen legacy product ('Gecko') never claims React Native", () => {
    withStubbedGlobals(() => {
      globalAny.window = {};
      globalAny.document = {};
      vi.stubGlobal("navigator", { product: "Gecko", userAgent: "Mozilla/5.0" });

      expect(isReactNativeEnvironment()).toBe(false);
      expect(detectRuntimeInfo().name).toBe("browser");
    });
  });

  test("Hermes engine version lands in runtimeVersion; JSC omits the key; hostname is never emitted", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;
      vi.stubGlobal("navigator", { product: "ReactNative" });
      globalAny.HermesInternal = { getRuntimeProperties: () => ({ "OSS Release Version": "0.12.0" }) };

      expect(resolveHermesVersion()).toBe("hermes/0.12.0");
      const hermesMeta = createRuntimeMeta(detectRuntimeInfo());
      expect(hermesMeta.runtime).toBe("react-native");
      expect(hermesMeta.runtimeVersion).toBe("hermes/0.12.0");
      expect("hostname" in hermesMeta).toBe(false);

      delete globalAny.HermesInternal;
      expect(resolveHermesVersion()).toBeUndefined();
      const jscMeta = createRuntimeMeta(detectRuntimeInfo());
      expect(jscMeta.runtime).toBe("react-native");
      expect("runtimeVersion" in jscMeta).toBe(false);
    });
  });

  test("a hostile HermesInternal.getRuntimeProperties never breaks detection", () => {
    withStubbedGlobals(() => {
      globalAny.HermesInternal = {
        getRuntimeProperties: () => {
          throw new Error("nope");
        },
      };
      expect(resolveHermesVersion()).toBeUndefined();
    });
  });

  test("the universal provider parses the REAL frame shapes RN engines emit (Hermes dev/release, JSC dev/release)", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;
      globalAny.process = { env: {} };
      vi.stubGlobal("navigator", { product: "ReactNative" });

      const env = createUniversalEnvironment();
      // Hermes (RN's default engine) emits V8-STYLE frames; JSC emits `fn@location:line:col` where the
      // location is a Metro dev-server URL (single path segment, line/col AFTER the query string) or a
      // bare bundle name with no slash at all. All four must yield a usable frame.
      const cases: Array<{ label: string; line: string; fileName: string; method?: string }> = [
        {
          label: "Hermes dev (Metro URL, position after the query)",
          line: "    at handlePress (http://localhost:8081/index.bundle?platform=ios&dev=true&minify=false:117:42)",
          fileName: "index.bundle",
          method: "handlePress",
        },
        {
          label: "Hermes Android release (bytecode 'address at', bare bundle name)",
          line: "    at handlePress (address at index.android.bundle:117:42)",
          fileName: "index.android.bundle",
          method: "handlePress",
        },
        {
          label: "JSC release (bare bundle name, no slash)",
          line: "handlePress@main.jsbundle:117:42",
          fileName: "main.jsbundle",
          method: "handlePress",
        },
        {
          label: "JSC dev (Metro URL)",
          line: "handlePress@http://localhost:8081/index.bundle?platform=ios&dev=true:117:42",
          fileName: "index.bundle",
          method: "handlePress",
        },
      ];

      for (const { label, line, fileName, method } of cases) {
        const error = { stack: `Error: boom\n${line}` } as Error;
        const frames: IStackFrame[] = env.getErrorTrace(error);
        expect(frames, label).toHaveLength(1);
        expect(frames[0]?.fileName, label).toBe(fileName);
        expect(frames[0]?.fileLine, label).toBe("117");
        expect(frames[0]?.fileColumn, label).toBe("42");
        expect(frames[0]?.method, label).toBe(method);
      }
    });
  });

  test("React Native defaults to pretty output", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.process = { env: {} };
      vi.stubGlobal("navigator", { product: "ReactNative" });

      expect(resolveDefaultType()).toBe("pretty");
    });
  });
});

describe("hostname resolution via process.getBuiltinModule('node:os')", () => {
  test("os.hostname() is used when no HOSTNAME/HOST/COMPUTERNAME env var is set", () => {
    const hostname = getEnvironmentHostname({
      env: {},
      getBuiltinModule: (id: string) => (id === "node:os" ? { hostname: () => "os-host" } : undefined),
    });
    expect(hostname).toBe("os-host");
  });

  test("an explicit HOSTNAME env var wins over os.hostname()", () => {
    const hostname = getEnvironmentHostname({
      env: { HOSTNAME: "env-host" },
      getBuiltinModule: () => ({ hostname: () => "os-host" }),
    });
    expect(hostname).toBe("env-host");
  });

  test("a throwing getBuiltinModule (Deno without --allow-sys) falls through to location.hostname", () => {
    const hostname = getEnvironmentHostname(
      {
        env: {},
        getBuiltinModule: () => {
          throw new Error("NotCapable");
        },
      },
      undefined,
      undefined,
      { hostname: "loc-host" },
    );
    expect(hostname).toBe("loc-host");
  });

  test("an empty os.hostname() result falls through instead of masking later fallbacks", () => {
    const hostname = getEnvironmentHostname({ env: {}, getBuiltinModule: () => ({ hostname: () => "" }) }, undefined, undefined, {
      hostname: "loc-host",
    });
    expect(hostname).toBe("loc-host");
  });

  test("HOSTNAME env var wins over Deno.hostname(), which wins over location", () => {
    expect(getEnvironmentHostname({ env: { HOSTNAME: "env-host" } }, { hostname: () => "deno-host" })).toBe("env-host");
    expect(getEnvironmentHostname({ env: {} }, { hostname: () => "deno-host" }, undefined, { hostname: "loc-host" })).toBe("deno-host");
  });

  test("the node runtime meta carries the OS hostname instead of 'unknown'", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;
      globalAny.process = {
        versions: { node: "22.0.0" },
        env: {},
        getBuiltinModule: (id: string) => (id === "node:os" ? { hostname: () => "metal-42" } : undefined),
      };

      const meta = createRuntimeMeta(detectRuntimeInfo());
      expect(meta.runtime).toBe("node");
      expect(meta.hostname).toBe("metal-42");
    });
  });
});

describe("NO_COLOR yields uncolored pretty, not JSON (https://no-color.org)", () => {
  test("NO_COLOR on an interactive TTY keeps type 'pretty' with styling off", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.process = { versions: { node: "22.0.0" }, env: { NO_COLOR: "1" }, stdout: { isTTY: true } };

      expect(resolveDefaultType()).toBe("pretty");
      const logger = new Logger({ minLevel: "FATAL" });
      expect(logger.settings.type).toBe("pretty");
      expect(logger.settings.pretty.style).toBe(false);
    });
  });

  test("an EXPLICIT pretty.style wins over NO_COLOR and FORCE_COLOR", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.process = { versions: { node: "22.0.0" }, env: { NO_COLOR: "1" }, stdout: { isTTY: true } };
      const styled = new Logger({ type: "pretty", minLevel: "FATAL", pretty: { style: true } });
      expect(styled.settings.pretty.style).toBe(true);

      globalAny.process = { versions: { node: "22.0.0" }, env: { FORCE_COLOR: "1" }, stdout: { isTTY: true } };
      const plain = new Logger({ type: "pretty", minLevel: "FATAL", pretty: { style: false } });
      expect(plain.settings.pretty.style).toBe(false);
    });
  });

  test("NO_COLOR without a TTY still defaults to json", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.process = { versions: { node: "22.0.0" }, env: { NO_COLOR: "1" }, stdout: {} };
      expect(resolveDefaultType()).toBe("json");
    });
  });

  test("CI on a TTY still defaults to json", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      globalAny.process = { versions: { node: "22.0.0" }, env: { CI: "true" }, stdout: { isTTY: true } };
      expect(resolveDefaultType()).toBe("json");
    });
  });
});

describe("contextStorage injection seam", () => {
  interface CtxLog {
    _meta: IMeta & { requestId?: string; region?: string };
  }

  /** A synchronous stand-in for AsyncLocalStorage proving the INJECTED instance is what tslog uses. */
  function createFakeStorage() {
    let current: Record<string, unknown> | undefined;
    let runCalls = 0;
    return {
      run<T>(store: Record<string, unknown>, fn: () => T): T {
        runCalls++;
        const previous = current;
        current = store;
        try {
          return fn();
        } finally {
          current = previous;
        }
      },
      getStore: () => current,
      get runCalls() {
        return runCalls;
      },
    };
  }

  test("an injected storage instance carries the context onto _meta", () => {
    const storage = createFakeStorage();
    const logger = new Logger<CtxLog>({ type: "hidden", contextStorage: storage });

    const record = logger.runInContext({ requestId: "req-9" }, () => logger.info("hello"));
    expect(record?._meta.requestId).toBe("req-9");
    expect(storage.runCalls).toBe(1);
  });

  test("nested runInContext merges parent fields through the injected storage", () => {
    const storage = createFakeStorage();
    const logger = new Logger<CtxLog>({ type: "hidden", contextStorage: storage });

    const record = logger.runInContext({ requestId: "outer", region: "eu" }, () => logger.runInContext({ requestId: "inner" }, () => logger.info("nested")));
    expect(record?._meta.requestId).toBe("inner");
    expect(record?._meta.region).toBe("eu");
  });

  test("a real AsyncLocalStorage instance propagates across awaits", async () => {
    const logger = new Logger<CtxLog>({ type: "hidden", contextStorage: new AsyncLocalStorage() });
    const record = await logger.runInContext({ requestId: "als-1" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return logger.info("after await");
    });
    expect(record?._meta.requestId).toBe("als-1");
  });

  test("sub-loggers inherit the injected storage, even when created before any runInContext", () => {
    const storage = createFakeStorage();
    const parent = new Logger<CtxLog>({ type: "hidden", contextStorage: storage });
    const child = parent.getSubLogger({ name: "child" });

    const record = parent.runInContext({ requestId: "shared" }, () => child.info("from child"));
    expect(record?._meta.requestId).toBe("shared");
  });

  test("auto-resolved AsyncLocalStorage: a child created BEFORE the first runInContext still sees the context", () => {
    // Regression guard for the shared store box: materialization order must not decide whether a
    // family member observes the context.
    const parent = new Logger<CtxLog>({ type: "hidden" });
    const child = parent.getSubLogger({ name: "early-child" });

    const record = parent.runInContext({ requestId: "family" }, () => child.info("from child"));
    expect(record?._meta.requestId).toBe("family");
  });

  test("a context entered via the injected instance's own run() is visible with NO prior runInContext", () => {
    const als = new AsyncLocalStorage<Record<string, unknown>>();
    const logger = new Logger<CtxLog>({ type: "hidden", contextStorage: als });
    // App code (e.g. a Workers middleware) drives the storage directly; tslog must still attach it.
    const record = als.run({ requestId: "direct" }, () => logger.info("first call")) as CtxLog | undefined;
    expect(record?._meta.requestId).toBe("direct");
  });

  test("the caller's ctx object is copied: mutating it after runInContext starts does not rewrite logs", () => {
    const logger = new Logger<CtxLog>({ type: "hidden", contextStorage: new AsyncLocalStorage() });
    const ctx: Record<string, unknown> = { requestId: "original" };
    const record = logger.runInContext(ctx, () => {
      ctx.requestId = "mutated";
      return logger.info("x");
    });
    expect(record?._meta.requestId).toBe("original");
  });

  test("a malformed contextStorage warns at construction and degrades to no-op", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const logger = new Logger<CtxLog>({ type: "hidden", contextStorage: {} as never });
      const output = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(output).toContain("contextStorage");

      // Still runs the function; simply no propagation.
      const record = logger.runInContext({ requestId: "lost" }, () => logger.info("noop"));
      expect(record?._meta.requestId).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("one malformed contextStorage warns once, not once per sub-logger", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const root = new Logger({ type: "hidden", contextStorage: {} as never });
      root.getSubLogger({ name: "a" }).getSubLogger({ name: "b" });
      const warnings = warnSpy.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("contextStorage"));
      expect(warnings).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("strictConfig turns a malformed contextStorage into a typed error", () => {
    expect(() => new Logger({ type: "hidden", strictConfig: true, contextStorage: {} as never })).toThrow(TslogConfigError);
  });

  test("runInContext warns ONCE when no AsyncLocalStorage is available at all", () => {
    withStubbedGlobals(() => {
      delete globalAny.window;
      delete globalAny.document;
      delete globalAny.Deno;
      delete globalAny.Bun;
      delete globalAny.importScripts;
      // No getBuiltinModule and no global AsyncLocalStorage: the universal probe finds nothing.
      globalAny.process = { versions: { node: "22.0.0" }, env: {} };

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const logger = new UniversalLogger<CtxLog>({ type: "hidden" });
        const record = logger.runInContext({ requestId: "edge" }, () => logger.info("still logs"));
        logger.runInContext({ requestId: "again" }, () => undefined);

        // The function ran, nothing propagated, and exactly one warning points at the fix.
        expect(record?._meta.requestId).toBeUndefined();
        const warnings = warnSpy.mock.calls.map((call) => String(call[0])).filter((message) => message.includes("AsyncLocalStorage"));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("contextStorage");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
