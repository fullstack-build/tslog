import "ts-jest";
import { Logger } from "../../src/index.node";
import { mockConsoleLog } from "./helper.js";

describe("Recursive", () => {
  beforeEach(() => {
    mockConsoleLog(true, false);
  });

  test("hidden", (): void => {
    const mainLogger = new Logger({ type: "hidden" });

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
    const logMsg = mainLogger.info("circular", foo);
    expect(logMsg?.["0"]).toBe("circular");
    expect(logMsg?.["1"]["circular"]).toEqual(logMsg?.["1"]);
  });

  test("json", (): void => {
    const mainLogger = new Logger({ type: "json" });

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
    const logMsg = mainLogger.info("circular", foo);
    expect(logMsg?.["0"]).toBe("circular");
    expect(logMsg?.["1"]["circular"]).toEqual(logMsg?.["1"]);
  });

  test("pretty", (): void => {
    const mainLogger = new Logger({ type: "pretty" });

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
    const logMsg = mainLogger.info("circular", foo);
    expect(logMsg?.["0"]).toBe("circular");
    expect(logMsg?.["1"]["circular"]).toEqual(logMsg?.["1"]);
  });

  test("pretty recursive LogObj function", (): void => {
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
    const mainLogger = new Logger({ type: "pretty" }, foo);

    const logMsg = mainLogger.info("circular");
    expect(logMsg?.["0"]).toBe("circular");
  });
});
