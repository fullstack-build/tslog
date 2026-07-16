import { LogLevel } from "../src/index.js";
import { createLiteLogger, LiteLogger, lite } from "../src/subpaths/lite.js";

// M3.12 — `tslog/lite`: minimal leveled console wrappers (silly..fatal) that forward straight to the
// native console with no masking/stack/clone/meta, with minLevel filtering and a ready instance.

/** A console-shaped stub recording calls per method, used as the lite sink. */
function makeSink() {
  const calls: Record<string, unknown[][]> = { debug: [], info: [], warn: [], error: [], log: [] };
  return {
    sink: {
      debug: (...a: unknown[]) => calls.debug.push(a),
      info: (...a: unknown[]) => calls.info.push(a),
      warn: (...a: unknown[]) => calls.warn.push(a),
      error: (...a: unknown[]) => calls.error.push(a),
      log: (...a: unknown[]) => calls.log.push(a),
    } as Partial<Console>,
    calls,
  };
}

describe("LiteLogger level → console method mapping", () => {
  test("each level forwards to the matching native console method", () => {
    const { sink, calls } = makeSink();
    const log = new LiteLogger({ console: sink });

    log.silly("s");
    log.trace("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    log.fatal("f");

    // silly/trace/debug -> console.debug
    expect(calls.debug).toEqual([["s"], ["t"], ["d"]]);
    // info -> console.info
    expect(calls.info).toEqual([["i"]]);
    // warn -> console.warn
    expect(calls.warn).toEqual([["w"]]);
    // error + fatal -> console.error
    expect(calls.error).toEqual([["e"], ["f"]]);
  });

  test("forwards every argument unchanged (no clone/mask/meta)", () => {
    const { sink, calls } = makeSink();
    const log = new LiteLogger({ console: sink });
    const obj = { token: "secret", nested: { a: 1 } };

    log.info("msg", obj, 42);

    expect(calls.info).toHaveLength(1);
    const args = calls.info[0];
    expect(args[0]).toBe("msg");
    expect(args[1]).toBe(obj); // same reference: not cloned
    expect(args[1]).toEqual({ token: "secret", nested: { a: 1 } }); // not masked
    expect(args[2]).toBe(42);
  });
});

describe("LiteLogger minLevel filtering", () => {
  test("levels below minLevel are suppressed", () => {
    const { sink, calls } = makeSink();
    const log = new LiteLogger({ minLevel: "WARN", console: sink });

    log.silly("s");
    log.trace("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    log.fatal("f");

    expect(calls.debug).toEqual([]); // silly/trace/debug suppressed
    expect(calls.info).toEqual([]); // info suppressed
    expect(calls.warn).toEqual([["w"]]);
    expect(calls.error).toEqual([["e"], ["f"]]);
  });

  test("minLevel accepts a numeric id and the enum", () => {
    const { sink, calls } = makeSink();
    const numeric = new LiteLogger({ minLevel: 3, console: sink });
    expect(numeric.minLevel).toBe(3);
    numeric.debug("d");
    numeric.info("i");
    expect(calls.debug).toEqual([]);
    expect(calls.info).toEqual([["i"]]);

    const fromEnum = new LiteLogger({ minLevel: LogLevel.ERROR, console: sink });
    expect(fromEnum.minLevel).toBe(5);
  });

  test("unresolvable minLevel falls back to 0 (logs everything)", () => {
    const { sink, calls } = makeSink();
    const log = new LiteLogger({ minLevel: "NOPE" as unknown as LogLevel, console: sink });
    expect(log.minLevel).toBe(0);
    log.silly("s");
    expect(calls.debug).toEqual([["s"]]);
  });

  test("suppressed levels share a single no-op function", () => {
    const { sink } = makeSink();
    const log = new LiteLogger({ minLevel: "ERROR", console: sink });
    expect(log.silly).toBe(log.debug); // all below-minLevel methods are the same no-op
    expect(log.error).not.toBe(log.silly);
  });

  test("isLevelEnabled reflects minLevel and honors level names", () => {
    const log = new LiteLogger({ minLevel: "WARN" });
    expect(log.isLevelEnabled("ERROR")).toBe(true);
    expect(log.isLevelEnabled("WARN")).toBe(true);
    expect(log.isLevelEnabled("INFO")).toBe(false);
    expect(log.isLevelEnabled(LogLevel.SILLY)).toBe(false);
  });
});

describe("LiteLogger factory and ready instance", () => {
  test("createLiteLogger returns an equivalent LiteLogger", () => {
    const { sink, calls } = makeSink();
    const log = createLiteLogger({ minLevel: "INFO", console: sink });
    expect(log).toBeInstanceOf(LiteLogger);
    log.debug("d");
    log.info("i");
    expect(calls.debug).toEqual([]);
    expect(calls.info).toEqual([["i"]]);
  });

  test("the ready `lite` instance is a default-level LiteLogger", () => {
    expect(lite).toBeInstanceOf(LiteLogger);
    expect(lite.minLevel).toBe(0);
    expect(lite.isLevelEnabled("SILLY")).toBe(true);
    // The level methods are bound native console functions.
    expect(typeof lite.info).toBe("function");
    expect(typeof lite.silly).toBe("function");
  });

  test("a freshly built logger over the live console routes to console.* (line numbers preserved)", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    // Build AFTER spying so the bound method captures the spy — proving methods bind the live console.
    const log = new LiteLogger();
    log.info("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });

  test("falls back to console.log when the matching method is missing", () => {
    const calls: unknown[][] = [];
    const sink = { log: (...a: unknown[]) => calls.push(a) } as Partial<Console>;
    const log = new LiteLogger({ console: sink });
    log.warn("w");
    log.error("e");
    expect(calls).toEqual([["w"], ["e"]]);
  });
});

// Named loggers and getSubLogger(): the label is partially applied with .bind() so the level methods
// stay native console functions and devtools keeps blaming the caller (RECIPES 12c).
describe("LiteLogger name and getSubLogger", () => {
  const LEVELS = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;

  test("a named logger prepends its label and leaves logged arguments untouched", () => {
    const { sink, calls } = makeSink();
    const payload = { id: 7 };

    new LiteLogger({ name: "app", console: sink }).info("add to cart", payload);

    expect(calls.info).toHaveLength(1);
    expect(calls.info[0][0]).toBe("app");
    expect(calls.info[0][1]).toBe("add to cart");
    expect(calls.info[0][2]).toBe(payload); // same reference: still inspectable in devtools
  });

  test("getSubLogger joins its name onto the parent's", () => {
    const { sink, calls } = makeSink();
    const app = new LiteLogger({ name: "app", console: sink });

    app.getSubLogger({ name: "cart" }).info("checkout");

    expect(calls.info).toEqual([["app:cart", "checkout"]]);
  });

  test("sub-loggers nest to any depth and honor a custom nameSeparator", () => {
    const { sink, calls } = makeSink();
    const app = new LiteLogger({ name: "app", console: sink, nameSeparator: "/" });

    app.getSubLogger({ name: "cart" }).getSubLogger({ name: "checkout" }).warn("slow");

    expect(calls.warn).toEqual([["app/cart/checkout", "slow"]]);
  });

  test("an unnamed parent adopts the child's name, and an unnamed child keeps the parent's", () => {
    const { sink, calls } = makeSink();

    new LiteLogger({ console: sink }).getSubLogger({ name: "cart" }).info("a");
    new LiteLogger({ name: "app", console: sink }).getSubLogger().info("b");
    new LiteLogger({ console: sink }).getSubLogger().info("c");

    expect(calls.info).toEqual([["cart", "a"], ["app", "b"], ["c"]]); // unlabeled logs stay bare
  });

  test("sub-loggers inherit minLevel and sink but can override them", () => {
    const { sink, calls } = makeSink();
    const other = makeSink();
    const app = new LiteLogger({ name: "app", minLevel: "WARN", console: sink });

    const inherited = app.getSubLogger({ name: "cart" });
    expect(inherited.minLevel).toBe(4);
    inherited.debug("suppressed");
    inherited.warn("emitted");
    expect(calls.debug).toEqual([]);
    expect(calls.warn).toEqual([["app:cart", "emitted"]]);

    const overridden = app.getSubLogger({ name: "loud", minLevel: "SILLY", console: other.sink });
    overridden.debug("verbose");
    expect(other.calls.debug).toEqual([["app:loud", "verbose"]]);
    expect(calls.debug).toEqual([]); // parent's sink untouched
  });

  test("child() is an alias of getSubLogger()", () => {
    const { sink, calls } = makeSink();
    new LiteLogger({ name: "app", console: sink }).child({ name: "cart" }).error("boom");
    expect(calls.error).toEqual([["app:cart", "boom"]]);
  });

  test("sub-logger level methods stay native functions, so devtools blames the caller", () => {
    const log = new LiteLogger({ name: "app" }).getSubLogger({ name: "cart" });

    // The whole point of the module: Function.prototype.bind returns a native function, so the
    // runtime attributes the log to the call site. A wrapper (`(...a) => console.info(label, ...a)`)
    // would be user code and would capture the badge itself.
    for (const level of LEVELS) {
      expect(Function.prototype.toString.call(log[level])).toContain("[native code]");
    }
  });

  test("an empty name is treated as no name", () => {
    const { sink, calls } = makeSink();
    const log = new LiteLogger({ name: "", console: sink });
    expect(log.name).toBeUndefined();
    log.info("bare");
    expect(calls.info).toEqual([["bare"]]);
  });

  test("createLiteLogger accepts a name too", () => {
    const { sink, calls } = makeSink();
    createLiteLogger({ name: "app", console: sink }).info("hi");
    expect(calls.info).toEqual([["app", "hi"]]);
  });
});
