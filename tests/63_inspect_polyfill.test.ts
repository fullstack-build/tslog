import { formatValue, formatWithOptions, inspect } from "../src/render/inspect.polyfill.js";

// Exhaustive coverage of the runtime-agnostic node:util.inspect reimplementation
// (src/render/inspect.polyfill.ts). Every test asserts the EXACT rendered string
// (ANSI stripped where noted) for an exotic value, so a regression in a specific
// branch — Getter markers, [Circular], negative-depth collapse, format specifiers,
// the URL special case, colorization — is caught by a concrete expectation rather
// than a "does not throw".
//
// This is a legacy inspect port: it does NOT special-case Map/Set/typed arrays the
// way modern node:util does. Those fall through the generic object walk, and the
// tests pin that actual behavior (e.g. a Uint8Array renders as an index-keyed object).

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
const ANSI = /\[[0-9;]*m/g;
function strip(value: string): string {
  return value.replace(ANSI, "");
}
/** inspect with colors forced off, ANSI stripped for good measure. */
function plain(value: unknown, opts: Record<string, unknown> = {}): string {
  return strip(inspect(value, { colors: false, ...opts }));
}

describe("primitives (formatPrimitive)", () => {
  test("string quoting escapes single quotes", () => {
    expect(plain("hello 'quote'")).toBe("'hello \\'quote\\''");
  });
  test("number", () => expect(plain(3.14)).toBe("3.14"));
  test("bigint gets an n suffix", () => expect(plain(99n)).toBe("99n"));
  test("boolean", () => expect(plain(false)).toBe("false"));
  test("null", () => expect(plain(null)).toBe("null"));
  test("undefined", () => expect(plain(undefined)).toBe("undefined"));
});

describe("Date", () => {
  test("valid date renders ISO", () => {
    expect(plain(new Date("2020-01-02T03:04:05.000Z"))).toBe("2020-01-02T03:04:05.000Z");
  });
  test("invalid date renders 'Invalid Date' instead of throwing", () => {
    expect(plain(new Date(Number.NaN))).toBe("Invalid Date");
  });
  test("a date carrying extra props leads with the UTC string", () => {
    const d = new Date("2020-01-02T03:04:05.000Z") as Date & { extra?: number };
    d.extra = 1;
    expect(plain(d)).toBe("{\n Thu, 02 Jan 2020 03:04:05 GMT\n  extra: 1 \n}");
  });
  test("an invalid date carrying extra props leads with 'Invalid Date'", () => {
    const d = new Date(Number.NaN) as Date & { extra?: number };
    d.extra = 1;
    expect(plain(d)).toBe("{\n Invalid Date\n  extra: 1 \n}");
  });
});

describe("RegExp", () => {
  test("plain regexp renders its literal with flags", () => {
    expect(plain(/abc/gi)).toBe("/abc/gi");
  });
  test("a regexp carrying extra props leads with the literal", () => {
    const r = /x/ as RegExp & { extra?: number };
    r.extra = 1;
    expect(plain(r)).toBe("{\n /x/\n  extra: 1 \n}");
  });
  test("a regexp with props at negative depth collapses to the literal, not [Object]", () => {
    const r = /x/ as RegExp & { extra?: number };
    r.extra = 1;
    expect(plain(r, { depth: -1 })).toBe("/x/");
  });
});

describe("Error", () => {
  test("plain error renders the bracketed toString", () => {
    expect(plain(new Error("boom"))).toBe("[Error: boom]");
  });
  test("error without a message", () => {
    expect(plain(new Error())).toBe("[Error]");
  });
  test("an error carrying an own enumerable prop leads with the error", () => {
    const e = Object.assign(new Error("boom"), { code: "E" });
    expect(plain(e)).toBe("{\n [Error: boom]\n  code: 'E' \n}");
  });
  test("an error whose 'message' is enumerable short-circuits to the bracketed toString", () => {
    // Node normally makes message non-enumerable; forcing it enumerable exercises the
    // IE-compat branch that returns formatError() as soon as message shows up in keys.
    const e = new Error("boom");
    Object.defineProperty(e, "message", { enumerable: true, value: "boom", configurable: true, writable: true });
    expect(plain(e)).toBe("[Error: boom]");
  });
});

describe("functions", () => {
  test("a named function stringifies via its source (customInspect toString path)", () => {
    // The customInspect branch returns value.toString() for a function that lacks
    // its own inspect() method — i.e. the literal source, not the [Function] marker.
    const out = plain(function foo() {});
    expect(out).toContain("function");
    expect(out).toContain("foo");
    expect(out).not.toContain("[Function");
  });
  test("with customInspect off, a named function renders the [Function: name] marker", () => {
    expect(plain(function foo() {}, { customInspect: false })).toBe("[Function: foo]");
  });
  test("with customInspect off, an anonymous function renders [Function]", () => {
    const anon = (() => () => {})();
    expect(plain(anon, { customInspect: false })).toBe("[Function]");
  });
  test("with customInspect off, a function carrying props leads with the [Function] base", () => {
    // The transpiler may rename the local binding (f -> f2), so pin the shape and
    // the fact that the [Function: <name>] base leads, then the own prop follows.
    const f = Object.assign(function f() {}, { extra: 1 });
    expect(plain(f, { customInspect: false })).toBe(`{\n [Function: ${f.name}]\n  extra: 1 \n}`);
  });
  test("with customInspect off, an anonymous function carrying props uses the nameless [Function] base", () => {
    // Force an empty .name so the `value.name ? ...` ternary takes its falsy branch.
    const f = function () {} as (() => void) & { extra?: number };
    Object.defineProperty(f, "name", { value: "" });
    f.extra = 1;
    expect(plain(f, { customInspect: false })).toBe("{\n [Function]\n  extra: 1 \n}");
  });
  test("a class stringifies via its source", () => {
    const out = plain(class Foo {});
    expect(out).toContain("class");
    expect(out).toContain("Foo");
    expect(out).not.toContain("[Function");
  });
});

describe("objects and class instances", () => {
  test("empty object", () => expect(plain({})).toBe("{\n\n}"));
  test("empty array", () => expect(plain([])).toBe("[\n\n]"));
  test("class instance renders its own fields (constructor name is not shown by this port)", () => {
    class Point {
      x = 1;
      y = 2;
    }
    expect(plain(new Point())).toBe("{\n  x: 1,\n  y: 2 \n}");
  });
  test("null-prototype object renders its own keys", () => {
    const o = Object.assign(Object.create(null), { x: 1 });
    expect(plain(o)).toBe("{\n  x: 1 \n}");
  });
  test("null-prototype object with no keys renders empty braces", () => {
    expect(plain(Object.create(null))).toBe("{\n\n}");
  });
  test("nested object property is indented onto its own line", () => {
    expect(plain({ x: { a: 1, b: 2 } })).toBe("{\n  x: \n   {\n     a: 1,\n     b: 2 \n   } \n}");
  });
});

describe("arrays", () => {
  test("sparse array shows holes as empty slots", () => {
    const a = [1];
    a[3] = 4;
    expect(plain(a)).toBe("[\n  1,\n  ,\n  ,\n  4 \n]");
  });
  test("array with extra named props appends them after the indices", () => {
    const a = Object.assign([1, 2], { foo: "bar" });
    expect(plain(a)).toBe("[\n  1,\n  2,\n  foo: 'bar' \n]");
  });
  test("nested object inside an array is indented", () => {
    expect(plain([{ a: 1, b: 2 }])).toBe("[\n  {\n    a: 1,\n    b: 2 \n  } \n]");
  });
});

describe("keys with special characters", () => {
  test("identifier keys are unquoted", () => {
    expect(plain({ abc: 1 })).toBe("{\n  abc: 1 \n}");
  });
  test("non-identifier keys are single-quoted", () => {
    expect(plain({ "a-b": 1, "0x": 2 })).toBe("{\n  'a-b': 1,\n  '0x': 2 \n}");
  });
  test("purely numeric string keys are quoted", () => {
    expect(plain({ "123": 1 })).toBe("{\n  '123': 1 \n}");
  });
  test("keys containing a quote are escaped", () => {
    expect(plain({ "it's": 1 })).toBe("{\n  'it\\'s': 1 \n}");
  });
});

describe("getters and setters (property descriptors)", () => {
  test("a getter renders [Getter]", () => {
    expect(
      plain({
        get g() {
          return 42;
        },
      }),
    ).toBe("{\n  g: [Getter] \n}");
  });
  test("a getter/setter pair renders [Getter/Setter]", () => {
    const o = {};
    Object.defineProperty(o, "gs", { enumerable: true, get: () => 1, set: () => {} });
    expect(plain(o)).toBe("{\n  gs: [Getter/Setter] \n}");
  });
  test("a setter-only property (revealed via showHidden) renders [Setter]", () => {
    const o = {};
    Object.defineProperty(o, "so", { enumerable: true, set: () => {} });
    expect(plain(o, { showHidden: true })).toBe("{\n  so: [Setter] \n}");
  });
  test("a throwing getter is NOT invoked — it still renders [Getter]", () => {
    const o = {};
    Object.defineProperty(o, "bad", {
      enumerable: true,
      get() {
        throw new Error("must not be called");
      },
    });
    expect(plain(o)).toBe("{\n  bad: [Getter] \n}");
  });
});

describe("showHidden reveals non-enumerable keys", () => {
  test("a non-enumerable key is shown bracketed under showHidden", () => {
    const o = {};
    Object.defineProperty(o, "hid", { enumerable: false, value: 7 });
    expect(plain(o, { showHidden: true })).toBe("{\n  [hid]: 7 \n}");
  });
  test("without showHidden the non-enumerable key is invisible", () => {
    const o = {};
    Object.defineProperty(o, "hid", { enumerable: false, value: 7 });
    expect(plain(o)).toBe("{\n\n}");
  });
});

describe("circular references", () => {
  test("self-referential object marks the cycle [Circular]", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(plain(o)).toBe("{\n  self: [Circular] \n}");
  });
  test("self-referential array marks the cycle [Circular]", () => {
    const a: unknown[] = [];
    a.push(a);
    expect(plain(a)).toBe("[\n  [Circular] \n]");
  });
});

