import { Logger } from "../src/index.js";
import { safeEnvGet } from "../src/internal/environment.js";

/**
 * Deno's `process.env` is a permission-checked proxy: obtaining the bag succeeds, but each individual
 * property GET throws `NotCapable` without `--allow-env`. Before the guards, `import "tslog"` / `new
 * Logger()` crashed a permissionless Deno process (hostname/CI/NO_COLOR/TSLOG_* reads). These tests
 * simulate that proxy on Node: every string-keyed property read of `process.env` throws.
 */
describe("env access guards (Deno --allow-env safety)", () => {
  const proc = globalThis.process as NodeJS.Process;
  let originalEnvDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalEnvDescriptor = Object.getOwnPropertyDescriptor(proc, "env");
    const throwingEnv = new Proxy({} as Record<string, string | undefined>, {
      get(_target, prop): string | undefined {
        if (typeof prop === "string") {
          throw new Error(`NotCapable: Requires env access to "${prop}", run again with the --allow-env flag`);
        }
        return undefined;
      },
    });
    Object.defineProperty(proc, "env", { value: throwingEnv, configurable: true });
  });

  afterEach(() => {
    if (originalEnvDescriptor != null) {
      Object.defineProperty(proc, "env", originalEnvDescriptor);
    }
  });

  test("safeEnvGet returns undefined instead of propagating the permission error", () => {
    expect(safeEnvGet("HOSTNAME")).toBeUndefined();
    expect(safeEnvGet("NO_COLOR")).toBeUndefined();
  });

  test("constructing a zero-config logger does not throw when every env read throws", () => {
    expect(() => new Logger()).not.toThrow();
  });

  test("constructing and logging works when the env is unreadable", () => {
    let logObj: unknown;
    expect(() => {
      const logger = new Logger({ type: "hidden" });
      logObj = logger.info("hello without env access");
    }).not.toThrow();
    expect(logObj).toBeDefined();
  });

  test("Logger.fromEnv does not throw when the env is unreadable", () => {
    expect(() => Logger.fromEnv({ type: "hidden" })).not.toThrow();
  });
});
