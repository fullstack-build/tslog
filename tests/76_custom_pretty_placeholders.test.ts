import { normalizeSettings } from "../src/core/settings.js";
import { Logger, TslogConfigError } from "../src/index.js";
import { buildPrettyMeta } from "../src/internal/metaFormatting.js";

describe("custom pretty placeholders", () => {
  const clock = () => new Date("2026-10-17T01:02:03.004Z");

  test("renders one styled short-time token anywhere in the template", () => {
    const write = vi.fn();
    const unused = vi.fn(() => "unused");
    const shortTime = vi.fn((meta, pretty) => {
      expect(pretty.timeZone).toBe("UTC");
      return meta.date.toISOString().slice(11, 23);
    });
    const logger = new Logger({
      strictConfig: true,
      clock,
      pretty: {
        timeZone: "UTC",
        style: true,
        template: "[{{logLevelName}}] {{shortTime}} {{shortTime}} ",
        placeholders: { shortTime, unused },
        styles: { shortTime: "blackBright" },
        levelMethod: { "*": write },
      },
    });
    logger.info("hello");
    expect(write.mock.calls[0][0]).toContain("\x1b[90m01:02:03.004\x1b[39m");
    expect(write.mock.calls[0][0].replace(/\x1b\[[0-9;]*m/g, "")).toContain("[INFO]");
    expect(shortTime).toHaveBeenCalledTimes(1);
    expect(unused).not.toHaveBeenCalled();
    logger.settings.pretty.style = false;
    logger.info("plain");
    expect(write.mock.calls[1][0]).toBe("[INFO] 01:02:03.004 01:02:03.004 plain");
  });

  test("inherits and merges custom callbacks without changing parent values", () => {
    const write = vi.fn();
    const parent = new Logger({
      strictConfig: true,
      pretty: {
        style: false,
        template: "{{one}}/{{two}} ",
        levelMethod: { "*": write },
        placeholders: { one: () => "parent", two: () => "shared" },
      },
    });
    const child = parent.child({ pretty: { placeholders: { one: () => "child" } } });
    child.info("hello");
    parent.info("hello");
    expect(write.mock.calls.map((call) => call[0])).toEqual(["child/shared hello", "parent/shared hello"]);
  });

  test.each([
    [{ logLevelName: () => "override" }, "pretty.placeholders.logLevelName shadows a built-in placeholder."],
    [{ shortTime: "not a callback" }, "pretty.placeholders.shortTime needs a name without whitespace/braces and a callback."],
    [{ "bad name": () => "invalid" }, "pretty.placeholders.bad name needs a name without whitespace/braces and a callback."],
    [[], "pretty.placeholders must be an object of callbacks."],
    ["bad", "pretty.placeholders must be an object of callbacks."],
  ])("rejects invalid maps or reserved names in strict config: %j", (placeholders, message) => {
    expect(() => new Logger({ strictConfig: true, pretty: { placeholders: placeholders as never } })).toThrow(
      expect.objectContaining({ code: "INVALID_PRETTY_PLACEHOLDER", message: expect.stringContaining(message) }),
    );
  });

  test("unknown tokens are still rejected and inherited function properties are not tokens", () => {
    expect(() => new Logger({ strictConfig: true, pretty: { template: "{{missing}}", placeholders: {} } })).toThrow(TslogConfigError);
    expect(() => new Logger({ strictConfig: true, pretty: { template: "{{constructor}}", placeholders: {} } })).toThrow(TslogConfigError);
  });

  test("renders numbers, and isolates throws and other return types without dropping the log", () => {
    const write = vi.fn();
    const logger = new Logger({
      pretty: {
        style: false,
        template: "{{broken}}/{{count}}/{{wrong}}/{{nothing}} ",
        levelMethod: { "*": write },
        placeholders: {
          broken: () => {
            throw new Error("broken");
          },
          count: () => 42,
          wrong: (() => ({ not: "a string" })) as never,
          nothing: (() => undefined) as never,
        },
      },
    });
    expect(() => logger.info("still logged")).not.toThrow();
    expect(write.mock.calls[0][0]).toBe("/42// still logged");
  });

  test("strict config rejects unknown pretty.styles keys with a did-you-mean, but accepts custom and error tokens", () => {
    expect(() => new Logger({ strictConfig: true, pretty: { styles: { logLevelNmae: "red" } } })).toThrow(
      expect.objectContaining({
        code: "UNKNOWN_PRETTY_STYLE",
        setting: "pretty.styles.logLevelNmae",
        message: expect.stringContaining('did you mean "logLevelName"'),
      }),
    );
    expect(() => new Logger({ strictConfig: true, pretty: { styles: { nonsense: "red" } } })).toThrow(
      expect.objectContaining({ code: "UNKNOWN_PRETTY_STYLE", suggestion: 'Remove "pretty.styles.nonsense" or register it in pretty.placeholders.' }),
    );
    expect(
      () =>
        new Logger({
          strictConfig: true,
          pretty: { placeholders: { shortTime: () => "" }, styles: { shortTime: "blackBright", errorMessage: "red", method: "cyan", rawIsoStr: "dim" } },
        }),
    ).not.toThrow();
  });

  test("warns about an unknown pretty.styles key outside strict mode", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new Logger({ pretty: { styles: { fileNmae: "yellow" } } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('pretty.styles references unknown placeholder "fileNmae" — did you mean "fileName"?');
    warnSpy.mockRestore();
  });

  test("does not evaluate callbacks or add fields for JSON-only/hidden logging", () => {
    const callback = vi.fn(() => "custom");
    const logger = new Logger({ type: "hidden", pretty: { template: "{{custom}}", placeholders: { custom: callback } } });
    let jsonLine = "";
    logger.attachTransport({
      format: "json",
      write: (_record, line) => {
        jsonLine = line;
      },
    });
    const record = logger.info("hello");
    expect(callback).not.toHaveBeenCalled();
    expect(record).not.toHaveProperty("custom");
    expect(JSON.parse(jsonLine)).not.toHaveProperty("custom");
  });

  test("pretty transports resolve custom tokens even with hidden console output", () => {
    const logger = new Logger({ type: "hidden", clock, pretty: { style: false, template: "{{custom}} ", placeholders: { custom: () => "transport" } } });
    let output = "";
    logger.attachTransport({
      format: "pretty",
      write: (_record, line) => {
        output = line;
      },
    });
    logger.info("hello");
    expect(output).toBe("transport hello");
  });

  test("callbacks see async-context fields attached to the meta", () => {
    const write = vi.fn();
    const logger = new Logger({
      pretty: {
        style: false,
        template: "{{reqId}} ",
        levelMethod: { "*": write },
        placeholders: { reqId: (meta) => String((meta as { requestId?: string }).requestId ?? "-") },
      },
    });
    logger.runInContext({ requestId: "req-1" }, () => logger.info("inside"));
    logger.info("outside");
    expect(write.mock.calls.map((call) => call[0])).toEqual(["req-1 inside", "- outside"]);
  });

  test("no meta means no callback, and builtin overrides are ignored outside strict mode", () => {
    const callback = vi.fn(() => "override");
    const settings = normalizeSettings({ pretty: { template: "{{logLevelName}}", placeholders: { logLevelName: callback } } });
    expect(buildPrettyMeta(settings).text).toBe("");
    const rendered = buildPrettyMeta(settings, { date: clock(), logLevelId: 3, logLevelName: "INFO", runtime: "test" });
    expect(rendered.placeholders.logLevelName).toBe("INFO");
    expect(callback).not.toHaveBeenCalled();
  });
});
