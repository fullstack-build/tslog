import { createBrowserEnvironment } from "../src/env/environment.browser.js";
import { Logger } from "../src/index.js";
import type { ISettings } from "../src/interfaces.js";

describe("Browser CSS styling", () => {
  const globalAny = globalThis as Record<string, unknown>;
  let saved: Record<string, unknown>;

  beforeEach(() => {
    // navigator is a getter-only property in Node — never write it directly.
    // Stub it with vi.stubGlobal and let vi.unstubAllGlobals restore it.
    saved = {
      window: globalAny.window,
      document: globalAny.document,
      location: globalAny.location,
      Deno: globalAny.Deno,
      Bun: globalAny.Bun,
      importScripts: globalAny.importScripts,
      process: globalAny.process,
      CSS: globalAny.CSS,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete globalAny[key];
      } else {
        globalAny[key] = value;
      }
    }
  });

  // Turn the current global scope into a CSS-capable browser (Chrome-like).
  function makeCssBrowser(): void {
    globalAny.window = {};
    globalAny.document = {};
    delete globalAny.Deno;
    delete globalAny.Bun;
    delete globalAny.importScripts;
    globalAny.CSS = { supports: () => true };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Chrome/120.0" });
  }

  // Browser stack parsing contracts (frame fields, origin prefixing, malformed/empty lines) live in
  // tests/68 — both the parser directly (parseBrowserStackLine) and through the provider methods,
  // which are the shared providerBase implementations.

  // Build settings from a real pretty Logger and tweak pretty template/styles per test.
  // M3a: the formerly-flat prettyLogTemplate/prettyLogStyles keys now live under the
  // grouped `pretty` path, so overrides are merged into settings.pretty.
  function prettySettings(prettyOverrides: Partial<ISettings<unknown>["pretty"]> = {}): ISettings<unknown> {
    const settings = new Logger({ type: "pretty" }).settings as ISettings<unknown>;
    // These suites assert rendered-string/CSS-markup mechanics, so the browser default of
    // passObjectsNatively is pinned off (native-arg behavior has its own tests).
    return {
      ...settings,
      pretty: { ...settings.pretty, style: true, passObjectsNatively: false, ...prettyOverrides },
    };
  }

  describe("CSS styling path in transportFormatted", () => {
    test("emits %c markers and css style arguments for a styled placeholder", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({
        template: "{{logLevelName}}",
        styles: { logLevelName: "blue" },
      });
      const meta = env.getMeta(3, "INFO", Number.NaN, false);

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("", ["hello"], [], meta, settings);

      expect(spy).toHaveBeenCalledTimes(1);
      const call = spy.mock.calls[0] as unknown[];
      const text = call[0] as string;
      const styleArgs = call.slice(1) as string[];

      expect(text).toContain("%c");
      expect(text).toContain("INFO");
      // the args are appended after the meta markup
      expect(text).toContain("hello");
      // blue resolves to a color css value passed as a separate console arg
      expect(styleArgs).toContain("color: #42a5f5");
      spy.mockRestore();
    });
  });

  describe("buildCssMetaOutput behaviors", () => {
    test("placeholder with no matching style produces no css; falls back to sanitized meta markup", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({
        template: "{{logLevelName}}",
        // empty styles -> no css for any placeholder
        styles: {},
      });
      const meta = env.getMeta(3, "INFO", Number.NaN, false);

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      // With no css produced, transportFormatted falls back to the passed-in (sanitized) meta markup.
      env.transportFormatted("META-MARKUP", ["body"], [], meta, settings);

      const call = spy.mock.calls[0] as unknown[];
      const text = call[0] as string;
      // no css -> console.log called with only the text argument (no extra style args)
      expect(call.length).toBe(1);
      expect(text).not.toContain("%c");
      expect(text).toContain("META-MARKUP");
      expect(text).toContain("body");
      spy.mockRestore();
    });

    test("preserves trailing template text after the last placeholder", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({
        template: "{{logLevelName}} >> trailing-text",
        styles: { logLevelName: "blue" },
      });
      const meta = env.getMeta(3, "INFO", Number.NaN, false);

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("", [], [], meta, settings);

      const text = spy.mock.calls[0]?.[0] as string;
      expect(text).toContain(">> trailing-text");
      spy.mockRestore();
    });

    test("undefined meta produces no meta markup but still logs the args", () => {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings();

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted("", ["just-args"], [], undefined, settings);

      expect(spy).toHaveBeenCalledTimes(1);
      const call = spy.mock.calls[0] as unknown[];
      const text = call[0] as string;
      // no meta -> no css styles, single argument
      expect(call.length).toBe(1);
      expect(text).not.toContain("%c");
      expect(text).toContain("just-args");
      spy.mockRestore();
    });
  });

  describe("styleTokenToCss token resolution", () => {
    // A sentinel meta markup. transportFormatted only falls back to this value
    // when no css styles are produced (hasCssMeta === false); when css IS produced,
    // the rendered cssMeta.text (containing the placeholder value) is used instead.
    const FALLBACK_MARKUP = "FALLBACK";

    // Capture the text and css style arguments for a given style + template + level.
    function renderStyle(
      style: unknown,
      level: { id: number; name: string } = { id: 3, name: "INFO" },
      template = "{{logLevelName}}",
    ): { text: string; styleArgs: string[] } {
      makeCssBrowser();
      const env = createBrowserEnvironment();
      const settings = prettySettings({
        template,
        styles: { logLevelName: style } as ISettings<unknown>["pretty"]["styles"],
      });
      const meta = env.getMeta(level.id, level.name, Number.NaN, false);

      const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
      env.transportFormatted(FALLBACK_MARKUP, [], [], meta, settings);
      const call = spy.mock.calls[0] as unknown[];
      spy.mockRestore();

      return {
        text: call[0] as string,
        styleArgs: call.slice(1).filter((arg) => typeof arg === "string" && arg.length > 0) as string[],
      };
    }

    test("color token red maps to its hex color", () => {
      expect(renderStyle("red").styleArgs).toContain("color: #ef5350");
    });

    test("bright background token maps to background-color", () => {
      expect(renderStyle("bgRedBright").styleArgs).toContain("background-color: #ff7043");
    });

    test("bold maps to font-weight", () => {
      expect(renderStyle("bold").styleArgs).toContain("font-weight: bold");
    });

    test("dim maps to opacity", () => {
      expect(renderStyle("dim").styleArgs).toContain("opacity: 0.75");
    });

    test("italic maps to font-style", () => {
      expect(renderStyle("italic").styleArgs).toContain("font-style: italic");
    });

    test("underline maps to text-decoration underline", () => {
      expect(renderStyle("underline").styleArgs).toContain("text-decoration: underline");
    });

    test("overline maps to text-decoration overline", () => {
      expect(renderStyle("overline").styleArgs).toContain("text-decoration: overline");
    });

    test("inverse maps to invert filter", () => {
      expect(renderStyle("inverse").styleArgs).toContain("filter: invert(1)");
    });

    test("hidden maps to visibility hidden", () => {
      expect(renderStyle("hidden").styleArgs).toContain("visibility: hidden");
    });

    test("strikethrough maps to text-decoration line-through", () => {
      expect(renderStyle("strikethrough").styleArgs).toContain("text-decoration: line-through");
    });

    test("object style with no matching value and no '*' produces no css and falls back to plain markup", () => {
      // value "INFO" matches neither "NOPE" nor a "*" fallback -> collectStyleTokens returns [],
      // so no css is produced and transportFormatted falls back to the plain meta markup.
      const { text, styleArgs } = renderStyle({ NOPE: "blue" });
      expect(styleArgs.length).toBe(0);
      expect(text).not.toContain("%c");
      expect(text).toBe(FALLBACK_MARKUP);
    });

    describe("object style form (level map with '*' fallback)", () => {
      test("matching level uses its specific css", () => {
        const { text, styleArgs } = renderStyle({ INFO: "blue", "*": ["bold", "white"] });
        // the specific INFO entry wins -> only the blue color css, '*' fallback not applied
        expect(styleArgs).toEqual(["color: #42a5f5"]);
        expect(text).toBe("%cINFO%c");
      });

      test("non-matching level falls back to '*' (tokens joined into one css string)", () => {
        const { text, styleArgs } = renderStyle({ INFO: "blue", "*": ["bold", "white"] }, { id: 4, name: "WARN" });
        // multiple tokens for one placeholder are joined with "; " into a single css argument
        expect(styleArgs).toEqual(["font-weight: bold; color: #fafafa"]);
        expect(text).toBe("%cWARN%c");
      });

      test("null entry for the matching level yields no css and falls back to plain markup", () => {
        const { text, styleArgs } = renderStyle({ SILLY: null }, { id: 0, name: "SILLY" });
        expect(styleArgs.length).toBe(0);
        expect(text).not.toContain("%c");
        expect(text).toBe(FALLBACK_MARKUP);
      });
    });

    test("array and nested-array tokens are all collected into one joined css string", () => {
      const { text, styleArgs } = renderStyle(["bold", ["red"]]);
      expect(styleArgs).toEqual(["font-weight: bold; color: #ef5350"]);
      expect(text).toBe("%cINFO%c");
    });

    test("duplicate style tokens are deduped into a single css declaration", () => {
      // tokensToCss tracks seen declarations: the repeated "red" token yields ONE css entry.
      const { text, styleArgs } = renderStyle(["red", "red"]);
      expect(styleArgs).toEqual(["color: #ef5350"]);
      expect(text).toBe("%cINFO%c");
    });

    test("a token without a CSS equivalent (reset) contributes nothing to the css string", () => {
      // styleTokenToCss has no mapping for "reset" -> the token is skipped; only the color survives.
      const { text, styleArgs } = renderStyle(["reset", "red"]);
      expect(styleArgs).toEqual(["color: #ef5350"]);
      expect(text).toBe("%cINFO%c");
    });
  });
});
