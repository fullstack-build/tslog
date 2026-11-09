import { Logger } from "../src/index.node.js";
import type { ILogObjMeta } from "../src/interfaces.js";
import { getConsoleLogStripped, mockConsoleLog } from "./helper.js";

// Masking of values that serialize through `toJSON()` (#395). The masked clone keeps the source's
// prototype, so without special handling `JSON.stringify(clone)` would run the original `toJSON` on the
// clone: closure/internal state comes back unmasked, and `#private` reads throw and drop the line.

type AnyRecord = Record<string, unknown> & ILogObjMeta;

/** A hidden logger whose JSON lines are captured through an attached transport. */
function capture(mask: ConstructorParameters<typeof Logger<AnyRecord>>[0]["mask"]) {
  const lines: string[] = [];
  const logger = new Logger<AnyRecord>({ type: "hidden", stack: { capture: "off" }, mask });
  logger.attachTransport({ format: "json", write: (_record, line) => void lines.push(line) });
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, parsed };
}

class User {
  #password: string;
  constructor(
    public name: string,
    password: string,
  ) {
    this.#password = password;
  }
  toJSON() {
    return { name: this.name, password: this.#password };
  }
}

/** Keeps its data in an internal entries array, like an Immutable.js Map. */
class EntryMap {
  private readonly entries: [string, unknown][];
  constructor(data: Record<string, unknown>) {
    this.entries = Object.entries(data);
  }
  toJSON() {
    return Object.fromEntries(this.entries);
  }
}

describe("mask: values with toJSON()", () => {
  test("an own toJSON closure is masked by mask.keys", () => {
    const { logger, parsed } = capture({ keys: ["password"] });
    logger.info("login", { user: { toJSON: () => ({ name: "ada", password: "hunter2" }) } });
    expect(parsed()[0]?.user).toEqual({ name: "ada", password: "[***]" });
  });

  test("a class with #private fields is serialized and masked instead of dropping the line", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { logger, lines, parsed } = capture({ keys: ["password"] });
      logger.info("login", { user: new User("ada", "hunter2") });
      expect(lines).toHaveLength(1);
      expect(parsed()[0]?.user).toEqual({ name: "ada", password: "[***]" });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test("data held in internal structures (Immutable.js-style) is masked in the toJSON result", () => {
    const { logger, lines } = capture({ keys: ["password"] });
    logger.info("login", { user: new EntryMap({ name: "ada", password: "hunter2" }) });
    expect(lines[0]).not.toContain("hunter2");
    expect(JSON.parse(lines[0] as string).user).toEqual({ name: "ada", password: "[***]" });
  });

  test("mask.paths and mask.regex apply to the toJSON result at the value's position", () => {
    const { logger, parsed } = capture({ paths: ["user.password"], regex: [/tok_[a-z0-9]+/] });
    logger.info("login", { user: new User("ada", "hunter2"), session: { toJSON: () => "bearer tok_abc123" } });
    const line = parsed()[0];
    expect(line?.user).toEqual({ name: "ada", password: "[***]" });
    expect(line?.session).toBe("bearer [***]");
  });

  test("a toJSON that returns undefined still omits the field", () => {
    const { logger, parsed } = capture({ keys: ["password"] });
    logger.info("login", { hidden: { secret: 1, toJSON: () => undefined }, shown: 1 });
    expect(parsed()[0]).not.toHaveProperty("hidden");
    expect(parsed()[0]?.shown).toBe(1);
  });

  test("a toJSON that throws on the source falls back to the clone's masked own properties", () => {
    const { logger, parsed } = capture({ keys: ["password"] });
    const broken = {
      name: "ada",
      password: "hunter2",
      toJSON() {
        throw new Error("not serializable");
      },
    };
    logger.info("login", { user: broken });
    expect(parsed()[0]?.user).toEqual({ name: "ada", password: "[***]" });
  });

  test("a toJSON getter that throws does not break masking", () => {
    const { logger, parsed } = capture({ keys: ["password"] });
    const hostile = Object.defineProperty({ password: "hunter2" }, "toJSON", {
      enumerable: true,
      get() {
        throw new Error("no toJSON for you");
      },
    });
    logger.info("login", { user: hostile });
    expect(parsed()[0]?.user).toEqual({ password: "[***]", toJSON: null });
  });

  test("pretty output keeps the clone's own properties and hides the toJSON override", () => {
    mockConsoleLog(true, false);
    const logger = new Logger({ type: "pretty", stack: { capture: "off" }, mask: { keys: ["password"] } });
    logger.info("login", { user: new User("ada", "hunter2") });
    const output = getConsoleLogStripped();
    expect(output).toContain("User");
    expect(output).toContain("ada");
    expect(output).not.toContain("toJSON");
    expect(output).not.toContain("hunter2");
  });

  test("a non-Error cause with toJSON is masked in the pretty error block", () => {
    mockConsoleLog(true, false);
    const logger = new Logger({ type: "pretty", stack: { capture: "off" }, mask: { keys: ["password"] } });
    logger.error("login failed", new Error("db error", { cause: { toJSON: () => ({ password: "hunter2" }) } }));
    const output = getConsoleLogStripped();
    expect(output).toContain('{"password":"[***]"}');
    expect(output).not.toContain("hunter2");
  });
});

describe("default JSON sink: render failures are reported", () => {
  test("a throwing toJSON without masking reports the dropped line and the logger keeps working", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const writes: string[] = [];
    const logger = new Logger({ type: "json", stack: { capture: "off" } });
    // Route the default sink through console.log so the test sees what reaches it.
    (logger as unknown as { runtime: { writeJsonLine?: unknown } }).runtime.writeJsonLine = (line: string) => writes.push(line);
    try {
      logger.info("bad", {
        value: {
          toJSON() {
            throw new Error("cannot serialize");
          },
        },
      });
      expect(writes).toHaveLength(0);
      expect(errors).toHaveBeenCalledWith("tslog: could not render the JSON log line", expect.objectContaining({ message: "cannot serialize" }));

      logger.info("good");
      expect(writes).toHaveLength(1);
    } finally {
      errors.mockRestore();
    }
  });

  test("a console.error that throws while reporting is tolerated", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console broken");
    });
    try {
      const logger = new Logger({ type: "json", stack: { capture: "off" } });
      expect(() =>
        logger.info("bad", {
          toJSON() {
            throw new Error("cannot serialize");
          },
        }),
      ).not.toThrow();
    } finally {
      errors.mockRestore();
    }
  });
});
