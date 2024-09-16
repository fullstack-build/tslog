import { Logger, BaseLogger, ILogObj, ILogObjMeta, IMeta } from "../../src/index.js";

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

////////////////////////////

function createReadonlyError(message: string, property: string) {
  const error = new Error(message);
  Object.defineProperty(error, "property", {
    value: property,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  return error;
}

const e = createReadonlyError("message", "property");

logger.error(e);

///////////////////////////

class CustomError extends Error {
  constructor(message1: string, message2: string) {
    super(message1);
    console.log("***", message1, message2);
  }
}

const err = new CustomError("a", "b");
logger.error(err);

console.log("***********");
logger.debug(null);
logger.debug(undefined);
logger.debug("*", undefined);
console.log("###############");
//jsonLogger.debug(null);
jsonLogger.debug(undefined);
//jsonLogger.debug('*', undefined);
console.log("###############");
logger.debug(new URL("https://www.test.de"));

interface IRequestMeta extends IMeta {
  requestId: string;
}

const newLogger = new Logger({
  type: "json",
  metaProperty: "_meta",
  overwrite: {
    addMeta: (logObj: ILogObj, logLevelId: number, logLevelName: string, defaultMeta?: IMeta): ILogObj & ILogObjMeta => {
      const meta = (defaultMeta || {}) as IRequestMeta;
      meta.requestId = "0000-aaaaa-bbbbb-1111";

      return {
        ...logObj,
        _meta: meta,
      };
    },
    includeDefaultMetaInAddMeta: true,
  },
});

newLogger.info("Testing with metadata");
