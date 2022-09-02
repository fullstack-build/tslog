import "ts-jest";
import { Logger } from "../src";

import { mockConsoleLog, getConsoleLog } from "./helper";

describe("Pretty: Settings", () => {
    beforeEach(() => {
        mockConsoleLog(true, false);
    });

    test("plain string", (): void => {
        const logger = new Logger({ type: "pretty" });
        logger.log(1234, "testLevel", "Test");
        expect(getConsoleLog()).toContain(`testLevel`);
        expect(getConsoleLog()).toContain(`]\nTest`);
    });

    test("two strings", (): void => {
        const logger = new Logger({ type: "json" });
        logger.log(1234, "testLevel", "Test1", "Test2");
        expect(getConsoleLog()).toContain(`"0": "Test1"`);
        expect(getConsoleLog()).toContain(`"1": "Test2"`);
        expect(getConsoleLog()).toContain(`"_meta": {`);
    });

    test("argumentsArray", (): void => {
        const logger = new Logger({ type: "json", argumentsArrayName: "argumentsArray"});
        logger.log(1234, "testLevel", "Test1", "Test2");
        expect(getConsoleLog()).toContain(`"argumentsArray": [
    "Test1",
    "Test2"
  ]`);
        expect(getConsoleLog()).toContain(`"_meta": {`);
    });

    test("metaProperty", (): void => {
        const logger = new Logger({ type: "json", metaProperty: "_test"});
        logger.log(1234, "testLevel", "Test");
        expect(getConsoleLog()).toContain(`"_test": {`);
    });

    test("maskValuesOfKeys not set", (): void => {
        const logger = new Logger({ type: "json"});
        logger.log(1234, "testLevel", {
            "password": "pass123"
        });
        expect(getConsoleLog()).toContain(`"password": "[***]"`);
        expect(getConsoleLog()).not.toContain(`pass123`);
    });

    test("maskValuesOfKeys set and maskPlaceholder", (): void => {
        const logger = new Logger({ type: "json", maskValuesOfKeys: ["otherKey"], maskPlaceholder: "[###]"});
        logger.log(1234, "testLevel", {
            "password": "pass123",
            "otherKey": "otherKey456",
        });

        expect(getConsoleLog()).toContain(`"otherKey": "[###]"`);
        expect(getConsoleLog()).not.toContain(`otherKey456`);
    });

    test("maskValuesOfKeys set two keys and maskPlaceholder", (): void => {
        const logger = new Logger({ type: "json", maskValuesOfKeys: ["password", "otherKey"], maskPlaceholder: "[###]"});
        logger.log(1234, "testLevel", {
            "password": "pass123",
            "otherKey": "otherKey456",
        });
        expect(getConsoleLog()).toContain(`"password": "[###]"`);
        expect(getConsoleLog()).not.toContain(`pass123`);
        expect(getConsoleLog()).toContain(`"otherKey": "[###]"`);
        expect(getConsoleLog()).not.toContain(`otherKey456`);
    });

});
