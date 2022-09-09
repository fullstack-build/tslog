import "ts-jest";
import { Logger } from "../../src";
import { mockConsoleLog, getConsoleLog } from "./helper";

describe("Pretty: Settings", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain("testLevel");
    expect(getConsoleLog()).toContain("]\nTest");
  });

  test("two strings", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain("Test1 Test2");
  });

  test("argumentsArray", (): void => {
    const logger = new Logger({
      type: "pretty",
      argumentsArrayName: "argumentsArray",
    });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLog()).toContain("Test1 Test2");
  });

  test("metaProperty", (): void => {
    const logger = new Logger({ type: "pretty", metaProperty: "_test" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain("Test");
  });

  test("maskValuesOfKeys not set", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", {
      password: "pass123",
    });
    expect(getConsoleLog()).toContain("password:");
    expect(getConsoleLog()).toContain("'[***]'");
    expect(getConsoleLog()).not.toContain("pass123");
  });

  test("maskValuesOfKeys set and maskPlaceholder", (): void => {
    const logger = new Logger({
      type: "pretty",
      maskValuesOfKeys: ["otherKey"],
      maskPlaceholder: "[###]",
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
    });

    expect(getConsoleLog()).toContain("password:");
    expect(getConsoleLog()).toContain("pass123");
    expect(getConsoleLog()).toContain("otherKey:");
    expect(getConsoleLog()).not.toContain("otherKey456");
  });

  test("maskValuesOfKeys set two keys and maskPlaceholder", (): void => {
    const logger = new Logger({
      type: "pretty",
      maskValuesOfKeys: ["password", "otherKey", "yetanotherKey"],
      maskPlaceholder: "[###]",
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
      yetAnotherKey: "otherKey789",
    });
    expect(getConsoleLog()).toContain("password:");
    expect(getConsoleLog()).toContain("[###]");
    expect(getConsoleLog()).not.toContain("pass123");
    expect(getConsoleLog()).toContain("otherKey:");
    expect(getConsoleLog()).not.toContain("otherKey456");
    expect(getConsoleLog()).toContain("yetAnotherKey:");
    expect(getConsoleLog()).toContain("otherKey789");
  });

  test("maskValuesOfKeys set and maskPlaceholder nested object", (): void => {
    const logger = new Logger({
      type: "pretty",
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

    expect(getConsoleLog()).toContain("password:");
    expect(getConsoleLog()).toContain("[###]");
    expect(getConsoleLog()).toContain("pass123");
    expect(getConsoleLog()).toContain("otherKey:");
    expect(getConsoleLog()).not.toContain("otherKey456");
    expect(getConsoleLog()).toContain("moviePassword:");
    expect(getConsoleLog()).not.toContain("swordfish");
  });

  test("maskValuesOfKeys and maskValuesOfKeysCaseInsensitive", (): void => {
    const logger = new Logger({
      type: "pretty",
      maskValuesOfKeys: ["password", "otherkey"],
      maskValuesOfKeysCaseInsensitive: true,
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
    });
    expect(getConsoleLog()).toContain("password:");
    expect(getConsoleLog()).toContain("[***]");
    expect(getConsoleLog()).not.toContain("pass123");
    expect(getConsoleLog()).toContain("otherKey:");
    expect(getConsoleLog()).not.toContain("otherKey456");
  });

  /* Additional pretty formatting tests */

  test("stylePrettyLogs: false / prettyLogTemplate - shortcut: {{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", (): void => {
    const logger = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}**",
      stylePrettyLogs: false,
    });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLog()).toContain(`**${new Date().toISOString().replace("T", " ").split(".")[0]}`);
    expect(getConsoleLog()).toContain("**Test");
  });

  test("stylePrettyLogs: false / prettyLogTemplate - no shortcut: {{dd}}.{{mm}}.{{yyyy}} {{hh}}:{{MM}}", (): void => {
    const logger = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{dd}}.{{mm}}.{{yyyy}} {{hh}}:{{MM}}**",
      stylePrettyLogs: false,
    });
    logger.log(1234, "testLevel", "Test");
    const yyyy = new Date().getFullYear();
    const dateMonth = new Date().getMonth();
    const mm = dateMonth == null ? "--" : dateMonth < 9 ? "0" + (dateMonth + 1) : dateMonth + 1;
    const dateDay = new Date().getDate();
    const dd = dateDay == null ? "--" : dateDay < 9 ? "0" + (dateDay + 1) : dateDay + 1;
    const dateHours = new Date().getHours();
    const hh = dateHours == null ? "--" : dateHours < 9 ? "0" + dateHours : dateHours;
    const dateMinutes = new Date().getMinutes();
    const MM = dateMinutes == null ? "--" : dateMinutes < 9 ? "0" + dateMinutes : dateMinutes;
    expect(getConsoleLog()).toContain(`**${dd}.${mm}.${yyyy} ${hh}:${MM}**Test`);
  });
});
