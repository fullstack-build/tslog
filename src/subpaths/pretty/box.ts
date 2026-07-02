/**
 * `tslog/pretty/box` — pure unicode box & tree renderers (M4.4).
 *
 * Two standalone, dependency-free string builders with no import-time side effects, usable on every
 * runtime (Node, browsers, Deno, Bun). Neither touches the logger; they just return strings, so you
 * can print them, log them, or assert on them in tests.
 *
 * - {@link box} draws a unicode box around one or more lines of text, with an optional title,
 *   padding, alignment and border style.
 * - {@link tree} renders a nested object / array as a deterministic, indented tree.
 *
 * @example
 * import { box, tree } from "tslog/pretty/box";
 * import { Logger } from "tslog";
 *
 * const logger = new Logger();
 * logger.info("\n" + box(["Server started", "http://localhost:3000"], { title: "tslog", padding: 1 }));
 * logger.debug("\n" + tree({ user: { id: 1, roles: ["admin", "ops"] }, ok: true }));
 *
 * @module
 */

/** Border line characters: top-left, top-right, bottom-left, bottom-right, horizontal, vertical. */
interface IBorderChars {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string;
  v: string;
}

/** Named unicode border styles for {@link box}. */
export type BoxBorderStyle = "single" | "double" | "round" | "bold" | "ascii";

const BORDER_STYLES: Record<BoxBorderStyle, IBorderChars> = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
  round: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
  bold: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
};

/** Options for {@link box}. */
export interface IBoxOptions {
  /** Optional title rendered into the top border. */
  title?: string;
  /** Spaces of horizontal padding inside the box (left & right). Default `1`. */
  padding?: number;
  /** Border style. Default `"single"`. */
  borderStyle?: BoxBorderStyle;
  /** Horizontal alignment of the content lines. Default `"left"`. */
  align?: "left" | "center" | "right";
}

/** Options for {@link tree}. */
export interface ITreeOptions {
  /**
   * Maximum depth to descend before collapsing nested values to a placeholder. Default `8`.
   * Guards against pathological / very deep structures.
   */
  maxDepth?: number;
}

// ANSI SGR escape sequences: ESC (0x1b) "[" … "m". Built via String.fromCharCode so the source
// carries no literal control character (Biome flags control chars in regex literals).
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Visible width of a string, ignoring ANSI SGR escape sequences. */
function visibleWidth(str: string): number {
  return str.replace(ANSI_RE, "").length;
}

/** Pad a string to `width` visible columns on the given side(s). */
function pad(str: string, width: number, align: "left" | "center" | "right"): string {
  const deficit = width - visibleWidth(str);
  if (deficit <= 0) return str;
  if (align === "right") return " ".repeat(deficit) + str;
  if (align === "center") {
    const left = deficit >> 1;
    return " ".repeat(left) + str + " ".repeat(deficit - left);
  }
  return str + " ".repeat(deficit);
}

/**
 * Draw a unicode box around `content`.
 *
 * @param content A single string (split on newlines) or an array of lines.
 * @param opts See {@link IBoxOptions}.
 * @returns The multi-line boxed string (no trailing newline).
 *
 * @example
 * box("Hello", { title: "Greeting", borderStyle: "round" });
 * // ╭ Greeting ╮
 * // │ Hello    │
 * // ╰──────────╯
 */
export function box(content: string | string[], opts: IBoxOptions = {}): string {
  const padding = Math.max(0, opts.padding ?? 1);
  const align = opts.align ?? "left";
  const chars = BORDER_STYLES[opts.borderStyle ?? "single"];
  const title = opts.title ?? "";

  const lines = (Array.isArray(content) ? content : String(content).split("\n")).flatMap((line) => line.split("\n"));

  // Inner width = widest content line, but at least wide enough to fit the title in the top border.
  const contentWidth = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  const padded = padding * 2;
  // Title sits in the top border as `<h> title <h>`, so it needs `visibleWidth(title) + 2` columns of inner space.
  const titleSpan = title ? visibleWidth(title) + 2 : 0;
  const innerWidth = Math.max(contentWidth + padded, titleSpan);

  const pad1 = " ".repeat(padding);
  const out: string[] = [];

  // Top border (with optional centered title).
  if (title) {
    const label = ` ${title} `;
    const remaining = innerWidth - visibleWidth(label);
    const left = remaining >> 1;
    out.push(chars.tl + chars.h.repeat(left) + label + chars.h.repeat(remaining - left) + chars.tr);
  } else {
    out.push(chars.tl + chars.h.repeat(innerWidth) + chars.tr);
  }

  // Content rows.
  const rowInner = innerWidth - padded;
  for (const line of lines) {
    out.push(chars.v + pad1 + pad(line, rowInner, align) + pad1 + chars.v);
  }

  // Bottom border.
  out.push(chars.bl + chars.h.repeat(innerWidth) + chars.br);

  return out.join("\n");
}

/** Render a leaf (non-container) value to a stable single-line token. */
function formatLeaf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[Function${value.name ? `: ${value.name}` : ""}]`;
  if (typeof value === "symbol") return value.toString();
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value);
}

/** A container is a plain-ish object or array we descend into; everything else is a leaf. */
function isContainer(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Date || value instanceof RegExp || value instanceof Error) return false;
  return true;
}

function renderTree(node: unknown, prefix: string, depth: number, maxDepth: number, out: string[]): void {
  if (!isContainer(node)) return;

  const entries: [string, unknown][] = Array.isArray(node) ? node.map((v, i) => [String(i), v]) : Object.entries(node);

  entries.forEach(([key, value], index) => {
    const last = index === entries.length - 1;
    const branch = last ? "└─ " : "├─ ";
    const childPrefix = prefix + (last ? "   " : "│  ");

    if (isContainer(value) && depth < maxDepth) {
      const summary = Array.isArray(value) ? `[${value.length}]` : "{}";
      out.push(`${prefix}${branch}${key} ${summary}`);
      renderTree(value, childPrefix, depth + 1, maxDepth, out);
    } else if (isContainer(value)) {
      // Depth limit reached — collapse without descending.
      out.push(`${prefix}${branch}${key} ${Array.isArray(value) ? "[…]" : "{…}"}`);
    } else {
      out.push(`${prefix}${branch}${key}: ${formatLeaf(value)}`);
    }
  });
}

/**
 * Render a nested object or array as a deterministic, indented tree.
 *
 * Keys are rendered in their own insertion order (arrays by index), output is stable for a given
 * input, and there are no side effects. Non-container leaves (numbers, strings, `Date`, `Error`, …)
 * are shown inline; nested containers are recursed up to {@link ITreeOptions.maxDepth}.
 *
 * @param node The object / array to render. Non-containers render as a single leaf line.
 * @param opts See {@link ITreeOptions}.
 * @returns The multi-line tree string (no trailing newline).
 *
 * @example
 * tree({ user: { id: 1, roles: ["admin"] }, ok: true });
 * // ├─ user {}
 * // │  ├─ id: 1
 * // │  └─ roles [1]
 * // │     └─ 0: admin
 * // └─ ok: true
 */
export function tree(node: unknown, opts: ITreeOptions = {}): string {
  const maxDepth = Math.max(0, opts.maxDepth ?? 8);
  if (!isContainer(node)) return formatLeaf(node);
  const out: string[] = [];
  renderTree(node, "", 0, maxDepth, out);
  return out.join("\n");
}
