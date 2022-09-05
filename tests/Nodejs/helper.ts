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
