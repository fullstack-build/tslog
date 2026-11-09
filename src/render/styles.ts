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
  // Foreground white/whiteBright get NO css: in a terminal they mean "default text on a dark
  // background", but a browser console's theme is unknown — forcing the near-white hex renders
  // invisible text on light devtools themes (Safari/Chrome default). Omitting the declaration keeps
  // the console's own default text color, which is correct in both themes. Backgrounds keep the hex.
  white: { ansi: [37, 39] },

  // Bright color
  blackBright: { ansi: [90, 39], css: `color: ${COLOR_HEX.blackBright}` },
  redBright: { ansi: [91, 39], css: `color: ${COLOR_HEX.redBright}` },
  greenBright: { ansi: [92, 39], css: `color: ${COLOR_HEX.greenBright}` },
  yellowBright: { ansi: [93, 39], css: `color: ${COLOR_HEX.yellowBright}` },
  blueBright: { ansi: [94, 39], css: `color: ${COLOR_HEX.blueBright}` },
  magentaBright: { ansi: [95, 39], css: `color: ${COLOR_HEX.magentaBright}` },
  cyanBright: { ansi: [96, 39], css: `color: ${COLOR_HEX.cyanBright}` },
  whiteBright: { ansi: [97, 39] },

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

/** A custom hex color token: `"#rgb"` / `"#rrggbb"` (foreground) or `"bg#rgb"` / `"bg#rrggbb"` (background). */
const HEX_TOKEN = /^(bg)?#([0-9a-f]{3}|[0-9a-f]{6})$/i;

interface IHexColor {
  background: boolean;
  /** Normalized lower-case `#rrggbb`. */
  hex: string;
  rgb: [number, number, number];
}

function parseHexToken(token: string): IHexColor | undefined {
  const match = HEX_TOKEN.exec(token);
  if (match == null) {
    return undefined;
  }
  const digits = (match[2] as string).toLowerCase();
  const full = digits.length === 3 ? digits.replace(/./g, "$&$&") : digits;
  const rgb: [number, number, number] = [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  return { background: match[1] != null, hex: `#${full}`, rgb };
}

/**
 * Returns the ANSI `[open, close]` pair for a named style token, or `undefined` for an unknown token.
 * Hex tokens have no single-code pair; see {@link styleTokenToSgr}.
 */
export function styleTokenToAnsi(token: string): TAnsiPair | undefined {
  return STYLE_PALETTE[token]?.ansi;
}

/**
 * Returns the SGR parameter strings `[open, close]` for a style token: a palette token's codes
 * (`["31", "39"]`), or a 24-bit color for a hex token (`"#00ff00"` → `["38;2;0;255;0", "39"]`,
 * `"bg#00ff00"` → `["48;2;0;255;0", "49"]`). Unknown tokens return `undefined` and are left unstyled.
 */
export function styleTokenToSgr(token: string): [string, string] | undefined {
  const ansi = STYLE_PALETTE[token]?.ansi;
  if (ansi != null) {
    return [String(ansi[0]), String(ansi[1])];
  }
  const hex = parseHexToken(token);
  if (hex == null) {
    return undefined;
  }
  return hex.background ? [`48;2;${hex.rgb.join(";")}`, "49"] : [`38;2;${hex.rgb.join(";")}`, "39"];
}

/**
 * Returns the CSS declaration for a style token (e.g. `"color: #ef5350"`, `"font-weight: bold"`),
 * `"color: #00ff00"` / `"background-color: #00ff00"` for a hex token, or `undefined` if the token
 * has no CSS mapping.
 */
export function styleTokenToCss(token: string): string | undefined {
  const palette = STYLE_PALETTE[token];
  if (palette != null) {
    return palette.css;
  }
  const hex = parseHexToken(token);
  if (hex == null) {
    return undefined;
  }
  return `${hex.background ? "background-color" : "color"}: ${hex.hex}`;
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

/** CSS for a 24-bit SGR color (`38;2;r;g;b` foreground, `48;2;r;g;b` background), as emitted for hex tokens. */
function truecolorToCss(params: string): { css: string; close: number } | undefined {
  const match = /^([34])8;2;(\d{1,3});(\d{1,3});(\d{1,3})$/.exec(params);
  if (match == null) {
    return undefined;
  }
  const hex = `#${[match[2], match[3], match[4]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  return match[1] === "3" ? { css: `color: ${hex}`, close: 39 } : { css: `background-color: ${hex}`, close: 49 };
}

/**
 * Convert an ANSI-styled string (as produced by `formatTemplate` from this palette) into a browser
 * console format string with `%c` CSS segments.
 *
 * The browser `%c` path renders meta from its template directly, but pre-rendered blocks (the error
 * template output) arrive already carrying ANSI escapes — which only Chromium's console interprets;
 * Firefox and WebKit print them literally. This re-expresses those escapes as `%c` CSS, which all
 * engines support. Handles the palette's single-parameter SGR codes and the 24-bit `38;2;r;g;b` /
 * `48;2;r;g;b` colors emitted for hex tokens.
 *
 * Literal `%` in the text is escaped as `%%` so user content can never consume a `%c` style argument.
 */
export function ansiToCssConsoleFormat(input: string): { text: string; styles: string[] } {
  const parts: string[] = [];
  const styles: string[] = [];
  // Active styles keyed by their SGR parameters; insertion order mirrors ANSI nesting so later declarations win in CSS too.
  const active = new Map<string, { css: string; close: number }>();
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
  const sgrRegex = /\u001b\[([\d;]+)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = sgrRegex.exec(input)) != null) {
    pendingText += input.slice(lastIndex, match.index);
    lastIndex = sgrRegex.lastIndex;

    const params = match[1] as string;
    const code = Number(params);
    const open = ANSI_OPEN_TO_CSS.get(code) ?? truecolorToCss(params);
    if (open != null) {
      active.set(params, open);
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
