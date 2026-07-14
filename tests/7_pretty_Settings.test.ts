import { relative } from "path";
import { Logger } from "../src/index.js";
import { getConsoleLogStripped, mockConsoleLog } from "./helper.js";

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
    expect(log?._logMeta?.name).toBe("logger");
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

    expect(log1?._logMeta?.name).toBe("logger1");
    expect(log2?._logMeta?.name).toBe("logger2");
    expect(log3?._logMeta?.name).toBe("logger3");

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

  // M3a: `hideLogPositionForProduction` was removed. Its production behavior (no code position in
  // pretty output) is now expressed via `stack.capture: "off"`; `"auto"` keeps the normal position.
  test("stack.capture off hides log position", (): void => {
    const loggerNormal = new Logger({
      type: "pretty",
      stack: { capture: "auto" },
      pretty: { style: false },
    });
    const loggerProduction = new Logger({
      type: "pretty",
      stack: { capture: "off" },
      pretty: { style: false },
    });

    loggerNormal.log(1234, "testLevel", "Normal log");
    loggerProduction.log(1234, "testLevel", "Production log");
    const output = getConsoleLogStripped();
    const entries = output.split(/(?=\d{4}-\d{2}-\d{2} )/).filter(Boolean);
    expect(entries.length).toBe(2);

    const [normalEntry, productionEntry] = entries;
    const relativePath = relative(process.cwd(), import.meta.filename).replace(/\\/g, "/");

    const pathMatch = normalEntry.match(new RegExp(`${escapeRegExp(relativePath)}:(\\d+)`));
    expect(pathMatch).not.toBeNull();
    expect(normalEntry).toContain("Normal log");
    expect(productionEntry).not.toContain(relativePath);
    expect(productionEntry).toContain("Production log");
  });

  test("metaProperty", (): void => {
    const logger = new Logger({ type: "pretty", meta: { property: "_test" } });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain("Test");
  });

  test("Don't mask", (): void => {
    const logger = new Logger({
      type: "pretty",
      mask: { keys: [] },
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

  test("maskValuesOfKeys not set (default is now [], nothing masked)", (): void => {
    // BC5 (v5): default maskValuesOfKeys is [] — without opting in, nothing is masked.
    const logger = new Logger({ type: "pretty" });
    logger.log(1234, "testLevel", {
      password: "pass123",
    });
    expect(getConsoleLogStripped()).toContain("password:");
    expect(getConsoleLogStripped()).not.toContain("'[***]'");
    expect(getConsoleLogStripped()).toContain("pass123");
  });

  test("maskValuesOfKeys set and maskPlaceholder", (): void => {
    const logger = new Logger({
      type: "pretty",
      mask: { keys: ["otherKey"], placeholder: "[###]" },
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
      mask: { keys: ["password", "otherKey", "yetanotherKey"], placeholder: "[###]" },
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
      mask: { keys: ["otherKey", "moviePassword"], placeholder: "[###]" },
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
      mask: { keys: ["password", "otherkey"], caseInsensitive: true },
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
      mask: { keys: ["password", "otherkey"], caseInsensitive: true },
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
      pretty: { style: false },
      mask: { regex: [new RegExp("otherKey", "g")] },
    });

    const logObj = {
      password: "pass123",
      otherKey: "otherKey456",
    };

    logger.log(1234, "testLevel", logObj);

    const logOutput = getConsoleLogStripped();

    // BC5 (v5): default maskValuesOfKeys is [] — password is not key-masked here.
    // Only maskValuesRegEx applies, and it matches "otherKey" inside string values.
    expect(logOutput).toContain("password: 'pass123'");
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
    // Native node:util inspect renders Buffers in their canonical hex form.
    expect(getConsoleLogStripped()).toContain("<Buffer 66 6f 6f>");
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
      pretty: { template: "**{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}** ", style: false },
    });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().replace("T", " ").split(".")[0]}`);
    expect(getConsoleLogStripped()).toContain("** Test");
  });

  test("stylePrettyLogs: false / prettyLogTemplate - no shortcut: {{dd}}.{{mm}}.{{yyyy}} {{hh}}:{{MM}}", (): void => {
    const logger = new Logger({
      type: "pretty",
      pretty: { template: "**{{dd}}.{{mm}}.{{yyyy}} {{hh}}:{{MM}}** ", style: false },
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
      pretty: { template: "**{{dateIsoStr}}** ", style: false },
    });
    logger.log(1234, "testLevel", "Test");
    const output = getConsoleLogStripped();
    expect(output).toMatch(/\*\*\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?\*\*/);
    expect(output).toContain("** Test");
  });

  test("prettyLogTemplate - rawIsoStr", (): void => {
    const logger = new Logger({
      type: "pretty",
      pretty: { template: "**{{rawIsoStr}}** ", style: false },
    });
    logger.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
    expect(getConsoleLogStripped()).toContain("** Test");
  });

  test("prettyLogTimeZone - rawIsoStr - UTC (default)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      pretty: { template: "**{{rawIsoStr}}** ", style: false },
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - rawIsoStr - UTC (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      pretty: { timeZone: "UTC", template: "**{{rawIsoStr}}** ", style: false },
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - rawIsoStr - local (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      pretty: { timeZone: "local", template: "**{{rawIsoStr}}** ", style: false },
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - {{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}} - UTC (default)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      pretty: { template: "**{{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}}** ", style: false },
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - {{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}} - UTC (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      pretty: { timeZone: "UTC", template: "**{{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}}** ", style: false },
    });

    loggerShortcut.log(1234, "testLevel", "Test");
    expect(getConsoleLogStripped()).toContain(`**${new Date().toISOString().split(".")[0]}`);
  });

  test("prettyLogTimeZone - {{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}} - local (configured)", (): void => {
    const loggerShortcut = new Logger({
      type: "pretty",
      pretty: { timeZone: "local", template: "**{{yyyy}}-{{mm}}-{{dd}}T{{hh}}:{{MM}}:{{ss}}** ", style: false },
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

test("prettyLogLevelMethod: dispatches to correct console method per level", (): void => {
  const traceSpy = vi.fn();
  const debugSpy = vi.fn();
  const infoSpy = vi.fn();
  const warnSpy = vi.fn();
  const errorSpy = vi.fn();
  const fallbackSpy = vi.fn();

  const logger = new Logger({
    type: "pretty",
    pretty: {
      levelMethod: {
        TRACE: traceSpy,
        DEBUG: debugSpy,
        INFO: infoSpy,
        WARN: warnSpy,
        ERROR: errorSpy,
        FATAL: errorSpy,
        "*": fallbackSpy,
      },
    },
  });

  logger.trace("trace message");
  expect(traceSpy).toHaveBeenCalledWith(expect.stringContaining("trace message"));
  expect(traceSpy).toHaveBeenCalledTimes(1);

  logger.debug("debug message");
  expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("debug message"));
  expect(debugSpy).toHaveBeenCalledTimes(1);

  logger.info("info message");
  expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("info message"));
  expect(infoSpy).toHaveBeenCalledTimes(1);

  logger.warn("warn message");
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("warn message"));
  expect(warnSpy).toHaveBeenCalledTimes(1);

  logger.error("error message");
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("error message"));
  logger.fatal("fatal message");
  expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("fatal message"));
  expect(errorSpy).toHaveBeenCalledTimes(2);

  logger.silly("silly message");
  expect(fallbackSpy).toHaveBeenCalledWith(expect.stringContaining("silly message"));
  expect(fallbackSpy).toHaveBeenCalledTimes(1);
});
