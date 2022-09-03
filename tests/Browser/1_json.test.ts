/**
 * @jest-environment puppeteer
 */
import 'expect-puppeteer';
import {getConsoleLog} from "../Nodejs/helper";

let consoleOutput = "";
describe('Browser: JSON: Log level', () => {
    beforeAll(async () => {
        await page.goto('http://localhost:4444', { waitUntil: 'load' });
        page.on('console', consoleObj => consoleOutput = consoleObj.text());
    })
    beforeEach(() => {
        consoleOutput = "";
    });

    it('Server and Page initiated', async () => {
        const html = await page.content();
        await expect(html).toContain('tslog Demo');
    });

    it('silly', async () => {
        await page.evaluate( () => {
            // @ts-ignore
            const logger = new tslog.Logger({ type: "json" });
            logger.silly("Test");
        });

        expect(consoleOutput).toContain(`"0": "Test"`);
        expect(consoleOutput).toContain(`"_meta": {`);
        expect(consoleOutput).toContain(`"runtime": "Browser"`);
        expect(consoleOutput).toContain(`"date": "${new Date().toISOString().split(".")[0]}`); // ignore ms
        expect(consoleOutput).toContain(`"logLevelId": 0`);
        expect(consoleOutput).toContain(`"logLevelName": "SILLY"`);
        expect(consoleOutput).toContain(`"path": {`);
        expect(consoleOutput).toContain(`"filePath": "pptr",`);
        expect(consoleOutput).toContain(`"fileLine": "4"`);
    });
});
