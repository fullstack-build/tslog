import { expect, test } from "@playwright/test";
import { inPage } from "./support/browser/browserHarness.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
});

/**
 * The Node suite asserts `logMsg["1"].circular` deep-equals `logMsg["1"]` (a
 * self-reference) via `toEqual`. tslog clones and masks log arguments, and when
 * it re-encounters a circular reference it returns a one-level shallow copy, so
 * the inner `circular` is structurally identical to its parent but is a distinct
 * object (not `===`). We reproduce the deep-equality intent inside the page by
 * checking the inner node carries the same keys and `abc` value as the parent.
 */
const selfReferenceBody = (type: string) => `
  const mainLogger = new tslog.Logger(${type});
  function Foo() {
    this.abc = "Hello";
    this.circular = this;
  }
  const foo = new Foo();
  try {
    const logMsg = mainLogger.info("circular", foo);
    const one = logMsg["1"];
    const inner = one.circular;
    const selfRef =
      inner != null &&
      typeof inner === "object" &&
      inner.abc === one.abc &&
      JSON.stringify(Object.keys(inner)) === JSON.stringify(Object.keys(one));
    return { threw: false, msg0: logMsg["0"], selfRef };
  } catch {
    return { threw: true, msg0: null, selfRef: false };
  }
`;

test.describe("Recursive (browser)", () => {
  test("hidden", async ({ page }) => {
    const result = await inPage<{ threw: boolean; msg0: unknown; selfRef: boolean }>(page, {}, selfReferenceBody(`{ type: "hidden" }`));
    expect(result.threw).toBe(false);
    expect(result.msg0).toBe("circular");
    expect(result.selfRef).toBe(true);
  });

  test("json", async ({ page }) => {
    const result = await inPage<{ threw: boolean; msg0: unknown; selfRef: boolean }>(page, {}, selfReferenceBody(`{ type: "json" }`));
    expect(result.threw).toBe(false);
    expect(result.msg0).toBe("circular");
    expect(result.selfRef).toBe(true);
  });

  test("pretty", async ({ page }) => {
    const result = await inPage<{ threw: boolean; msg0: unknown; selfRef: boolean }>(page, {}, selfReferenceBody(`{ type: "pretty" }`));
    expect(result.threw).toBe(false);
    expect(result.msg0).toBe("circular");
    expect(result.selfRef).toBe(true);
  });

  test("pretty recursive LogObj function", async ({ page }) => {
    const result = await inPage<{ threw: boolean; msg0: unknown }>(
      page,
      {},
      `
      function Foo() {
        this.abc = "Hello";
        this.circular = this;
      }
      const foo = new Foo();
      const mainLogger = new tslog.Logger({ type: "pretty" }, foo);
      try {
        const logMsg = mainLogger.info("circular");
        return { threw: false, msg0: logMsg["0"] };
      } catch {
        return { threw: true, msg0: null };
      }
    `,
    );
    expect(result.threw).toBe(false);
    expect(result.msg0).toBe("circular");
  });
});
