import "ts-jest";
import { Logger } from "../../src/index.node";
import { ISettings, IMeta} from "../../src/interfaces.js";

describe("Overwrites", () => {
  test("mask", (): void => {
    let result;
    const logger = new Logger({
      type: "hidden",
      overwrite: {
        mask: (args: unknown[]): unknown[] => {
          return (result = args);
        },
      },
    });

    logger.info("string", 0, { test: 123 });

    expect(result?.[0]).toBe("string");
    expect(result?.[1]).toBe(0);
    expect(typeof result?.[2]).toBe("object");
  });

  test("toLogObj", (): void => {
    let result: any;
    const logger = new Logger({
      type: "hidden",
      overwrite: {
        toLogObj: (args: unknown[]): unknown => {
          return (result = { args });
        },
      },
    });

    logger.info("string", 0, { test: 123 });

    expect(result?.args?.["0"]).toBe("string");
    expect(result?.args?.["1"]).toBe(0);
    expect(typeof result?.args?.["2"]).toBe("object");
  });

  test("addMeta", (): void => {
    let result: any;
    const logger = new Logger({
      type: "hidden",
      overwrite: {
        addMeta: (logObj: any, logLevelId: number, logLevelName: string) => {
          return (result = { logObj, _meta: { logLevelId, logLevelName } });
        },
      },
    });

    logger.info("string", 0, { test: 123 });

    expect(result?.logObj?.["0"]).toBe("string");
    expect(result?.logObj?.["1"]).toBe(0);
    expect(typeof result?.logObj?.["2"]).toBe("object");
    expect(result?._meta?.logLevelId).toBe(3);
    expect(result?._meta?.logLevelName).toBe("INFO");
  });

  test("empty addMeta", (): void => {
    let result: any;
    const logger = new Logger({
      type: "pretty",
      overwrite: {
        addMeta: (logObj: any, logLevelId: number, logLevelName: string) => {
          return (result = logObj);
        },
        transportFormatted: () => {},
      },
    });

    logger.info("string", 0, { test: 123 });

    expect(result?.["0"]).toBe("string");
    expect(result?.["1"]).toBe(0);
    expect(typeof result?.["2"]).toBe("object");
    expect(result?._meta).not.toBeDefined();
  });

  test("formatMeta & formatLogObj & transportFormatted", (): void => {
    const result: any = {};
    const logger = new Logger({
      type: "hidden",
      overwrite: {
        formatMeta: (meta?: IMeta) => {
          result["meta"] = meta;
          return "_META_STRING_";
        },
        formatLogObj: <LogObj>(maskedArgs: unknown[], settings: ISettings<LogObj>) => {
          result["log"] = { maskedArgs, settings };
          return { args: ["_LOG_STRING_"], errors: ["_LOG_ERROR_STRING_"] };
        },
        transportFormatted: (logMetaMarkup: string, logArgs: unknown[], logErrors: string[], settings: unknown) => {
          result["transport"] = { logMetaMarkup, logArgs, logErrors };
        },
      },
    });

    logger.info("string", 0, { test: 123 });

    expect(result?.log?.maskedArgs?.["0"]).toBe("string");
    expect(result?.log?.maskedArgs?.["1"]).toBe(0);
    expect(typeof result?.log?.maskedArgs?.["2"]).toBe("object");
    expect(result?.meta?.logLevelId).toBe(3);
    expect(result?.meta?.logLevelName).toBe("INFO");
    expect(result?.transport?.logMetaMarkup).toBe("_META_STRING_");
    expect(result?.transport?.logArgs?.[0]).toBe("_LOG_STRING_");
    expect(result?.transport?.logErrors?.[0]).toBe("_LOG_ERROR_STRING_");
  });

  test("transportJSON", (): void => {
    let result: any = {};
    const logger = new Logger({
      type: "hidden",
      overwrite: {
        transportJSON: (logObjWithMeta: any) => {
          result = logObjWithMeta;
        },
      },
    });

    logger.info("string", 0, { test: 123 });

    expect(result?.["0"]).toBe("string");
    expect(result?.["1"]).toBe(0);
    expect(typeof result?.["2"]).toBe("object");
    expect(result?.["_meta"]?.logLevelId).toBe(3);
    expect(result?.["_meta"]?.logLevelName).toBe("INFO");
  });
});
