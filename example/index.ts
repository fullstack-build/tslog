import { Logger } from "../src";

class MyClass {
  private readonly _logger: Logger = new Logger({
    displayInstanceName: false,
  });

  public constructor() {
    this._logger.silly("I am a silly log.");
  }

  public myMethod(): void {
    const jsonObj: object = {
      name: "John Doe",
      age: 30,
      cars: {
        car1: "Audi",
        car2: "BMW",
        car3: "Tesla",
      },
    };
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

const log: Logger = new Logger();
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
log.debug(foo);
