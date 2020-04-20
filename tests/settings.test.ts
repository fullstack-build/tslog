import ava, { ExecutionContext, TestInterface } from "ava";
import { Logger } from "../src/index";
import { doesLogContain, IContext } from "./helper";

const avaTest = ava as TestInterface<IContext>;

avaTest.beforeEach((test: ExecutionContext<IContext>) => {
  test.context = {
    stdOut: [],
    stdErr: [],
    logger: new Logger(),
  };
});

avaTest("init logger: plain", (test: ExecutionContext<IContext>): void => {
  const logger: Logger = new Logger();
  test.is(logger instanceof Logger, true);
});

avaTest(
  "init logger: instanceId ",
  (test: ExecutionContext<IContext>): void => {
    const logger: Logger = new Logger({ instanceId: "ABC" });
    test.is(logger instanceof Logger, true);
    test.is(logger.settings.instanceId, "ABC");
  }
);

avaTest("init logger: minLevel", (test: ExecutionContext<IContext>): void => {
  const logger: Logger = new Logger({ minLevel: 3 });
  test.is(logger instanceof Logger, true);
  test.is(logger.settings.minLevel, 3);
});

avaTest("init logger: name", (test: ExecutionContext<IContext>): void => {
  const logger: Logger = new Logger({ name: "Test" });
  test.is(logger instanceof Logger, true);
  test.is(logger.settings.name, "Test");
});

avaTest(
  "init logger: exposeStack",
  (test: ExecutionContext<IContext>): void => {
    const logger: Logger = new Logger({ exposeStack: true });
    test.is(logger instanceof Logger, true);
    test.is(logger.settings.exposeStack, true);
  }
);

avaTest(
  "init logger: suppressLogging",
  (test: ExecutionContext<IContext>): void => {
    const logger: Logger = new Logger({ suppressLogging: true });
    test.is(logger instanceof Logger, true);
    test.is(logger.settings.suppressLogging, true);
  }
);

avaTest(
  "init logger: overwriteConsole",
  (test: ExecutionContext<IContext>): void => {
    const logger: Logger = new Logger({ overwriteConsole: true });
    test.is(logger instanceof Logger, true);
    test.is(logger.settings.overwriteConsole, true);
  }
);

avaTest("init logger: logAsJson", (test: ExecutionContext<IContext>): void => {
  const logger: Logger = new Logger({ logAsJson: true });
  test.is(logger instanceof Logger, true);
  test.is(logger.settings.logAsJson, true);
});

avaTest(
  "init logger: logLevelsColors",
  (test: ExecutionContext<IContext>): void => {
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
    test.is(logger instanceof Logger, true);
    test.is(logger.settings.logLevelsColors[0], "#000000");
    test.is(logger.settings.logLevelsColors[1], "#F00000");
    test.is(logger.settings.logLevelsColors[2], "#0F0000");
    test.is(logger.settings.logLevelsColors[3], "#00F000");
    test.is(logger.settings.logLevelsColors[4], "#000F00");
    test.is(logger.settings.logLevelsColors[5], "#0000F0");
    test.is(logger.settings.logLevelsColors[6], "#00000F");
  }
);

avaTest(
  "init logger: jsonHighlightColors",
  (test: ExecutionContext<IContext>): void => {
    const logger: Logger = new Logger({
      jsonHighlightColors: {
        number: "#000000",
        key: "#F00000",
        string: "#0F0000",
        boolean: "#00F000",
        null: "#000F00",
      },
    });
    test.is(logger instanceof Logger, true);
    test.is(logger.settings.jsonHighlightColors.number, "#000000");
    test.is(logger.settings.jsonHighlightColors.key, "#F00000");
    test.is(logger.settings.jsonHighlightColors.string, "#0F0000");
    test.is(logger.settings.jsonHighlightColors.boolean, "#00F000");
    test.is(logger.settings.jsonHighlightColors.null, "#000F00");
  }
);

avaTest("init logger: stdOut", (test: ExecutionContext<IContext>): void => {
  const std: { write: () => void } = { write: () => {} };
  const logger: Logger = new Logger({ stdOut: std });
  test.is(logger instanceof Logger, true);
  test.is(logger.settings.stdOut, std);
});

avaTest("init logger: stdErr", (test: ExecutionContext<IContext>): void => {
  const std: { write: () => void } = { write: () => {} };
  const logger: Logger = new Logger({ stdErr: std });
  test.is(logger instanceof Logger, true);
  test.is(logger.settings.stdErr, std);
});