describe("depth boundary", () => {
  test("depth 0 collapses the first nested object to [Object]", () => {
    expect(plain({ a: { b: 1 } }, { depth: 0 })).toBe("{\n  a: [Object] \n}");
  });
  test("depth 1 expands one level then collapses", () => {
    expect(plain({ a: { b: { c: 1 } } }, { depth: 1 })).toBe("{\n  a: \n   {\n     b: [Object] \n   } \n}");
  });
  test("negative depth on a bare object yields [Object]", () => {
    expect(plain({ a: 1 }, { depth: -1 })).toBe("[Object]");
  });
});

describe("exotic built-ins fall through the generic walk (legacy port has no special-casing)", () => {
  test("Map renders as empty braces (no entries are own-enumerable)", () => {
    expect(plain(new Map([["a", 1]]))).toBe("{\n\n}");
  });
  test("Set renders as empty braces", () => {
    expect(plain(new Set([1, 2]))).toBe("{\n\n}");
  });
  test("WeakMap renders as empty braces", () => {
    expect(plain(new WeakMap())).toBe("{\n\n}");
  });
  test("WeakSet renders as empty braces", () => {
    expect(plain(new WeakSet())).toBe("{\n\n}");
  });
  test("Uint8Array renders as an index-keyed object", () => {
    expect(plain(new Uint8Array([1, 2, 3]))).toBe("{\n  '0': 1,\n  '1': 2,\n  '2': 3 \n}");
  });
  test("ArrayBuffer renders as empty braces", () => {
    expect(plain(new ArrayBuffer(4))).toBe("{\n\n}");
  });
  test("DataView renders as empty braces", () => {
    expect(plain(new DataView(new ArrayBuffer(4)))).toBe("{\n\n}");
  });
  test("Promise renders as empty braces", () => {
    expect(plain(Promise.resolve(1))).toBe("{\n\n}");
  });
  test("boxed Number renders as empty braces", () => {
    expect(plain(new Number(5))).toBe("{\n\n}");
  });
  test("boxed Boolean renders as empty braces", () => {
    expect(plain(new Boolean(true))).toBe("{\n\n}");
  });
  test("boxed String exposes its characters as indexed keys", () => {
    expect(plain(new String("hi"))).toBe("{\n  '0': 'h',\n  '1': 'i' \n}");
  });
});

