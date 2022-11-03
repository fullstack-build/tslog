import { Logger, BaseLogger } from "../../src";

const defaultLogObject: {
  name: string;
} = {
  name: "test",
};

const logger = new Logger({}, defaultLogObject);

logger.silly("silly foo", { bar: true, password: "123456" }, ["SECRET"]);
logger.trace("trace foo", { bar: true });
logger.debug("debug foo", { bar: true });
logger.info("info foo", { bar: true });
logger.warn("warn foo", { bar: true });
logger.error("error foo", { bar: true });
logger.fatal("fatal foo", { bar: true });

logger.fatal({ onlyOne: true });

logger.fatal("test1 %s test3", "test2");

console.log("###############");

const baseLogger = new BaseLogger({}, defaultLogObject);

baseLogger.log(0, "test", "test base logger", { haha: true, password: "123456" }, ["SECRET"]);

console.log("###############");

const jsonLogger = new Logger({ type: "json" });
jsonLogger.silly("test");
jsonLogger.silly("test1", "test2");

console.log("---------");

jsonLogger.silly({ testObject: true });

console.log("---------");

const jsonLoggerArgumentsArray = new Logger({
  type: "json",
  argumentsArrayName: "argumentsArray",
});
jsonLoggerArgumentsArray.silly("test");
jsonLoggerArgumentsArray.silly("test1", "test2");

const logger2 = new Logger({
  prefix: ["main", "parent"],
});
logger.info("MainLogger message");
// Output:
// INFO   [MainLogger]   main  parent  MainLogger message

const childLogger = logger2.getSubLogger({
  prefix: ["child1"],
});
childLogger.info("child1 message");
// Output:
// INFO   [FirstChild]   main  parent  child1  child1 message

const grandchildLogger: Logger = childLogger.getChildLogger({
  name: "GrandChild",
  prefix: ["grandchild1"],
});
grandchildLogger.silly("grandchild1 message");
// Output:
// INFO   [GrandChild]   main  parent  child1  grandchild1 grandchild1 message

// change settings during runtime
childLogger.setSettings({ prefix: ["renamedChild1"] });
grandchildLogger.silly("grandchild1 second message");
// Output:
// INFO   [GrandChild]   main  parent  renamedChild1     grandchild1 second message
