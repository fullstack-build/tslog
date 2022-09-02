import "ts-jest";
import { Logger } from "../src";


const logger = new Logger({ type: "hidden" });
let consoleOutput = "";
describe("Hidden: Log level", () => {
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
        expect(consoleOutput).toContain("");
    });

});
