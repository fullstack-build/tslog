/**
 * The single style palette for tslog.
 *
 * This is the ONE place that knows how a named style token (e.g. "red", "bold", "bgWhiteBright")
 * maps to both an ANSI escape pair (for terminals / colorized text output) and a CSS declaration
 * (for the browser `%c` console-styling path).
 *
 * Historically this knowledge was split across two files:
 *  - `src/prettyLogStyles.ts` held the ANSI `[open, close]` pairs.
 *  - `src/BaseLogger.ts` embedded the CSS hex maps (`COLOR_TOKENS`/`BACKGROUND_TOKENS`) plus a
 *    `styleTokenToCss` switch for the text modifiers.
 *
 * Both are merged here into a single token table. ANSI behavior is byte-for-byte identical to the
 * old `prettyLogStyles` map (tests 9_pretty_Styles), and CSS output is identical to the old
 * `styleTokenToCss` (tests 32_browser_css_styling).
 */

/** An ANSI SGR pair: `[openCode, closeCode]`, e.g. `[31, 39]` for red. */
export type TAnsiPair = [number, number];

/** A single style token's renderings. `css` is omitted for tokens that have no CSS equivalent (e.g. `reset`). */
export interface IStyleDefinition {
  ansi: TAnsiPair;
  css?: string;
}

const COLOR_HEX = {
  black: "#000000",
  red: "#ef5350",
  green: "#66bb6a",
  yellow: "#fdd835",
  blue: "#42a5f5",
  magenta: "#ab47bc",
  cyan: "#26c6da",
  white: "#fafafa",
  blackBright: "#424242",
  redBright: "#ff7043",
  greenBright: "#81c784",
  yellowBright: "#ffe082",
  blueBright: "#64b5f6",
  magentaBright: "#ce93d8",
  cyanBright: "#4dd0e1",
  whiteBright: "#ffffff",
} as const;

/**
 * The authoritative token -> { ansi, css } table.
 *
 * Ordering and values mirror the legacy sources exactly:
 *  - modifiers and (background) colors keep the same ANSI codes as `prettyLogStyles`.
 *  - color/background CSS values reuse the same hex palette as the old `COLOR_TOKENS`/`BACKGROUND_TOKENS`.
 *  - text-modifier CSS strings match the old `styleTokenToCss` switch verbatim.
 */
export const STYLE_PALETTE: Record<string, IStyleDefinition> = {
  // modifier
  // (reset has no CSS counterpart — the browser path never emits it.)
  reset: { ansi: [0, 0] },
  // 21 isn't widely supported and 22 does the same thing
  bold: { ansi: [1, 22], css: "font-weight: bold" },
  dim: { ansi: [2, 22], css: "opacity: 0.75" },
  italic: { ansi: [3, 23], css: "font-style: italic" },
  underline: { ansi: [4, 24], css: "text-decoration: underline" },
  overline: { ansi: [53, 55], css: "text-decoration: overline" },
  inverse: { ansi: [7, 27], css: "filter: invert(1)" },
  hidden: { ansi: [8, 28], css: "visibility: hidden" },
  strikethrough: { ansi: [9, 29], css: "text-decoration: line-through" },

  // color
  black: { ansi: [30, 39], css: `color: ${COLOR_HEX.black}` },
  red: { ansi: [31, 39], css: `color: ${COLOR_HEX.red}` },
  green: { ansi: [32, 39], css: `color: ${COLOR_HEX.green}` },
  yellow: { ansi: [33, 39], css: `color: ${COLOR_HEX.yellow}` },
  blue: { ansi: [34, 39], css: `color: ${COLOR_HEX.blue}` },
  magenta: { ansi: [35, 39], css: `color: ${COLOR_HEX.magenta}` },
  cyan: { ansi: [36, 39], css: `color: ${COLOR_HEX.cyan}` },
  white: { ansi: [37, 39], css: `color: ${COLOR_HEX.white}` },

  // Bright color
  blackBright: { ansi: [90, 39], css: `color: ${COLOR_HEX.blackBright}` },
  redBright: { ansi: [91, 39], css: `color: ${COLOR_HEX.redBright}` },
  greenBright: { ansi: [92, 39], css: `color: ${COLOR_HEX.greenBright}` },
  yellowBright: { ansi: [93, 39], css: `color: ${COLOR_HEX.yellowBright}` },
  blueBright: { ansi: [94, 39], css: `color: ${COLOR_HEX.blueBright}` },
  magentaBright: { ansi: [95, 39], css: `color: ${COLOR_HEX.magentaBright}` },
  cyanBright: { ansi: [96, 39], css: `color: ${COLOR_HEX.cyanBright}` },
  whiteBright: { ansi: [97, 39], css: `color: ${COLOR_HEX.whiteBright}` },

  // background color
  bgBlack: { ansi: [40, 49], css: `background-color: ${COLOR_HEX.black}` },
  bgRed: { ansi: [41, 49], css: `background-color: ${COLOR_HEX.red}` },
  bgGreen: { ansi: [42, 49], css: `background-color: ${COLOR_HEX.green}` },
  bgYellow: { ansi: [43, 49], css: `background-color: ${COLOR_HEX.yellow}` },
  bgBlue: { ansi: [44, 49], css: `background-color: ${COLOR_HEX.blue}` },
  bgMagenta: { ansi: [45, 49], css: `background-color: ${COLOR_HEX.magenta}` },
  bgCyan: { ansi: [46, 49], css: `background-color: ${COLOR_HEX.cyan}` },
  bgWhite: { ansi: [47, 49], css: `background-color: ${COLOR_HEX.white}` },

  // Bright background color
  bgBlackBright: { ansi: [100, 49], css: `background-color: ${COLOR_HEX.blackBright}` },
  bgRedBright: { ansi: [101, 49], css: `background-color: ${COLOR_HEX.redBright}` },
  bgGreenBright: { ansi: [102, 49], css: `background-color: ${COLOR_HEX.greenBright}` },
  bgYellowBright: { ansi: [103, 49], css: `background-color: ${COLOR_HEX.yellowBright}` },
  bgBlueBright: { ansi: [104, 49], css: `background-color: ${COLOR_HEX.blueBright}` },
  bgMagentaBright: { ansi: [105, 49], css: `background-color: ${COLOR_HEX.magentaBright}` },
  bgCyanBright: { ansi: [106, 49], css: `background-color: ${COLOR_HEX.cyanBright}` },
  bgWhiteBright: { ansi: [107, 49], css: `background-color: ${COLOR_HEX.whiteBright}` },
};

