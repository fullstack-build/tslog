import { Logger } from "../dist";

class MyClass {
  private readonly _logger: Logger = new Logger();

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
    this._logger.fatal(new Error("I am a pretty Error with a stacktrace."));
    this._logger.debug(new Promise((): void => {}));
  }
}

const myClass: MyClass = new MyClass();
myClass.myMethod();
