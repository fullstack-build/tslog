import "ts-jest";
import { Logger } from "../src";


const logger = new Logger({ type: "json" });
let consoleOutput = "";
describe("JSON: Log level", () => {
    beforeEach(() => {
        const storeLog = (inputs: any) => {
            process.stdout.write("console.log: " + inputs + "\n");
            consoleOutput += inputs;
        };
        console["log"] = jest.fn(storeLog);
        consoleOutput = "";
    });

    test("silly (console)", (): void => {
        logger.silly("Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"runtime": "`);
        expect(consoleOutput).toContain(`"hostname": "`);
        expect(consoleOutput).toContain(`"date": "${new Date().toISOString().split(".")[0]}`); // ignore ms
        expect(consoleOutput).toContain(`"logLevelId": 0`);
        expect(consoleOutput).toContain(`"logLevelName": "SILLY"`);
        expect(consoleOutput).toContain("\"path\": {");
        expect(consoleOutput).toContain("\"path\": {");

    });

    test("trace (console)", (): void => {
        logger.trace("Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"logLevelName": "TRACE"`);
    });

    test("debug (console)", (): void => {
        logger.debug("Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"logLevelName": "DEBUG"`);
    });

    test("info (console)", (): void => {
        logger.info("Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"logLevelName": "INFO"`);
    });

    test("warn (console)", (): void => {
        logger.warn("Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"logLevelName": "WARN"`);
    });

    test("error (console)", (): void => {
        logger.error("Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"logLevelName": "ERROR"`);
    });

    test("fatal (console)", (): void => {
        logger.fatal("Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"logLevelName": "FATAL"`);
    });

});
