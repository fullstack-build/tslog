import "ts-jest";
import { Logger } from "../../src";
import { ILogObjMeta } from "../../src/interfaces";
import {IMeta, InspectOptions} from "../../src/runtime/nodejs";

describe("Overwrites", () => {

    test("mask", (): void => {
        let result;
        const logger = new Logger({ type: "hidden", overwrite: {
            mask: (args: unknown[]): unknown[] => {
                return result = args;
            }
        }});

        logger.info("string", 0, { test: 123 });

        expect(result?.[0]).toBe("string");
        expect(result?.[1]).toBe(0);
        expect(typeof result?.[2]).toBe("object");
    });

    test("toLogObj", (): void => {
        let result: any;
        const logger = new Logger({ type: "hidden", overwrite: {
                toLogObj: (args: unknown[]): unknown => {
                    return result = { args };
                }
            }});

        logger.info("string", 0, { test: 123 });

        expect(result?.args?.["0"]).toBe("string");
        expect(result?.args?.["1"]).toBe(0);
        expect(typeof result?.args?.["2"]).toBe("object");
    });

    test("addMeta", (): void => {
        let result: any;
        const logger = new Logger({ type: "hidden", overwrite: {
            addMeta: (logObj: any, logLevelId: number, logLevelName: string) => {
                return result = { logObj, _meta: { logLevelId, logLevelName } };
            }
        }});

        logger.info("string", 0, { test: 123 });

        expect(result?.logObj?.["0"]).toBe("string");
        expect(result?.logObj?.["1"]).toBe(0);
        expect(typeof result?.logObj?.["2"]).toBe("object");
        expect(result?._meta?.logLevelId).toBe(3);
        expect(result?._meta?.logLevelName).toBe("INFO");
    });

    test("empty addMeta", (): void => {
        let result: any;
        const logger = new Logger({ type: "pretty", overwrite: {
                addMeta: (logObj: any, logLevelId: number, logLevelName: string) => {
                    return result = logObj;
                },
                transportFormatted: () => {}
            }});

        logger.info("string", 0, { test: 123 });

        expect(result?.["0"]).toBe("string");
        expect(result?.["1"]).toBe(0);
        expect(typeof result?.["2"]).toBe("object");
        expect(result?._meta).not.toBeDefined();
    });

    test("formatMeta & formatLogObj & transportFormatted", (): void => {
        let result: any = {};
        const logger = new Logger({ type: "hidden", overwrite: {
                formatMeta: (meta?: IMeta) => {
                    result["meta"] = meta;
                    return "_META_STRING_";
                },
                formatLogObj: (maskedArgs: unknown[], prettyInspectOptions: InspectOptions) => {
                    result["log"] = { maskedArgs, prettyInspectOptions };
                    return "_LOG_STRING_";
                },
                transportFormatted: (logMetaMarkup: string, logMarkup: string) => {
                    result["transport"] = { logMetaMarkup, logMarkup };
                }
            }
        });

        logger.info("string", 0, { test: 123 });

        expect(result?.log?.maskedArgs?.["0"]).toBe("string");
        expect(result?.log?.maskedArgs?.["1"]).toBe(0);
        expect(typeof result?.log?.maskedArgs?.["2"]).toBe("object");
        expect(result?.meta?.logLevelId).toBe(3);
        expect(result?.meta?.logLevelName).toBe("INFO");
        expect(result?.transport?.logMetaMarkup).toBe("_META_STRING_");
        expect(result?.transport?.logMarkup).toBe("_LOG_STRING_");
    });

    test("transportJSON", (): void => {
        let result: any = {};
        const logger = new Logger({ type: "hidden", overwrite: {

                transportJSON: (logObjWithMeta: any) => {
                    result = logObjWithMeta;
                }
            }
        });

        logger.info("string", 0, { test: 123 });

        expect(result?.["0"]).toBe("string");
        expect(result?.["1"]).toBe(0);
        expect(typeof result?.["2"]).toBe("object");
        expect(result?.["_meta"]?.logLevelId).toBe(3);
        expect(result?.["_meta"]?.logLevelName).toBe("INFO");
    });


});

