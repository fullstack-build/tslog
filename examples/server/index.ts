import { Logger, ILogObj } from "../../src/index.js";

class MyClass {
  private readonly _logger: Logger<ILogObj> = new Logger({
    type: "pretty",
  });

  public constructor() {
    this._logger.silly("I am a silly log.");
  }

  public myMethod(): void {
    const jsonObj: any = {
      name: "John Doe",
      age: 30,
      cars: {
        car1: "Audi",
        car2: "BMW",
        car3: "Tesla",
      },
      obj: undefined,
    };
    jsonObj.obj = jsonObj;

    this._logger.debug("I am a debug log.");
    this._logger.info("I am an info log.");
    this._logger.warn("I am a warn log with a json object:", jsonObj);
    this._logger.error("I am an error log.");
    try {
      /* @ts-ignore */
      null.foo();
    } catch (err) {
      this._logger.fatal(err);
    }
  }
}

const myClass: MyClass = new MyClass();
myClass.myMethod();

const log = new Logger({});
log.silly("I am a silly log.");
// log.trace("I am a trace log with a stack trace.");
log.debug("I am a debug log.");
log.info("I am an info log.");
log.warn("I am a warn log with a json object:", { foo: "bar" });
log.error("I am an error log.");
log.fatal(new Error("I am a pretty Error with a stacktrace."));

/*
 * Circular example
 * */
function Foo() {
  /* @ts-ignore */
  this.abc = "Hello";
  /* @ts-ignore */
  this.circular = this;
}
/* @ts-ignore */
const foo = new Foo();
const logMessage = log.debug(foo);
console.log("JSON.stringify circular log message", logMessage);

/* Child Logger Example */

const mainLogger = new Logger({
  prefix: ["main"],
});
mainLogger.info("MainLogger initiated");

const childLogger1 = mainLogger.getSubLogger({
  prefix: ["child1"],
});
childLogger1.info("ChildLogger1 initiated");

const childLogger1_1 = childLogger1.getSubLogger({
  prefix: ["child1-1"],
});
childLogger1_1.info("ChildLogger1-1 initiated");
childLogger1_1.silly("ChildLogger1-1 silly 1");
childLogger1_1.silly("ChildLogger1-1 silly 2");
childLogger1_1.silly("ChildLogger1-1 silly 3");

childLogger1_1.silly("ChildLogger1-1 silly 4");
childLogger1_1.silly("ChildLogger1-1 silly 5");

childLogger1_1.silly("ChildLogger1-1 silly 6");
childLogger1_1.debug("ChildLogger1-1 debug finish");
const yetAnotherLogger = childLogger1_1.getSubLogger();
yetAnotherLogger.info("Yet another Logger with a name function");

/** Example: Hide Secrets */
let verySecretiveObject = {
  password: "swordfish",
  Authorization: 1234567,
  stringPwd: "swordfish",
  nested: {
    regularString: "I am just a regular string.",
    otherString: "pass1234.567",
  },
};
(verySecretiveObject.nested as any)["circular"] = verySecretiveObject;
