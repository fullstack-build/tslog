import { relative } from "path";
import { Logger } from "../src/index.js";
import { getConsoleLog, mockConsoleLog } from "./helper.js";

// v5/M3a: with type "json" the env-aware default resolves stack.capture to "off",
// so _logMeta.path is no longer populated by default. The "silly" test asserts the
// captured file path/line, so opt into stack capture explicitly to preserve that intent.
const logger = new Logger({ type: "json", stack: { capture: "full" } });

describe("JSON: Log level", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("log object", (): void => {
    const logObj: any = logger.log(123, "test", "Test");
    expect(logObj?.["0"]).toContain("Test");
    expect(logObj?._logMeta?.logLevelId === 123).toBeTruthy();
    expect(logObj?._logMeta?.logLevelName).toContain("test");
  });

  test("silly (console)", (): void => {
    const result = logger.silly("Test");
    // v5 flat shape: a bare string lands under the top-level "message" key (M2.1/M2.2).
    expect(getConsoleLog()).toContain('"message":"Test"');
    // level NAME and numeric levelId are now promoted to the top level.
    expect(getConsoleLog()).toContain('"level":"SILLY"');
    expect(getConsoleLog()).toContain('"levelId":0');
    // ISO timestamp is now a top-level "time" field.
    expect(getConsoleLog()).toContain(`"time":"${new Date().toISOString().split("T")[0]}`); // ignore time
    // runtime meta still nested under _logMeta, which now also carries the schema version v: 5.
    expect(getConsoleLog()).toContain('"_logMeta":{');
    expect(getConsoleLog()).toContain('"v":5');
    expect(getConsoleLog()).toContain('"runtime":"');
    expect(getConsoleLog()).toContain('"hostname":"');
    expect(getConsoleLog()).toContain('"logLevelId":0');
    expect(getConsoleLog()).toContain('"logLevelName":"SILLY"');
    const relativePath = relative(process.cwd(), import.meta.filename).replace(/\\/g, "/");
    const filePathWithLine = result?._logMeta?.path?.filePathWithLine?.replace(/^[\\/]+/, "");
    expect(filePathWithLine?.startsWith(relativePath)).toBe(true);
    const line = Number(filePathWithLine?.split(":").pop());
    expect(Number.isNaN(line)).toBe(false);
  });

  test("trace (console)", (): void => {
    logger.trace("Test");
    expect(getConsoleLog()).toContain('"message":"Test"');
    expect(getConsoleLog()).toContain('"level":"TRACE"');
    expect(getConsoleLog()).toContain('"_logMeta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"TRACE"');
  });

  test("debug (console)", (): void => {
    logger.debug("Test");
    expect(getConsoleLog()).toContain('"message":"Test"');
    expect(getConsoleLog()).toContain('"level":"DEBUG"');
    expect(getConsoleLog()).toContain('"_logMeta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"DEBUG"');
  });

  test("info (console)", (): void => {
    logger.info("Test");
    expect(getConsoleLog()).toContain('"message":"Test"');
    expect(getConsoleLog()).toContain('"level":"INFO"');
    expect(getConsoleLog()).toContain('"_logMeta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"INFO"');
  });

  test("warn (console)", (): void => {
    logger.warn("Test");
    expect(getConsoleLog()).toContain('"message":"Test"');
    expect(getConsoleLog()).toContain('"level":"WARN"');
    expect(getConsoleLog()).toContain('"_logMeta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"WARN"');
  });

  test("error (console)", (): void => {
    logger.error("Test");
    expect(getConsoleLog()).toContain('"message":"Test"');
    expect(getConsoleLog()).toContain('"level":"ERROR"');
    expect(getConsoleLog()).toContain('"_logMeta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"ERROR"');
  });

  test("fatal (console)", (): void => {
    logger.fatal("Test");
    expect(getConsoleLog()).toContain('"message":"Test"');
    expect(getConsoleLog()).toContain('"level":"FATAL"');
    expect(getConsoleLog()).toContain('"_logMeta":{');
    expect(getConsoleLog()).toContain('"logLevelName":"FATAL"');
  });
});
