import { Logger } from "../src/index.js";
import { getConsoleLogStripped, mockConsoleLog } from "./helper.js";

class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

describe("Advanced error handling", () => {
  test("custom error subclass with extra properties", () => {
    const logger = new Logger({ type: "hidden" });
    const err = new HttpError("Not Found", 404);
    const logObj = logger.info(err);

    expect(logObj?.nativeError).toBeInstanceOf(HttpError);
    expect(logObj?.name).toBe("HttpError");
    expect(logObj?.message).toBe("Not Found");
    expect(logObj?.stack).toBeInstanceOf(Array);
  });

  test("error cause chain serializes nested causes", () => {
    const logger = new Logger({ type: "hidden" });
    const root = new Error("root cause");
    const middle = new Error("middle", { cause: root });
    const outer = new Error("outer", { cause: middle });

    const logObj = logger.info(outer);

    expect(logObj?.name).toBe("Error");
    expect(logObj?.message).toBe("outer");
    expect(logObj?.cause).toBeDefined();
    expect(logObj?.cause?.message).toBe("middle");
    expect(logObj?.cause?.cause?.message).toBe("root cause");
  });

  test("deep cause chain is capped at max depth", () => {
    const logger = new Logger({ type: "hidden" });

    // Build 8-level chain, expect capped at 5
    let err: Error = new Error("level-0");
    for (let i = 1; i <= 7; i++) {
      err = new Error(`level-${i}`, { cause: err });
    }

    const logObj = logger.info(err);

    let current = logObj as Record<string, unknown> | undefined;
    let depth = 0;
    while (current?.cause != null) {
      depth++;
      current = current.cause as Record<string, unknown>;
    }

    expect(depth).toBeLessThanOrEqual(5);
  });

  test("non-Error cause value (string) is wrapped", () => {
    const logger = new Logger({ type: "hidden" });
    const err = new Error("main") as Error & { cause: string };
    err.cause = "string cause";

    const logObj = logger.info(err);

    expect(logObj?.cause).toBeDefined();
    expect(logObj?.cause?.nativeError).toBeInstanceOf(Error);
  });

  test("non-Error cause value (object) is wrapped", () => {
    const logger = new Logger({ type: "hidden" });
    const err = new Error("main") as Error & { cause: unknown };
    err.cause = { code: 404, msg: "not found" };

    const logObj = logger.info(err);

    expect(logObj?.cause).toBeDefined();
    expect(logObj?.cause?.nativeError).toBeInstanceOf(Error);
  });

  test("AggregateError is logged without throwing", () => {
    const logger = new Logger({ type: "hidden" });
    const agg = new AggregateError([new Error("e1"), new Error("e2")], "multiple errors");

    expect(() => {
      const logObj = logger.info(agg);
      expect(logObj).toBeDefined();
      expect(logObj?.name).toBe("AggregateError");
      expect(logObj?.message).toBe("multiple errors");
    }).not.toThrow();
  });

  test("error with empty stack does not throw", () => {
    const logger = new Logger({ type: "hidden" });
    const err = new Error("no stack");
    err.stack = undefined;

    expect(() => {
      const logObj = logger.info(err);
      expect(logObj).toBeDefined();
      expect(logObj?.stack).toBeInstanceOf(Array);
    }).not.toThrow();
  });

  test("error with non-standard stack format degrades gracefully", () => {
    const logger = new Logger({ type: "hidden" });
    const err = new Error("weird");
    err.stack = "CUSTOM_FORMAT: weird\n-- custom frame info --";

    expect(() => {
      const logObj = logger.info(err);
      expect(logObj).toBeDefined();
    }).not.toThrow();
  });

  test("TypeError and RangeError preserve correct name", () => {
    const logger = new Logger({ type: "hidden" });

    const typeErr = logger.info(new TypeError("bad type"));
    expect(typeErr?.name).toBe("TypeError");

    const rangeErr = logger.info(new RangeError("out of range"));
    expect(rangeErr?.name).toBe("RangeError");
  });

  describe("pretty error message with non-primitive property values", () => {
    beforeEach(() => {
      mockConsoleLog(true, false);
    });

    test("error property with null-prototype object does not throw", () => {
      const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
      const err = new Error("boom") as Error & { details: unknown };
      // Object.create(null) has no prototype, so String(value) throws
      // "Cannot convert object to primitive value".
      err.details = Object.create(null);

      expect(() => logger.error(err)).not.toThrow();
      expect(getConsoleLogStripped()).toContain("boom");
    });

    test("error property with throwing toString does not throw", () => {
      const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
      const err = new Error("kaboom") as Error & { payload: unknown };
      err.payload = {
        toString() {
          throw new Error("toString blew up");
        },
      };

      expect(() => logger.error(err)).not.toThrow();
      expect(getConsoleLogStripped()).toContain("kaboom");
    });

    test("error property with Symbol.toPrimitive returning object does not throw", () => {
      const logger = new Logger({ type: "pretty", stylePrettyLogs: false });
      const err = new Error("oops") as Error & { weird: unknown };
      err.weird = {
        [Symbol.toPrimitive]() {
          return {} as unknown as string;
        },
      };

      expect(() => logger.error(err)).not.toThrow();
      expect(getConsoleLogStripped()).toContain("oops");
    });
  });

  describe("hostile error causes never crash the logger", () => {
    test.each(["json", "pretty", "hidden"] as const)("type %s: an Error with a circular non-Error cause does not throw", (type) => {
      mockConsoleLog(true, false);
      const logger = new Logger({ type });
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => logger.error(new Error("boom", { cause: circular }))).not.toThrow();
    });

    test.each(["json", "pretty", "hidden"] as const)("type %s: an Error with a BigInt-bearing cause does not throw", (type) => {
      mockConsoleLog(true, false);
      const logger = new Logger({ type });

      expect(() => logger.error(new Error("boom", { cause: { n: 10n } }))).not.toThrow();
    });

    test("the circular cause still serializes into the cause chain", () => {
      const logger = new Logger({ type: "hidden" });
      const circular: Record<string, unknown> = { hint: "root" };
      circular.self = circular;

      const logObj = logger.error(new Error("boom", { cause: circular }));
      expect(logObj?.message).toBe("boom");
      expect(logObj?.cause?.message).toContain("[Circular]");
    });

    test.each(["json", "pretty", "hidden"] as const)("type %s: a throwing `cause` getter on the Error does not throw", (type) => {
      mockConsoleLog(true, false);
      const logger = new Logger({ type });
      const err = new Error("outer");
      Object.defineProperty(err, "cause", {
        enumerable: true,
        get() {
          throw new Error("boom from cause getter");
        },
      });

      expect(() => logger.error(err)).not.toThrow();
    });

    test.each(["json", "pretty", "hidden"] as const)("type %s: an Error cause with a hostile `stack` getter does not throw", (type) => {
      mockConsoleLog(true, false);
      const logger = new Logger({ type });
      const hostileCause = new Error("inner");
      Object.defineProperty(hostileCause, "stack", {
        get() {
          throw new Error("boom from stack getter");
        },
      });

      expect(() => logger.error(new Error("outer", { cause: hostileCause }))).not.toThrow();
    });

    test.each(["json", "pretty", "hidden"] as const)("type %s: hostile `name`/`message` getters on the Error do not throw", (type) => {
      mockConsoleLog(true, false);
      const logger = new Logger({ type });
      const err = new Error("outer");
      Object.defineProperty(err, "name", {
        get() {
          throw new Error("boom from name getter");
        },
      });

      expect(() => logger.error(err)).not.toThrow();
    });
  });
});
