import "ts-jest";
import { Logger } from "../src/index.js";
import { getConsoleLogStripped, mockConsoleLog } from "./helper.js";
import { relative } from "path";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("Pretty: Settings", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("plain string", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain("testLevel");
    expect(getConsoleLogStripped()).toContain("Test");
  });

  test("two strings", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLogStripped()).toContain("Test1 Test2");
  });

  test("name", (): void => {
    const logger = new Logger({ type: "pretty", name: "logger" });
    const log = logger.log(1, "testLevel", "foo bar");
    expect(log).toBeDefined();
    expect(log?._meta?.name).toBe("logger");
    expect(getConsoleLogStripped()).toContain(`logger`);
  });

  test("name with sub-logger inheritance", (): void => {
    const logger1 = new Logger({ type: "pretty", name: "logger1" });
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

    expect(getConsoleLogStripped()).toContain(`logger1`);
    expect(getConsoleLogStripped()).toContain(`logger1:logger2`);
    expect(getConsoleLogStripped()).toContain(`logger1:logger2:logger3`);
  });

  test("argumentsArray", (): void => {
    const logger = new Logger({
      type: "pretty",
      argumentsArrayName: "argumentsArray",
    });
    logger.log(1234, "testLevel", "Test1", "Test2");
    expect(getConsoleLogStripped()).toContain("Test1 Test2");
  });

  test("hideLogPositionForProduction", (): void => {
    const loggerNormal = new Logger({
      type: "pretty",
      hideLogPositionForProduction: false,
      stylePrettyLogs: false,
    });
    const loggerProduction = new Logger({
      type: "pretty",
      hideLogPositionForProduction: true,
      stylePrettyLogs: false,
    });

    loggerNormal.log(1234, "testLevel", "Normal log");
    loggerProduction.log(1234, "testLevel", "Production log");
    const output = getConsoleLogStripped();
    const entries = output.split(/(?=\d{4}-\d{2}-\d{2} )/).filter(Boolean);
    expect(entries.length).toBe(2);

    const [normalEntry, productionEntry] = entries;
    const relativePath = relative(process.cwd(), __filename).replace(/\\/g, "/");

    const pathMatch = normalEntry.match(new RegExp(`${escapeRegExp(relativePath)}:(\\d+)`));
    expect(pathMatch).not.toBeNull();
    expect(normalEntry).toContain("Normal log");
    expect(productionEntry).not.toContain(relativePath);
    expect(productionEntry).toContain("Production log");
  });

  test("metaProperty", (): void => {
    const logger = new Logger({ type: "pretty", metaProperty: "_test" });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain("Test");
  });

  test("Don't mask", (): void => {
    const logger = new Logger({
      type: "pretty",
      maskValuesOfKeys: [],
    });
    logger.log(1234, "testLevel", {
      password: "pass123",
      otherKey: "otherKey456",
      nested: {
        moviePassword: "swordfish",
      },
    });

    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).toContain("pass123");
    expect(getConsoleLogStripped()).toContain("otherKey:");
    expect(getConsoleLogStripped()).toContain("otherKey456");
    expect(getConsoleLogStripped()).toContain("moviePassword:");
    expect(getConsoleLogStripped()).toContain("swordfish");
  });

  test("maskValuesOfKeys not set", (): void => {
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", {
      password: "pass123",
    });
    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).toContain("'[***]'");
    expect(getConsoleLogStripped()).not.toContain("pass123");
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

    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).toContain("pass123");
    expect(getConsoleLogStripped()).toContain("otherKey:");
    expect(getConsoleLogStripped()).not.toContain("otherKey456");
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
    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).toContain("[###]");
    expect(getConsoleLogStripped()).not.toContain("pass123");
    expect(getConsoleLogStripped()).toContain("otherKey:");
    expect(getConsoleLogStripped()).not.toContain("otherKey456");
    expect(getConsoleLogStripped()).toContain("yetAnotherKey:");
    expect(getConsoleLogStripped()).toContain("otherKey789");
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

    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).toContain("[###]");
    expect(getConsoleLogStripped()).toContain("pass123");
    expect(getConsoleLogStripped()).toContain("otherKey:");
    expect(getConsoleLogStripped()).not.toContain("otherKey456");
    expect(getConsoleLogStripped()).toContain("moviePassword:");
    expect(getConsoleLogStripped()).not.toContain("swordfish");
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
    logger.log(1234, "testLevel", {
      password: "pass789",
      otherKey: "otherKey987",
    });
    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).toContain("[***]");
    expect(getConsoleLogStripped()).not.toContain("pass123");
    expect(getConsoleLogStripped()).toContain("otherKey:");
    expect(getConsoleLogStripped()).not.toContain("otherKey456");
  });

  test("maskValuesOfKeys and don't manipulate original", (): void => {
    const logger = new Logger({
      type: "pretty",
      maskValuesOfKeys: ["password", "otherkey"],
      maskValuesOfKeysCaseInsensitive: true,
    });
    const obj = {
      password: "pass123",
      otherKey: "otherKey456",
    };
    logger.log(1234, "testLevel", obj);
    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).toContain("[***]");
    expect(getConsoleLogStripped()).not.toContain("pass123");
    expect(getConsoleLogStripped()).toContain("otherKey:");
    expect(getConsoleLogStripped()).not.toContain("otherKey456");
    expect(obj.password).toBe("pass123");
    expect(obj.otherKey).toBe("otherKey456");
  });

  test("maskValuesRegEx with different types and without manipulating the original object", (): void => {
    const logger = new Logger({
      type: "pretty",
      stylePrettyLogs: false,
      maskValuesRegEx: [new RegExp("otherKey", "g")],
    });

    const logObj = {
      password: "pass123",
      otherKey: "otherKey456",
    };

    logger.log(1234, "testLevel", logObj);

    const logOutput = getConsoleLogStripped();

    expect(logOutput).toContain("password: '[***]'");
    expect(logOutput).not.toContain("pass123");
    expect(logOutput).toContain("otherKey: '[***]456'");
    expect(logOutput).not.toContain("otherKey456");

    logger.log(4567, "testLevel", undefined);
    expect(getConsoleLogStripped()).toContain("undefined");
    logger.log(4567, "testLevel", "string");
    expect(getConsoleLogStripped()).toContain("string");
    logger.log(4567, "testLevel", 0);
    expect(getConsoleLogStripped()).toContain("0");
    logger.log(4567, "testLevel", NaN);
    expect(getConsoleLogStripped()).toContain("NaN");
    logger.log(4567, "testLevel", { object: true });
    expect(getConsoleLogStripped()).toMatch(/object:\s*true/);
    logger.log(4567, "testLevel", new Date());
    expect(getConsoleLogStripped()).toContain("T");
    expect(getConsoleLogStripped()).toContain("Z");
    logger.log(4567, "testLevel", Buffer.from("foo"));
    expect(getConsoleLogStripped()).toMatch(/'0':\s*102/);
    expect(getConsoleLogStripped()).toMatch(/'1':\s*111/);
    expect(getConsoleLogStripped()).toMatch(/'2':\s*111/);
    logger.log(4567, "testLevel", new Error("test"));
    expect(getConsoleLogStripped()).toContain("error stack");

    // don't manipulate original object
    expect(logObj.password).toBe("pass123");
    expect(logObj.otherKey).toBe("otherKey456");
  });

  /* Additional pretty formatting tests */

  test("stylePrettyLogs: false / prettyLogTemplate - shortcut: {{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}", (): void => {
    const logger = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}** ",
      stylePrettyLogs: false,
    });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().replace("T", " ").split(".")[0]}`);
    expect(getConsoleLogStripped()).toContain("** Test");
  });

  test("stylePrettyLogs: false / prettyLogTemplate - no shortcut: {{dd}}.{{mm}}.{{yyyy}} {{hh}}:{{MM}}", (): void => {
    const logger = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{dd}}.{{mm}}.{{yyyy}} {{hh}}:{{MM}}** ",
      stylePrettyLogs: false,
    });
    logger.log(1234, "testLevel", "Test");
    const yyyy = new Date().getUTCFullYear();
    const dateMonth = new Date().getUTCMonth();
    const mm = dateMonth == null ? "--" : dateMonth < 9 ? "0" + (dateMonth + 1) : dateMonth + 1;
    const dateDay = new Date().getUTCDate();
    const dd = dateDay == null ? "--" : dateDay < 10 ? "0" + dateDay : dateDay;
    const dateHours = new Date().getUTCHours();
    const hh = dateHours == null ? "--" : dateHours < 10 ? "0" + dateHours : dateHours;
    const dateMinutes = new Date().getUTCMinutes();
    const MM = dateMinutes == null ? "--" : dateMinutes < 10 ? "0" + dateMinutes : dateMinutes;
    expect(getConsoleLogStripped()).toContain(`**${dd}.${mm}.${yyyy} ${hh}:${MM}** Test`);
  });

  test("stylePrettyLogs: false / prettyLogTemplate - shortcut: {{dateIsoStr}}", (): void => {
    const logger = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{dateIsoStr}}** ",
      stylePrettyLogs: false,
    });
    logger.log(1234, "testLevel", "Test");
    const output = getConsoleLogStripped();
    expect(output).toMatch(/\*\*\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?\*\*/);
    expect(output).toContain("** Test");
  });

  test("prettyLogTemplate - rawIsoStr", (): void => {
    const logger = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{rawIsoStr}}** ",
      stylePrettyLogs: false,
    });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
    expect(getConsoleLogStripped()).toContain("** Test");
  });

  test("prettyLogTimeZone - rawIsoStr - UTC (default)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{rawIsoStr}}** ",
      stylePrettyLogs: false,
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - rawIsoStr - UTC (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      prettyLogTimeZone: "UTC",
      prettyLogTemplate: "**{{rawIsoStr}}** ",
      stylePrettyLogs: false,
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - rawIsoStr - local (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      prettyLogTimeZone: "local",
      prettyLogTemplate: "**{{rawIsoStr}}** ",
      stylePrettyLogs: false,
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - {{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}} - UTC (default)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      prettyLogTemplate: "**{{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}}** ",
      stylePrettyLogs: false,
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - {{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}} - UTC (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      prettyLogTimeZone: "UTC",
      prettyLogTemplate: "**{{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}}** ",
      stylePrettyLogs: false,
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - {{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}} - local (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      prettyLogTimeZone: "local",
      prettyLogTemplate: "**{{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}}** ",
      stylePrettyLogs: false,
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split(".")[0]}`);
  });

  test("Change settings: minLevel", (): void => {
    const logger = new Logger({
      type: "pretty",
      minLevel: 1,
    });
    logger.log(1, "custom_level_one", "LOG1");
    logger.log(2, "custom_level_two", "LOG2");

    // change minLevel to 2
    logger.settings.minLevel = 2;
    logger.log(1, "custom_level_one", "LOG3");
    logger.log(2, "custom_level_two", "LOG4");

    expect(getConsoleLogStripped()).toContain(`LOG1`);
    expect(getConsoleLogStripped()).toContain(`LOG2`);
    expect(getConsoleLogStripped()).not.toContain(`LOG3`);
    expect(getConsoleLogStripped()).toContain(`LOG4`);
  });
});