describe("URL special case", () => {
  test("a URL renders as URL { href } rather than empty braces", () => {
    expect(plain(new URL("https://example.com/p?q=1"))).toBe("URL { 'https://example.com/p?q=1' }");
  });
});

describe("customInspect hooks", () => {
  test("an object exposing a non-function inspect member is walked normally (not invoked)", () => {
    // The value under test is an object, not a function, so the customInspect
    // branch (which only fires for functions) does not apply — it is walked.
    const out = plain({ inspect: 123 });
    expect(out).toBe("{\n  inspect: 123 \n}");
  });
  test("a function whose inspect() returns a string uses that string directly", () => {
    const fn = Object.assign(function () {}, { inspect: () => "CUSTOM_STR" });
    expect(plain(fn)).toBe("CUSTOM_STR");
  });
  test("a function whose inspect() returns a non-string is re-formatted", () => {
    // ret is not a string, so formatValue recurses on the returned object.
    const fn = Object.assign(function () {}, { inspect: () => ({ x: 1 }) });
    expect(plain(fn)).toBe("{\n  x: 1 \n}");
  });
});

describe("colorization (colors: true)", () => {
  const withColor = (v: unknown, opts: Record<string, unknown> = {}) => inspect(v, { colors: true, ...opts });

  test("numbers are wrapped in the yellow (33) ANSI pair", () => {
    expect(withColor(42)).toBe("[33m42[39m");
  });
  test("strings are wrapped in the green (32) ANSI pair", () => {
    expect(withColor("hi")).toBe("[32m'hi'[39m");
  });
  test("booleans are wrapped in the yellow (33) ANSI pair", () => {
    expect(withColor(true)).toBe("[33mtrue[39m");
  });
  test("null is wrapped in the bold (1/22) ANSI pair", () => {
    expect(withColor(null)).toBe("[1mnull[22m");
  });
  test("[Getter] special markers are wrapped in the cyan (36) ANSI pair", () => {
    expect(
      withColor({
        get g() {
          return 1;
        },
      }),
    ).toBe("{\n  g: [36m[Getter][39m \n}");
  });
  test("a regexp is wrapped in the red (31) ANSI pair", () => {
    expect(withColor(/x/)).toBe("[31m/x/[39m");
  });
  test("a date is wrapped in the magenta (35) ANSI pair", () => {
    expect(withColor(new Date("2020-01-02T03:04:05.000Z"))).toBe("[35m2020-01-02T03:04:05.000Z[39m");
  });
  test("undefined has no color pair configured, so it stays unstyled", () => {
    // inspect.styles.undefined maps to "grey", which is absent from inspect.colors,
    // exercising the stylizeWithColor fallback that returns the string unchanged.
    expect(withColor(undefined)).toBe("undefined");
  });
  test("object keys use the un-styled 'name' style (values are colored, keys are not)", () => {
    expect(withColor({ abc: 1 })).toBe("{\n  abc: [33m1[39m \n}");
  });
});

