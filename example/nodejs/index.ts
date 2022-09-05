import { Logger, BaseLogger } from "../../src";

const defaultLogObject: {
  name: string;
} = {
  name: "test",
};

const logger = new Logger({}, defaultLogObject);

logger.silly("silly huhu", { haha: true, password: "123456" }, ["SECRET"]);
logger.trace("trace huhu", { haha: true });
logger.debug("debug huhu", { haha: true });
logger.info("info huhu", { haha: true });
logger.warn("warn huhu", { haha: true });
logger.error("error huhu", { haha: true });
logger.fatal("fatal huhu", { haha: true });

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
