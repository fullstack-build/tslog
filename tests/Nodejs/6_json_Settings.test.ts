import "ts-jest";
import { Logger } from "../../src";
import { getConsoleLog, mockConsoleLog } from "./helper";

describe("JSON: Settings", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain('"0": "Test"');
    expect(getConsoleLog()).toContain('"_meta": {');
    expect(getConsoleLog()).toContain('"logLevelId": 1234');
    expect(getConsoleLog()).toContain('"logLevelName": "testLevel"');
  });

  test("two strings", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain('"0": "Test1"');
    expect(getConsoleLog()).toContain('"1": "Test2"');
    expect(getConsoleLog()).toContain('"_meta": {');
  });

  test("argumentsArray", (): void => {
    const logger = new Logger({
      type: "json",
      argumentsArrayName: "argumentsArray",
    });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain(`"argumentsArray": [
    "Test1",
    "Test2"
  ]`);
    expect(getConsoleLog()).toContain('"_meta": {');
  });

  test("metaProperty", (): void => {
    const logger = new Logger({ type: "json", metaProperty: "_test" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain('"_test": {');
  });

  test("maskValuesOfKeys not set", (): void => {
    const logger = new Logger({ type: "json" });
    logger.log(1234, "testLevel", {
      password: "pass123",
    });
    expect(getConsoleLog()).toContain('"password": "[***]"');
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

    expect(getConsoleLog()).toContain('"otherKey": "[###]"');
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

    expect(getConsoleLog()).toContain('"otherKey": "[###]"');
    expect(getConsoleLog()).not.toContain("otherKey456");
    expect(getConsoleLog()).toContain('"moviePassword": "[###]"');
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
    expect(getConsoleLog()).toContain('"password": "[###]"');
    expect(getConsoleLog()).not.toContain("pass123");
    expect(getConsoleLog()).toContain('"otherKey": "[###]"');
    expect(getConsoleLog()).not.toContain("otherKey456");
    expect(getConsoleLog()).toContain('"yetAnotherKey": "otherKey789"');
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
    expect(getConsoleLog()).toContain('"password": "[***]"');
    expect(getConsoleLog()).not.toContain("pass123");
    expect(getConsoleLog()).toContain('"otherKey": "[***]"');
    expect(getConsoleLog()).not.toContain("otherKey456");
  });

  test("maskValuesRegEx", (): void => {
    const logger = new Logger({
      type: "json",
      maskValuesRegEx: [new RegExp("otherKey", "g")],
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
    });
    expect(getConsoleLog()).toContain('"password": "[***]"');
    expect(getConsoleLog()).not.toContain("pass123");
    expect(getConsoleLog()).toContain('"otherKey": "[***]456"');
    expect(getConsoleLog()).not.toContain("otherKey456");
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
    expect(getConsoleLog()).toContain('"0": 1');
    expect(getConsoleLog()).toContain('"1": 2');
    expect(getConsoleLog()).toContain('"2": "test"');
    expect(getConsoleLog()).toContain('"3": {');
  });
});
