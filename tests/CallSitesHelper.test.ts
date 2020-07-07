import "ts-jest";
const { EOL } = require("os");
const util = require("util");
import { getCallSites, callsitesSym } from "../src/CallSitesHelper";

describe("CallSitesHelper Tests", () => {
  test("return non-empty array", function () {
    const err = new Error("foo");
    const arr = getCallSites(err);
    expect(Array.isArray(arr)).toBeTruthy();
    expect(arr.length > 0).toBeTruthy();
  });

  test("return array of callsites", function () {
    const err = new Error("foo");
    const arr = getCallSites(err);
    expect(typeof arr[0]).toBe("object");
    expect(typeof arr[0].getFileName).toBe("function");
    expect(arr[0].getFileName()).toBe(__filename);
  });

  test("error should have stack string", function () {
    const err = new Error("foo");
    getCallSites(err);
    expect(typeof err.stack).toBe("string");
    expect(err?.stack?.split("\n")[0]).toBe("Error: foo");
  });

  test("process same error twice", function () {
    const err = new Error("foo");
    getCallSites(err);
    getCallSites(err);
    expect(typeof err.stack).toBe("string");
    expect(Array.isArray(err[callsitesSym])).toBeTruthy();
  });

  // In Node.js v7 this used to throw when using this module because it emits a
  // deprecation warning when trying to re-define the callsites symbol property.
  // By defining that property as configurable this error goes away.
  test("run deprecated function", function () {
    util.deprecate(function () {}, "foo")();
  });

  test("overwrite Error.prepareStackTrace", function () {
    Error.prepareStackTrace = () => "boom!";
    const err = new Error("foo");
    expect(err.stack).toBe("boom!");
    expect(Array.isArray(err[callsitesSym])).toBeTruthy();
  });

  test("re-set Error.prepareStackTrace", function () {
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = () => "boom!";

    const e1: Error = {} as Error;
    Error.captureStackTrace(e1);
    expect(e1.stack).toBe("boom!");
    expect(Array.isArray(e1[callsitesSym])).toBeTruthy();

    Error.prepareStackTrace = orig;

    const e2: Error = {} as Error;
    Error.captureStackTrace(e2);
    expect(e2.stack).not.toBe("boom!");
    expect(typeof e2.stack).toBe("string");
    expect(Array.isArray(e2[callsitesSym])).toBeTruthy();
  });

  // Test that we don't get into an infinite loop in case someone else overwrites
  // `Error.prepareStackTrace` while at the same time calling the original value
  // of `Error.prepareStackTrace`. This is a problem with, amongst others, the
  // stackback module.
  test("break infinite loop", function () {
    let calls = 0;
    const orig = Error.prepareStackTrace;

    Error.prepareStackTrace = function (err, callsites) {
      expect(++calls).toBe(1);
      expect(Array.isArray(err[callsitesSym])).toBeTruthy();

      /* @ts-ignore */
      err.foo = 42;

      return orig && orig(err, callsites);
    };

    const err = new Error("foo");
    const stack = err?.stack?.split(EOL);
    const message = stack?.shift();

    Error.prepareStackTrace = orig;

    /* @ts-ignore */
    expect(err.foo).toBe(42);
    // @ts-ignore
    expect(stack.length >= 3).toBeTruthy();
    expect(message).toBe("Error: foo");
    // @ts-ignore
    for (let i = 0; i < stack.length; i++) {
      // @ts-ignore
      expect(stack[i].indexOf("    at ")).toBe(0);
    }
  });
});
