let consoleOutput = "";

export function mockConsoleLog(resetConsoleOutput: boolean = false, printConsole: boolean = false) {
    const storeLog = (inputs: any) => {
        if(printConsole) {
            process.stdout.write("console.log: " + inputs + "\n");
        }
        consoleOutput += inputs;
    };
    console["log"] = jest.fn(storeLog);
    if(resetConsoleOutput) {
        consoleOutput = "";
    }
}

export function getConsoleLog() {
    return consoleOutput;
}
