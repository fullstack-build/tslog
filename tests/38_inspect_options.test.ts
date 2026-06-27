import { formatWithOptions, inspect } from "../src/internal/util.inspect.polyfill.js";

// Regression tests for the _extend fix (PR #331): inspect options passed to inspect()
// and formatWithOptions() must actually take effect. Previously _extend mutated a throwaway
// copy of the context, so options like `depth` were silently ignored.

describe("inspect honors supplied options (_extend regression)", () => {
  const deep = { a: { b: { c: { d: 1 } } } };

  test("depth: 0 stops recursion early", () => {
    const shallow = stripAnsi(inspect(deep, { depth: 0 }));
    // At depth 0 the nested object is collapsed to the [Object] marker.
    expect(shallow).toContain("[Object]");
    expect(shallow).not.toContain("d:");
  });

  test("a larger depth renders the full nested structure", () => {
    const deeper = stripAnsi(inspect(deep, { depth: 5 }));
    expect(deeper).toContain("d:");
    expect(deeper).not.toContain("[Object]");
  });

  test("the depth option produces observably different output", () => {
    // This is the exact behavior that regressed: with the bug both calls produced
    // identical output because the option was discarded.
    const shallow = inspect(deep, { depth: 0 });
    const deeper = inspect(deep, { depth: 5 });
    expect(shallow).not.toBe(deeper);
  });

  test("colors: false disables ANSI styling", () => {
    const colored = inspect({ n: 1 }, { colors: true });
    const plain = inspect({ n: 1 }, { colors: false });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
    const ansi = /\[/;
    expect(ansi.test(colored)).toBe(true);
    expect(ansi.test(plain)).toBe(false);
  });

  test("formatWithOptions respects the depth option for inspected arguments", () => {
    const shallow = stripAnsi(formatWithOptions({ depth: 0, colors: false }, deep));
    const deeper = stripAnsi(formatWithOptions({ depth: 5, colors: false }, deep));
    expect(shallow).toContain("[Object]");
    expect(deeper).toContain("d:");
    expect(shallow).not.toBe(deeper);
  });
});

function stripAnsi(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
  return value.replace(/\[[0-9;]*m/g, "");
}
