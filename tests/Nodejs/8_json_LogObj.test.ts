import "ts-jest";
import { BaseLogger, Logger } from "../../src";
import { mockConsoleLog, getConsoleLog } from "./helper";

interface ILogObj {
    name: string
};

describe("JSON: LogObj", () => {
    beforeEach(() => {
        mockConsoleLog(true, false);
    });

    test("BaseLogger with LogObj", (): void => {

        const defaultLogObject: ILogObj = {
            name: "test"
        };
        const logger = new BaseLogger<ILogObj>({ type: "json" }, defaultLogObject);
        const logMsg = logger.log(1234, "testLevel", "Test");
        expect(logMsg.name).toContain(defaultLogObject.name);
        expect(getConsoleLog()).toContain(`"name": "test",`);
        expect(getConsoleLog()).toContain(`"0": "Test",`);
    });

    test("Logger with LogObj", (): void => {

        const defaultLogObject: ILogObj = {
            name: "test"
        };
        const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
        const logMsg = logger.log(1234, "testLevel", "Test");
        expect(logMsg.name).toContain(defaultLogObject.name);
        expect(getConsoleLog()).toContain(`"name": "test",`);
        expect(getConsoleLog()).toContain(`"0": "Test",`);
    });

    test("Logger with LogObj: silly", (): void => {

        const defaultLogObject: ILogObj = {
            name: "test"
        };
        const logger = new Logger<ILogObj>({ type: "json" }, defaultLogObject);
        const logMsg = logger.silly( "Test");
        expect(logMsg.name).toContain(defaultLogObject.name);
        expect(getConsoleLog()).toContain(`"name": "test",`);
        expect(getConsoleLog()).toContain(`"0": "Test",`);
    });
});
