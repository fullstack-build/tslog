import "jest";
import { Logger } from "../src";

const stdOut = [];
const stdErr = [];

const logger: Logger = new Logger({
  suppressLogging: true,
  stdOut: {
    write: (print: string) => {
      stdOut.push(print);
    },
  },
  stdErr: {
    write: (print: string) => {
      stdErr.push(print);
    },
  },
});

describe("Logger: settings", () => {
  beforeEach(() => {
    stdOut.length = 0;
    stdErr.length = 0;
  });

  test("init logger: plain", (): void => {
    const logger: Logger = new Logger();
    expect(logger instanceof Logger).toBe(true);
  });

  test("init logger: instanceId ", (): void => {
    const logger: Logger = new Logger({ instanceId: "ABC" });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.instanceId).toBe("ABC");
  });

  test("init logger: minLevel", (): void => {
    const logger: Logger = new Logger({ minLevel: 3 });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.minLevel).toBe(3);
  });

  test("init logger: name", (): void => {
    const logger: Logger = new Logger({ name: "Test" });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.name).toBe("Test");
  });

  test("init logger: exposeStack", (): void => {
    const logger: Logger = new Logger({ exposeStack: true });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.exposeStack).toBe(true);
  });

  test("init logger: suppressLogging", (): void => {
    const logger: Logger = new Logger({ suppressLogging: true });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.suppressLogging).toBe(true);
  });

  test("init logger: overwriteConsole", (): void => {
    const logger: Logger = new Logger({ overwriteConsole: true });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.overwriteConsole).toBe(true);
  });

  test("init logger: logAsJson", (): void => {
    const logger: Logger = new Logger({ logAsJson: true });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.logAsJson).toBe(true);
  });

  test("init logger: logLevelsColors", (): void => {
    const logger: Logger = new Logger({
      logLevelsColors: {
        0: "#000000",
        1: "#F00000",
        2: "#0F0000",
        3: "#00F000",
        4: "#000F00",
        5: "#0000F0",
        6: "#00000F",
      },
    });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.logLevelsColors[0]).toBe("#000000");
    expect(logger.settings.logLevelsColors[1]).toBe("#F00000");
    expect(logger.settings.logLevelsColors[2]).toBe("#0F0000");
    expect(logger.settings.logLevelsColors[3]).toBe("#00F000");
    expect(logger.settings.logLevelsColors[4]).toBe("#000F00");
    expect(logger.settings.logLevelsColors[5]).toBe("#0000F0");
    expect(logger.settings.logLevelsColors[6]).toBe("#00000F");
  });

  test("init logger: jsonHighlightColors", (): void => {
    const logger: Logger = new Logger({
      jsonHighlightColors: {
        number: "#000000",
        key: "#F00000",
        string: "#0F0000",
        boolean: "#00F000",
        null: "#000F00",
      },
    });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.jsonHighlightColors.number).toBe("#000000");
    expect(logger.settings.jsonHighlightColors.key).toBe("#F00000");
    expect(logger.settings.jsonHighlightColors.string).toBe("#0F0000");
    expect(logger.settings.jsonHighlightColors.boolean).toBe("#00F000");
    expect(logger.settings.jsonHighlightColors.null).toBe("#000F00");
  });

  test("init logger: stdOut", (): void => {
    const std: { write: () => void } = { write: () => {} };
    const logger: Logger = new Logger({ stdOut: std });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.stdOut).toBe(std);
  });

  test("init logger: stdErr", (): void => {
    const std: { write: () => void } = { write: () => {} };
    const logger: Logger = new Logger({ stdErr: std });
    expect(logger instanceof Logger).toBe(true);
    expect(logger.settings.stdErr).toBe(std);
  });
});
