import "ts-jest";
import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("JSON: Settings", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain('"0":"Test"');
    expect(getConsoleLog()).toContain('"_meta":{');
    expect(getConsoleLog()).toContain('"logLevelId":1234');
    expect(getConsoleLog()).toContain('"logLevelName":"testLevel"');
  });

  test("two strings", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain('"0":"Test1"');
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

  test("hideLogPositionForProduction", (): void => {
    const loggerNormal = new Logger({
      type: "json",
      hideLogPositionForProduction: false,
      stylePrettyLogs: false,
    });
    const loggerProduction = new Logger({
      type: "json",
      hideLogPositionForProduction: true,
      stylePrettyLogs: false,
    });

    loggerProduction.log(1234, "testLevel", "Production log");
    expect(getConsoleLog()).not.toContain('"fileName":"6_json_Settings.test.ts"');
    loggerNormal.log(1234, "testLevel", "Normal log");
    expect(getConsoleLog()).toContain('"fileName":"6_json_Settings.test.ts"');
  });

  test("metaProperty", (): void => {
    const logger = new Logger({ type: "json", metaProperty: "_test" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain('"_test":{');
  });

  test("maskValuesOfKeys and maskValuesRegEx empty", (): void => {
    const logger = new Logger({ type: "pretty", maskValuesOfKeys: [], maskValuesRegEx: undefined });
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

  test("maskValuesOfKeys not set", (): void => {
    const logger = new Logger({ type: "json" });
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
      maskValuesOfKeys: ["otherKey"],
      maskPlaceholder: "[###]",
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
      maskValuesOfKeys: ["otherKey", "moviePassword"],
      maskPlaceholder: "[###]",
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
      maskValuesOfKeys: ["password", "otherKey", "yetanotherKey"],
      maskPlaceholder: "[###]",
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
      maskValuesOfKeys: ["password", "otherkey"],
      maskValuesOfKeysCaseInsensitive: true,
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
      maskValuesRegEx: [new RegExp("otherKey", "g")],
    });

    const logObj = {
      password: "pass123",
      otherKey: "otherKey456",
    };

    logger.log(1234, "testLevel", logObj);
    expect(getConsoleLog()).toContain('"password":"[***]"');
    expect(getConsoleLog()).not.toContain("pass123");
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
    expect(getConsoleLog()).toContain('"0":1');
    expect(getConsoleLog()).toContain('"1":2');
    expect(getConsoleLog()).toContain('"2":"test"');
    expect(getConsoleLog()).toContain('"3":{');
  });

  test("lazy arguments run only when emitted", (): void => {
    const eagerLogger = new Logger({ type: "json" });
    const executed = jest.fn(() => "value");
    eagerLogger.info(() => [executed()]);
    expect(executed).toHaveBeenCalledTimes(1);

    const quietLogger = new Logger({ type: "json", minLevel: 5 });
    const skipped = jest.fn(() => "skip");
    quietLogger.debug(() => [skipped()]);
    expect(skipped).not.toHaveBeenCalled();
  });
});
