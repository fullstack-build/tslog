import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

describe("Hidden mode", () => {
  beforeEach(() => mockConsoleLog(true, false));

  test("all 7 log levels return logObj and produce no console output", () => {
    const logger = new Logger({ type: "hidden" });
    const levels = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;

    for (const level of levels) {
      mockConsoleLog(true, false);
      const logObj = logger[level](`${level} message`);
      expect(logObj).toBeDefined();
      expect(logObj?._logMeta?.logLevelName).toBe(level.toUpperCase());
      expect(getConsoleLog()).toBe("");
    }
  });

  test("custom json transport fires in hidden mode", () => {
    // Replaces the removed overwrite.transportJSON hook: a custom transport with format: "json"
    // receives the JSON line (and the structured record) even when console output is suppressed.
    const capturedLines: string[] = [];
    const capturedRecords: unknown[] = [];
    const logger = new Logger({ type: "hidden" });
    logger.attachTransport({
      format: "json",
      write: (record, line) => {
        capturedRecords.push(record);
        capturedLines.push(line);
      },
    });

    logger.info("test");

    expect(capturedRecords.length).toBe(1);
    expect(capturedLines.length).toBe(1);
    const parsed = JSON.parse(capturedLines[0]) as Record<string, unknown>;
    expect(parsed.message).toBe("test");
    expect(parsed.level).toBe("INFO");
    expect(getConsoleLog()).toBe("");
  });

  test("attachedTransport fires in hidden mode, console does not", () => {
    const transported: unknown[] = [];
    const logger = new Logger({
      type: "hidden",
      attachedTransports: [(logObj) => transported.push(logObj)],
    });

    logger.info("test");

    expect(transported.length).toBe(1);
    expect((transported[0] as Record<string, unknown>)["0"]).toBe("test");
    expect(getConsoleLog()).toBe("");
  });

  test("masking still applies in hidden mode", () => {
    const logger = new Logger({
      type: "hidden",
      mask: { keys: ["password"] },
    });

    const logObj = logger.info({ password: "secret", user: "alice" });

    expect(logObj?.password).toBe("[***]");
    expect(logObj?.user).toBe("alice");
  });

  test("prefix still present in hidden mode logObj", () => {
    const logger = new Logger({
      type: "hidden",
      prefix: ["[PREFIX]"],
    });

    const logObj = logger.info("msg");

    expect(logObj?.["0"]).toBe("[PREFIX]");
    expect(logObj?.["1"]).toBe("msg");
  });

  test("sub-logger inherits hidden type", () => {
    const logger = new Logger({ type: "hidden" });
    const sub = logger.getSubLogger({ name: "sub" });

    expect(sub.settings.type).toBe("hidden");

    const logObj = sub.info("sub msg");
    expect(logObj).toBeDefined();
    expect(getConsoleLog()).toBe("");
  });

  test("hidden mode with minLevel filtering", () => {
    const logger = new Logger({ type: "hidden", minLevel: 3 });

    expect(logger.debug("skipped")).toBeUndefined();
    expect(logger.info("included")).toBeDefined();
  });

  test("hidden mode returns correct meta structure", () => {
    const logger = new Logger({ type: "hidden", name: "test-logger" });
    const logObj = logger.info("check meta");
    const meta = logObj?._logMeta;

    expect(meta?.date).toBeInstanceOf(Date);
    expect(meta?.logLevelId).toBe(3);
    expect(meta?.logLevelName).toBe("INFO");
    expect(meta?.name).toBe("test-logger");
    expect(meta?.runtime).toBeDefined();
  });
});
