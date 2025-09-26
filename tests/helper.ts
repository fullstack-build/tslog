let consoleOutput = "";

export function mockConsoleLog(resetConsoleOutput = false, printConsole = false) {
  const storeLog = (inputs: unknown) => {
    if (printConsole) {
      process.stdout.write("console.log: " + inputs + "\n");
    }
    consoleOutput += inputs;
  };
  console["log"] = jest.fn(storeLog);
  if (resetConsoleOutput) {
    consoleOutput = "";
  }
}

export function getConsoleLog() {
  return consoleOutput;
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function getConsoleLogStripped() {
  return consoleOutput.replace(ANSI_PATTERN, "");
}

export function stripAnsi(value: string) {
  return value.replace(ANSI_PATTERN, "");
}
