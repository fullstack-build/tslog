import "ts-jest";
import { Logger } from "../src";


let consoleOutput = "";
describe("JSON: Log level", () => {
    beforeEach(() => {
        const storeLog = (inputs: any) => (consoleOutput += inputs);
        console["log"] = jest.fn(storeLog);
        consoleOutput = "";
    });

    test("plain string", (): void => {
        const logger = new Logger({ type: "json" });
        logger.log(1234, "testLevel", "Test");
        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"logLevelId": 1234`);
        expect(consoleOutput).toContain(`"logLevelName": "testLevel"`);
    });

    test("two strings", (): void => {
        const logger = new Logger({ type: "json" });
        logger.log(1234, "testLevel", "Test1", "Test2");
        expect(consoleOutput).toContain(`"0": "Test1"`);
        expect(consoleOutput).toContain(`"1": "Test2"`);
        expect(consoleOutput).toContain(`"_meta": {`);
    });

    test("argumentsArray", (): void => {
        const logger = new Logger({ type: "json", argumentsArrayName: "argumentsArray"});
        logger.log(1234, "testLevel", "Test1", "Test2");
        expect(consoleOutput).toContain(`"argumentsArray": [
    "Test1",
    "Test2"
  ]`);
        expect(consoleOutput).toContain(`"_meta": {`);
    });

    test("metaProperty", (): void => {
        const logger = new Logger({ type: "json", metaProperty: "_test"});
        logger.log(1234, "testLevel", "Test");
        expect(consoleOutput).toContain(`"_test": {`);
    });

    test("maskValuesOfKeys not set", (): void => {
        const logger = new Logger({ type: "json"});
        logger.log(1234, "testLevel", {
            "password": "pass123"
        });
        expect(consoleOutput).toContain(`"password": "[***]"`);
        expect(consoleOutput).not.toContain(`pass123`);
    });

    test("maskValuesOfKeys set and maskPlaceholder", (): void => {
        const logger = new Logger({ type: "json", maskValuesOfKeys: ["otherKey"], maskPlaceholder: "[###]"});
        logger.log(1234, "testLevel", {
            "password": "pass123",
            "otherKey": "otherKey456",
        });

        expect(consoleOutput).toContain(`"otherKey": "[###]"`);
        expect(consoleOutput).not.toContain(`otherKey456`);
    });

    test("maskValuesOfKeys set two keys and maskPlaceholder", (): void => {
        const logger = new Logger({ type: "json", maskValuesOfKeys: ["password", "otherKey"], maskPlaceholder: "[###]"});
        logger.log(1234, "testLevel", {
            "password": "pass123",
            "otherKey": "otherKey456",
        });
        expect(consoleOutput).toContain(`"password": "[###]"`);
        expect(consoleOutput).not.toContain(`pass123`);
        expect(consoleOutput).toContain(`"otherKey": "[###]"`);
        expect(consoleOutput).not.toContain(`otherKey456`);
    });

});
