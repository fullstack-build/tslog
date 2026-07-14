import { expect, test } from "@playwright/test";
import { captureConsole, inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

test.describe("Advanced error handling (browser)", () => {
  test("custom error subclass with extra properties", async ({ page }) => {
    const result = await inPage<{ isHttpError: boolean; name: unknown; message: unknown; stackIsArray: boolean }>(
      page,
      { type: "hidden" },
      `
      class HttpError extends Error {
        constructor(message, status) {
          super(message);
          this.name = "HttpError";
          this.status = status;
        }
      }
      const logger = new tslog.Logger(settings);
      const logObj = logger.info(new HttpError("Not Found", 404));
      return {
        isHttpError: logObj.nativeError instanceof HttpError,
        name: logObj.name,
        message: logObj.message,
        stackIsArray: Array.isArray(logObj.stack),
      };
    `,
    );
    expect(result.isHttpError).toBe(true);
    expect(result.name).toBe("HttpError");
    expect(result.message).toBe("Not Found");
    expect(result.stackIsArray).toBe(true);
  });

  test("error cause chain serializes nested causes", async ({ page }) => {
    const result = await inPage<{ name: unknown; message: unknown; causeDefined: boolean; causeMessage: unknown; rootCauseMessage: unknown }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const root = new Error("root cause");
      const middle = new Error("middle", { cause: root });
      const outer = new Error("outer", { cause: middle });
      const logObj = logger.info(outer);
      return {
        name: logObj.name,
        message: logObj.message,
        causeDefined: logObj.cause != null,
        causeMessage: logObj.cause && logObj.cause.message,
        rootCauseMessage: logObj.cause && logObj.cause.cause && logObj.cause.cause.message,
      };
    `,
    );
    expect(result.name).toBe("Error");
    expect(result.message).toBe("outer");
    expect(result.causeDefined).toBe(true);
    expect(result.causeMessage).toBe("middle");
    expect(result.rootCauseMessage).toBe("root cause");
  });

  test("deep cause chain is capped at max depth", async ({ page }) => {
    const depth = await inPage<number>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      let err = new Error("level-0");
      for (let i = 1; i <= 7; i++) {
        err = new Error("level-" + i, { cause: err });
      }
      const logObj = logger.info(err);
      let current = logObj;
      let depth = 0;
      while (current && current.cause != null) {
        depth++;
        current = current.cause;
      }
      return depth;
    `,
    );
    expect(depth).toBeLessThanOrEqual(5);
  });

  test("non-Error cause value (string) is wrapped", async ({ page }) => {
    const result = await inPage<{ causeDefined: boolean; causeIsError: boolean }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const err = new Error("main");
      err.cause = "string cause";
      const logObj = logger.info(err);
      return {
        causeDefined: logObj.cause != null,
        causeIsError: logObj.cause != null && logObj.cause.nativeError instanceof Error,
      };
    `,
    );
    expect(result.causeDefined).toBe(true);
    expect(result.causeIsError).toBe(true);
  });

  test("non-Error cause value (object) is wrapped", async ({ page }) => {
    const result = await inPage<{ causeDefined: boolean; causeIsError: boolean }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const err = new Error("main");
      err.cause = { code: 404, msg: "not found" };
      const logObj = logger.info(err);
      return {
        causeDefined: logObj.cause != null,
        causeIsError: logObj.cause != null && logObj.cause.nativeError instanceof Error,
      };
    `,
    );
    expect(result.causeDefined).toBe(true);
    expect(result.causeIsError).toBe(true);
  });

  test("AggregateError is logged without throwing", async ({ page }) => {
    const result = await inPage<{ threw: boolean; defined: boolean; name: unknown; message: unknown }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const agg = new AggregateError([new Error("e1"), new Error("e2")], "multiple errors");
      try {
        const logObj = logger.info(agg);
        return { threw: false, defined: logObj != null, name: logObj.name, message: logObj.message };
      } catch {
        return { threw: true, defined: false, name: null, message: null };
      }
    `,
    );
    expect(result.threw).toBe(false);
    expect(result.defined).toBe(true);
    expect(result.name).toBe("AggregateError");
    expect(result.message).toBe("multiple errors");
  });

  test("error with empty stack does not throw", async ({ page }) => {
    const result = await inPage<{ threw: boolean; defined: boolean; stackIsArray: boolean }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const err = new Error("no stack");
      err.stack = undefined;
      try {
        const logObj = logger.info(err);
        return { threw: false, defined: logObj != null, stackIsArray: Array.isArray(logObj.stack) };
      } catch {
        return { threw: true, defined: false, stackIsArray: false };
      }
    `,
    );
    expect(result.threw).toBe(false);
    expect(result.defined).toBe(true);
    expect(result.stackIsArray).toBe(true);
  });

  test("error with non-standard stack format degrades gracefully", async ({ page }) => {
    const result = await inPage<{ threw: boolean; defined: boolean }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const err = new Error("weird");
      err.stack = "CUSTOM_FORMAT: weird\\n-- custom frame info --";
      try {
        const logObj = logger.info(err);
        return { threw: false, defined: logObj != null };
      } catch {
        return { threw: true, defined: false };
      }
    `,
    );
    expect(result.threw).toBe(false);
    expect(result.defined).toBe(true);
  });

  test("TypeError and RangeError preserve correct name", async ({ page }) => {
    const result = await inPage<{ typeName: unknown; rangeName: unknown }>(
      page,
      { type: "hidden" },
      `
      const logger = new tslog.Logger(settings);
      const typeErr = logger.info(new TypeError("bad type"));
      const rangeErr = logger.info(new RangeError("out of range"));
      return { typeName: typeErr.name, rangeName: rangeErr.name };
    `,
    );
    expect(result.typeName).toBe("TypeError");
    expect(result.rangeName).toBe("RangeError");
  });

  test.describe("pretty error message with non-primitive property values", () => {
    test("error property with null-prototype object does not throw", async ({ page }) => {
      const { combined, returnValue } = await captureConsole<{ threw: boolean }>(
        page,
        { type: "pretty", pretty: { style: false, passObjectsNatively: false } },
        `
        const logger = new tslog.Logger(settings);
        const err = new Error("boom");
        // Object.create(null) has no prototype, so String(value) throws
        // "Cannot convert object to primitive value".
        err.details = Object.create(null);
        try {
          logger.error(err);
          return { threw: false };
        } catch {
          return { threw: true };
        }
      `,
      );
      expect(returnValue?.threw).toBe(false);
      expect(combined).toContain("boom");
    });

    test("error property with throwing toString does not throw", async ({ page }) => {
      const { combined, returnValue } = await captureConsole<{ threw: boolean }>(
        page,
        { type: "pretty", pretty: { style: false, passObjectsNatively: false } },
        `
        const logger = new tslog.Logger(settings);
        const err = new Error("kaboom");
        err.payload = {
          toString() {
            throw new Error("toString blew up");
          },
        };
        try {
          logger.error(err);
          return { threw: false };
        } catch {
          return { threw: true };
        }
      `,
      );
      expect(returnValue?.threw).toBe(false);
      expect(combined).toContain("kaboom");
    });

    test("error property with Symbol.toPrimitive returning object does not throw", async ({ page }) => {
      const { combined, returnValue } = await captureConsole<{ threw: boolean }>(
        page,
        { type: "pretty", pretty: { style: false, passObjectsNatively: false } },
        `
        const logger = new tslog.Logger(settings);
        const err = new Error("oops");
        err.weird = {
          [Symbol.toPrimitive]() {
            return {};
          },
        };
        try {
          logger.error(err);
          return { threw: false };
        } catch {
          return { threw: true };
        }
      `,
      );
      expect(returnValue?.threw).toBe(false);
      expect(combined).toContain("oops");
    });
  });
});
