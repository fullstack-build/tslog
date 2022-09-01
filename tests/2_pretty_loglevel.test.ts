import "ts-jest";
import { Logger } from "../src";


const logger = new Logger({ type: "json" });
let consoleOutput = "";
describe("Pretty: Log level", () => {
    beforeEach(() => {
        const storeLog = (inputs: any) => (consoleOutput += inputs);
        console["log"] = jest.fn(storeLog);
        consoleOutput = "";
    });

    test("silly (console)", (): void => {
        logger.silly("Test");
        expect(consoleOutput).toContain("SILLY");
        expect(consoleOutput).toContain("Test");
    });

    test("trace (console)", (): void => {
        logger.trace("Test");
        expect(consoleOutput).toContain("TRACE");
        expect(consoleOutput).toContain("Test");
    });

    test("debug (console)", (): void => {
        logger.debug("Test");
        expect(consoleOutput).toContain("DEBUG");
        expect(consoleOutput).toContain("Test");
    });

    test("info (console)", (): void => {
        logger.info("Test");
        expect(consoleOutput).toContain("INFO");
        expect(consoleOutput).toContain("Test");
    });

    test("warn (console)", (): void => {
        logger.warn("Test");
        expect(consoleOutput).toContain("WARN");
        expect(consoleOutput).toContain("Test");
    });

    test("error (console)", (): void => {
        logger.error("Test");
        expect(consoleOutput).toContain("ERROR");
        expect(consoleOutput).toContain("Test");
    });

    test("fatal (console)", (): void => {
        logger.fatal("Test");
        expect(consoleOutput).toContain("FATAL");
        expect(consoleOutput).toContain("Test");
    });
});
