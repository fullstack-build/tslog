import { Logger, BaseLogger } from "../../src/index.js";

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

////////////////////////////

const mainLogger = new Logger({ type: "pretty", name: "MainLogger" });
mainLogger.silly("foo bar");

const firstSubLogger = mainLogger.getSubLogger({ name: "FirstSubLogger" });
firstSubLogger.silly("foo bar 1");

const secondSubLogger = firstSubLogger.getSubLogger({ name: "SecondSubLogger" });
secondSubLogger.silly("foo bar 2");

////////////////////////////

const performanceLogger = new Logger({
  hideLogPositionForProduction: true,
});

performanceLogger.silly("log without code position information");

////////////////////////////
const loggerMap = new Logger({ name: "mapLogger" });

let map = new Map();
map.set("foo", "bar");
loggerMap.debug("My Map: ", map); // prints in console "DEBUG myLogger My Map: {}"

////////////////////////////

const error = new TypeError();
Object.assign(error, {
  extensions: {
    serviceName: "upstream-service",
    variables: {
      firstName: "foo",
      phoneNumber: "bar",
    },
  },
});

const log = new Logger({
  maskValuesOfKeys: ["firstName", "phoneNumber"],
  type: "json",
});

log.info(error);