describe("formatValue called directly", () => {
  const ctx = () => ({ seen: [] as unknown[], stylize: (s: string) => s, colors: false, depth: 2, showHidden: false, customInspect: true });

  test("primitive short-circuits", () => {
    expect(formatValue(ctx(), 42, 2)).toBe("42");
  });
  test("null", () => {
    expect(formatValue(ctx(), null, 2)).toBe("null");
  });
  test("a null recurseTimes still walks (isNull(recurseTimes) branch)", () => {
    // Passing recurseTimes === null triggers the isNull(recurseTimes) branch in
    // formatProperty, which recurses with `undefined` rather than recurseTimes-1.
    expect(strip(formatValue(ctx(), { a: { b: { c: 1 } } }, null as unknown as number))).toBe("{\n  a: \n   {\n     b: [Object] \n   } \n}");
  });
  test("when stylize is not a function and customInspect is off, a keyless function returns the raw value", () => {
    // Hits the `else { return value; }` fallback: keys.length === 0, ctx.stylize
    // is not callable, so the function value itself is returned unchanged.
    const fn = function foo() {};
    const result = formatValue({ seen: [], stylize: null as unknown as ICtxStylize, colors: false, depth: 2, showHidden: false, customInspect: false }, fn, 2);
    expect(result).toBe(fn);
  });
});

// The stylize type used only by the direct-call test above.
type ICtxStylize = (str: string, styleType: string) => string;

describe("formatWithOptions - single string fast path", () => {
  test("a lone string is returned verbatim", () => {
    expect(formatWithOptions({ colors: false }, "hello")).toBe("hello");
  });
  test("a format string with no further args is returned verbatim (specifiers untouched)", () => {
    expect(formatWithOptions({ colors: false }, "no arg %s")).toBe("no arg %s");
  });
  test("literal %% with no args is left untouched by the fast path", () => {
    expect(formatWithOptions({ colors: false }, "100%% done")).toBe("100%% done");
  });
  test("null inspectOptions still returns the lone string", () => {
    expect(formatWithOptions(null as unknown as Record<string, never>, "hello")).toBe("hello");
  });
});