/**
 * Returns the ANSI `[open, close]` pair for a style token, or `undefined` for an unknown token.
 *
 * Note: the legacy ANSI rendering path (`formatTemplate` / inspect polyfill) reads pairs directly
 * off the {@link prettyLogStyles} map and silently ignores unknown tokens; this helper mirrors that
 * by returning `undefined` rather than throwing.
 */
export function styleTokenToAnsi(token: string): TAnsiPair | undefined {
  return STYLE_PALETTE[token]?.ansi;
}

/**
 * Returns the CSS declaration for a style token (e.g. `"color: #ef5350"`, `"font-weight: bold"`),
 * or `undefined` if the token has no CSS mapping. Identical to the old `BaseLogger.styleTokenToCss`.
 */
export function styleTokenToCss(token: string): string | undefined {
  return STYLE_PALETTE[token]?.css;
}

/**
 * Backwards-compatible ANSI palette consumed by `formatTemplate.ts` and the inspect polyfill.
 *
 * Shape: `{ [token: string]: [open, close] }`. This is a drop-in replacement for the previous
 * `src/prettyLogStyles.ts` export — including the `reset` entry (`[0, 0]`) those modules rely on.
 */
export const prettyLogStyles: { [name: string]: TAnsiPair } = Object.fromEntries(
  Object.entries(STYLE_PALETTE).map(([token, definition]) => [token, definition.ansi]),
);

/** Reverse lookup for {@link ansiToCssConsoleFormat}: SGR open code -> its CSS declaration + close code. */
const ANSI_OPEN_TO_CSS: Map<number, { css: string; close: number }> = new Map(
  Object.values(STYLE_PALETTE)
    .filter((definition): definition is Required<IStyleDefinition> => definition.css != null && definition.ansi[0] !== definition.ansi[1])
    .map((definition) => [definition.ansi[0], { css: definition.css, close: definition.ansi[1] }]),
);

/**
 * Convert an ANSI-styled string (as produced by `formatTemplate` from this palette) into a browser
 * console format string with `%c` CSS segments.
 *
 * The browser `%c` path renders meta from its template directly, but pre-rendered blocks (the error
 * template output) arrive already carrying ANSI escapes — which only Chromium's console interprets;
 * Firefox and WebKit print them literally. This re-expresses those escapes as `%c` CSS, which all
 * engines support. Only single-parameter SGR sequences are handled — the only form this palette emits.
 *
 * Literal `%` in the text is escaped as `%%` so user content can never consume a `%c` style argument.
 */
export function ansiToCssConsoleFormat(input: string): { text: string; styles: string[] } {
  const parts: string[] = [];
  const styles: string[] = [];
  // Active styles keyed by open code; insertion order mirrors ANSI nesting so later declarations win in CSS too.
  const active = new Map<number, { css: string; close: number }>();
  let currentCss = "";
  let pendingText = "";

  const flush = () => {
    if (pendingText.length === 0) {
      return;
    }
    const escaped = pendingText.replace(/%/g, "%%");
    if (currentCss.length > 0) {
      parts.push(`%c${escaped}%c`);
      styles.push(currentCss, "");
    } else {
      parts.push(escaped);
    }
    pendingText = "";
  };

  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape codes
  const sgrRegex = /\u001b\[(\d+)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = sgrRegex.exec(input)) != null) {
    pendingText += input.slice(lastIndex, match.index);
    lastIndex = sgrRegex.lastIndex;

    const code = Number(match[1]);
    const open = ANSI_OPEN_TO_CSS.get(code);
    if (open != null) {
      active.set(code, open);
    } else if (code === 0) {
      active.clear();
    } else {
      // A close code deactivates every style it closes (e.g. 39 clears any foreground color, 22 both bold and dim).
      for (const [openCode, entry] of active) {
        if (entry.close === code) {
          active.delete(openCode);
        }
      }
    }

    const nextCss = [...new Set([...active.values()].map((entry) => entry.css))].join("; ");
    if (nextCss !== currentCss) {
      flush();
      currentCss = nextCss;
    }
  }
  pendingText += input.slice(lastIndex);
  flush();

  return { text: parts.join(""), styles };
}
