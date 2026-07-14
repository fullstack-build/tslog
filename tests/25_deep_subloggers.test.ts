import { Logger } from "../src/index.js";

describe("Deep sub-loggers", () => {
  test("5-level chain preserves all parentNames", () => {
    const l1 = new Logger({ type: "hidden", name: "root" });
    const l2 = l1.getSubLogger({ name: "child1" });
    const l3 = l2.getSubLogger({ name: "child2" });
    const l4 = l3.getSubLogger({ name: "child3" });
    const l5 = l4.getSubLogger({ name: "child4" });

    const logObj = l5.info("deep log");
    const meta = logObj?._logMeta;

    expect(meta?.name).toBe("child4");
    expect(meta?.parentNames).toEqual(["root", "child1", "child2", "child3"]);
  });

  test("deep chain accumulates prefixes from all ancestors", () => {
    const l1 = new Logger({ type: "hidden", prefix: ["[P1]"] });
    const l2 = l1.getSubLogger({ prefix: ["[P2]"] });
    const l3 = l2.getSubLogger({ prefix: ["[P3]"] });
    const l4 = l3.getSubLogger({ prefix: ["[P4]"] });

    const logObj = l4.info("msg");

    expect(logObj?.["0"]).toBe("[P1]");
    expect(logObj?.["1"]).toBe("[P2]");
    expect(logObj?.["2"]).toBe("[P3]");
    expect(logObj?.["3"]).toBe("[P4]");
    expect(logObj?.["4"]).toBe("msg");
  });

  test("settings override at arbitrary depth", () => {
    const root = new Logger({ type: "hidden", minLevel: 0 });
    const child = root.getSubLogger({ minLevel: 4 });
    const grandchild = child.getSubLogger({});

    expect(root.info("ok")).toBeDefined();
    expect(child.info("skipped")).toBeUndefined();
    expect(child.warn("ok")).toBeDefined();
    expect(grandchild.info("also skipped")).toBeUndefined();
    expect(grandchild.warn("ok")).toBeDefined();
  });

  test("transport on parent is inherited by child sub-logger", () => {
    const captured: unknown[] = [];
    const root = new Logger({ type: "hidden" });
    root.attachTransport((logObj) => captured.push(logObj));

    const child = root.getSubLogger({ name: "child" });
    root.info("root msg");
    child.info("child msg");

    // child inherits parent's attachedTransports via getSubLogger settings spread
    expect(captured.length).toBe(2);
    expect((captured[0] as Record<string, unknown>)["0"]).toBe("root msg");
    expect((captured[1] as Record<string, unknown>)["0"]).toBe("child msg");
  });

  test("sub-logger with independent logObj at each level", () => {
    const rootObj = { level: "root", shared: true };
    const root = new Logger({ type: "hidden" }, rootObj);

    const childObj = { level: "child", shared: false };
    const child = root.getSubLogger({}, childObj);

    const rootLog = root.info("r");
    expect(rootLog?.level).toBe("root");
    expect(rootLog?.shared).toBe(true);

    const childLog = child.info("c");
    expect(childLog?.level).toBe("child");
    expect(childLog?.shared).toBe(false);
  });

  test("sub-logger inherits type from parent", () => {
    const root = new Logger({ type: "hidden" });
    const child = root.getSubLogger({});

    expect(child.settings.type).toBe("hidden");
  });

  test("sub-logger with attachedTransports in settings", () => {
    const captured: unknown[] = [];
    const root = new Logger({ type: "hidden" });
    const child = root.getSubLogger({
      attachedTransports: [(logObj) => captured.push(logObj)],
    });

    child.info("from child");

    expect(captured.length).toBe(1);
    expect((captured[0] as Record<string, unknown>)["0"]).toBe("from child");
  });
});