describe("formatWithOptions - format specifiers", () => {
  const fmt = (f: string, ...args: unknown[]) => strip(formatWithOptions({ colors: false }, f, ...args));

  test("%s with a string", () => expect(fmt("a %s b", "X")).toBe("a X b"));
  test("%s with a number formats via formatPrimitive", () => expect(fmt("a %s b", 5)).toBe("a 5 b"));
  test("%s with a bigint keeps the n suffix", () => expect(fmt("a %s b", 5n)).toBe("a 5n b"));
  test("%s with null uses String()", () => expect(fmt("a %s b", null)).toBe("a null b"));
  test("%s with an object inspects it at depth 0", () => expect(fmt("a %s b", { k: 1 })).toBe("a {\n  k: 1 \n} b"));
  test("%j serializes JSON", () => expect(fmt("j %j", { k: 1 })).toBe('j {"k":1}'));
  test("%d with a number", () => expect(fmt("d %d", 7)).toBe("d 7"));
  test("%d with a bigint", () => expect(fmt("d %d", 7n)).toBe("d 7n"));
  test("%d with a symbol yields NaN", () => expect(fmt("d %d", Symbol("s"))).toBe("d NaN"));
  test("%i parses an integer, dropping the fraction", () => expect(fmt("i %i", 9.7)).toBe("i 9"));
  test("%i parses its own arg even after a preceding specifier", () => expect(fmt("%s %i", "8", 9.7)).toBe("8 9"));
  test("%i with a numeric-prefix string parses the leading digits", () => expect(fmt("i %i", "42px")).toBe("i 42"));
  test("%i with a bigint keeps the bigint", () => expect(fmt("i %i", 9n)).toBe("i 9n"));
  test("%i with a symbol yields NaN", () => expect(fmt("i %i", Symbol("s"))).toBe("i NaN"));
  test("%f keeps the fraction", () => expect(fmt("f %f", 9.7)).toBe("f 9.7"));
  test("%f with a symbol yields NaN", () => expect(fmt("f %f", Symbol("s"))).toBe("f NaN"));
  test("%O inspects deeply", () => expect(fmt("O %O", { k: { deep: 1 } })).toBe("O {\n  k: \n   {\n     deep: 1 \n   } \n}"));
  test("%o inspects (showHidden + depth 4)", () => expect(fmt("o %o", { k: 1 })).toBe("o {\n  k: 1 \n}"));
  test("%c consumes the arg and emits nothing", () => expect(fmt("c %c css", "color:red")).toBe("c  css"));
  test("an unrecognized specifier is left in place and the arg is appended", () => {
    expect(fmt("q %q x", "Y")).toBe("q %q x Y");
  });
  test("trailing extra args are appended, non-strings inspected", () => {
    expect(fmt("just", "extra", { o: 1 })).toBe("just extra {\n  o: 1 \n}");
  });
  test("a non-string first arg is inspected and following args appended", () => {
    expect(fmt("%s", { o: 1 })).toBe("{\n  o: 1 \n}");
  });
  test("a specifier followed by literal text keeps the tail", () => {
    expect(fmt("x %s", "A")).toBe("x A");
  });
  test("literal %% inside a string collapses to one % once there is another arg to consume", () => {
    // With an extra arg the fast-path early-return is skipped, so the %% branch in
    // the main loop runs and folds "%%" down to a single "%".
    expect(fmt("50%% done %s", "X")).toBe("50% done X");
  });
  test("%% collapses even when the only arg is appended at the tail", () => {
    expect(fmt("50%% done", "X")).toBe("50% done X");
  });
  test("%% AFTER the last consumed arg still folds to a single %", () => {
    // Here %s consumes the sole arg first; the trailing %% is reached with no args
    // left, exercising the `else if (nextChar === 37)` no-more-args %% branch.
    expect(fmt("%s then 100%%", "X")).toBe("X then 100%");
  });
  test("%% between the last arg and trailing text folds and keeps the tail", () => {
    expect(fmt("%s a %% b", "X")).toBe("X a % b");
  });
});

describe("formatWithOptions / inspect - non-object options are ignored (_extend guard)", () => {
  test("inspect with a primitive options value falls back to defaults", () => {
    // _extend early-returns when `add` isn't an object, so bogus options are a no-op.
    expect(strip(inspect({ a: 1 }, 5 as unknown as Record<string, never>))).toBe("{\n  a: 1 \n}");
  });
});

describe("formatWithOptions - depth honored for inspected args", () => {
  const deep = { a: { b: { c: { d: 1 } } } };
  test("depth 0 collapses, a larger depth expands", () => {
    const shallow = strip(formatWithOptions({ depth: 0, colors: false }, deep));
    const deeper = strip(formatWithOptions({ depth: 5, colors: false }, deep));
    expect(shallow).toContain("[Object]");
    expect(deeper).toContain("d:");
    expect(shallow).not.toBe(deeper);
  });
});
