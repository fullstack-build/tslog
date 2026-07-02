import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("JSON: Settings", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test");
    // v5 flat shape: a bare string lands under the configurable messageKey ("message"), the level
    // name/id are promoted to the top level, and runtime meta stays nested under _meta (now with v: 5).
    expect(getConsoleLog()).toContain('"message":"Test"');
    expect(getConsoleLog()).toContain('"level":"testLevel"');
    expect(getConsoleLog()).toContain('"levelId":1234');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelId":1234');
    expect(getConsoleLog()).toContain('"logLevelName":"testLevel"');
  });

  test("two strings", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    // First positional string -> messageKey; the remaining positional arg stays bucketed under "1".
    expect(getConsoleLog()).toContain('"message":"Test1"');
    expect(getConsoleLog()).toContain('"1":"Test2"');
    expect(getConsoleLog()).toContain('"_meta":{');
  });

  test("name", (): void => {
    const logger = new Logger({
      type: "json",
      name: "logger",
    });
    const log = logger.log(1, "testLevel", "foo bar");
    expect(log).toBeDefined();
    expect(log?._meta?.name).toBe("logger");
    expect(getConsoleLog()).toContain(`logger`);
  });

  test("name with sub-logger inheritance", (): void => {
    const logger1 = new Logger({
      type: "pretty",
      name: "logger1",
    });
    const logger2 = logger1.getSubLogger({ name: "logger2" });
    const logger3 = logger2.getSubLogger({ name: "logger3" });

    const log1 = logger1.log(1, "testLevel", "foo bar");
    const log2 = logger2.log(1, "testLevel", "foo bar");
    const log3 = logger3.log(1, "testLevel", "foo bar");
    expect(log1).toBeDefined();
    expect(log2).toBeDefined();
    expect(log3).toBeDefined();

    expect(log1?._meta?.name).toBe("logger1");
    expect(log2?._meta?.name).toBe("logger2");
    expect(log3?._meta?.name).toBe("logger3");

    expect(getConsoleLog()).toContain(`logger1`);
    expect(getConsoleLog()).toContain(`logger2`);
    expect(getConsoleLog()).toContain(`logger3`);

    expect(log2?._meta?.parentNames).toContain("logger1");
    expect(log3?._meta?.parentNames).toContain("logger1");
    expect(log3?._meta?.parentNames).toContain("logger2");
  });

  test("minLevel", (): void => {
    const logger = new Logger({
      type: "json",
      minLevel: 1,
    });
    const hiddenLog = logger.log(0, "testLevel", "hidden");
    const visibleLog = logger.log(1, "testLevel", "visible");
    expect(hiddenLog).toBeUndefined();
    expect(visibleLog).toBeDefined();
    expect(getConsoleLog()).not.toContain(`hidden`);
    expect(getConsoleLog()).toContain(`visible`);
  });

  test("argumentsArray", (): void => {
    const logger = new Logger({
      type: "json",
      argumentsArrayName: "argumentsArray",
    });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain(`"argumentsArray":["Test1","Test2"]`);
    expect(getConsoleLog()).toContain('"_meta":{');
  });

  // Removed in v5 M3a: hideLogPositionForProduction (was the deprecated alias for stackCapture) has no
  // replacement key; use stack.capture: "off"/"auto" where that behavior is still needed.

  test("metaProperty", (): void => {
    const logger = new Logger({ type: "json", meta: { property: "_test" } });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain('"_test":{');
  });

  test("maskValuesOfKeys and maskValuesRegEx empty", (): void => {
    const logger = new Logger({ type: "pretty", mask: { keys: [], regex: undefined } });
    logger.log(1234, "testLevel", {
      password: "pass123",
      null: null,
      obj: {
        foo: "bar",
      },
    });
    expect(getConsoleLog()).not.toContain('"password":"[***]"');
    expect(getConsoleLog()).toContain("pass123");
  });

  test("maskValuesOfKeys set masks the key", (): void => {
    const logger = new Logger({ type: "json", mask: { keys: ["password"] } });
    logger.log(1234, "testLevel", {
      password: "pass123",
      null: null,
      obj: {
        foo: "bar",
      },
    });
    expect(getConsoleLog()).toContain('"password":"[***]"');
    expect(getConsoleLog()).not.toContain("pass123");
  });

  test("maskValuesOfKeys set and maskPlaceholder", (): void => {
    const logger = new Logger({
      type: "json",
      mask: { keys: ["otherKey"], placeholder: "[###]" },
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
    });

    expect(getConsoleLog()).toContain('"otherKey":"[###]"');
    expect(getConsoleLog()).not.toContain("otherKey456");
  });

  test("maskValuesOfKeys set and maskPlaceholder nested object", (): void => {
    const logger = new Logger({
      type: "json",
      mask: { keys: ["otherKey", "moviePassword"], placeholder: "[###]" },
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
      nested: {
        moviePassword: "swordfish",
      },
    });

    expect(getConsoleLog()).toContain('"otherKey":"[###]"');
    expect(getConsoleLog()).not.toContain("otherKey456");
    expect(getConsoleLog()).toContain('"moviePassword":"[###]"');
    expect(getConsoleLog()).not.toContain("swordfish");
  });

  test("maskValuesOfKeys set two keys and maskPlaceholder", (): void => {
    const logger = new Logger({
      type: "json",
      mask: { keys: ["password", "otherKey", "yetanotherKey"], placeholder: "[###]" },
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
      yetAnotherKey: "otherKey789",
    });
    expect(getConsoleLog()).toContain('"password":"[###]"');
    expect(getConsoleLog()).not.toContain("pass123");
    expect(getConsoleLog()).toContain('"otherKey":"[###]"');
    expect(getConsoleLog()).not.toContain("otherKey456");
    expect(getConsoleLog()).toContain('"yetAnotherKey":"otherKey789"');
  });

  test("maskValuesOfKeys and maskValuesOfKeysCaseInsensitive", (): void => {
    const logger = new Logger({
      type: "json",
      mask: { keys: ["password", "otherkey"], caseInsensitive: true },
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
    });
    expect(getConsoleLog()).toContain('"password":"[***]"');
    expect(getConsoleLog()).not.toContain("pass123");
    expect(getConsoleLog()).toContain('"otherKey":"[***]"');
    expect(getConsoleLog()).not.toContain("otherKey456");
  });

  test("maskValuesRegEx with different types and without manipulating the original object", (): void => {
    const logger = new Logger({
      type: "json",
      mask: { regex: [new RegExp("otherKey", "g")] },
    });

    const logObj = {
      password: "pass123",
      otherKey: "otherKey456",
    };

    logger.log(1234, "testLevel", logObj);
    // password is not matched by the regex (and is no longer masked by default in v5)
    expect(getConsoleLog()).toContain('"password":"pass123"');
    expect(getConsoleLog()).toContain('"otherKey":"[***]456"');
    expect(getConsoleLog()).not.toContain("otherKey456");

    logger.log(4567, "testLevel", null);
    logger.log(4567, "testLevel", "string");
    logger.log(4567, "testLevel", 0);
    logger.log(4567, "testLevel", NaN);
    logger.log(4567, "testLevel", { object: true });
    logger.log(4567, "testLevel", new Date());
    logger.log(4567, "testLevel", Buffer.from("foo"));
    logger.log(4567, "testLevel", new Error("test"));

    // don't manipulate original object
    expect(logObj.password).toBe("pass123");
    expect(logObj.otherKey).toBe("otherKey456");
  });

  test("prefix", (): void => {
    const logger = new Logger({
      type: "json",
      prefix: [1, 2, "test"],
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
    });
    // prefix args are prepended to the call args: [1, 2, "test", {obj}]. The first positional value (1)
    // is promoted to messageKey; the rest stay bucketed under their positional index keys.
    expect(getConsoleLog()).toContain('"message":1');
    expect(getConsoleLog()).toContain('"1":2');
    expect(getConsoleLog()).toContain('"2":"test"');
    expect(getConsoleLog()).toContain('"3":{');
  });

  test("lazy arguments run only when emitted", (): void => {
    const eagerLogger = new Logger({ type: "json" });
    const executed = vi.fn(() => "value");
    eagerLogger.info(() => [executed()]);
    expect(executed).toHaveBeenCalledTimes(1);

    const quietLogger = new Logger({ type: "json", minLevel: 5 });
    const skipped = vi.fn(() => "skip");
    quietLogger.debug(() => [skipped()]);
    expect(skipped).not.toHaveBeenCalled();
  });
});
