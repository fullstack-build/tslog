import { describe, expect, test } from "vitest";
import { box, tree } from "../src/subpaths/pretty/box.js";

// M4.4 — `tslog/pretty/box`: pure unicode box() and tree() renderers (no side effects, deterministic).

describe("box()", () => {
  test("wraps a single line with single borders + default padding", () => {
    expect(box("Hello")).toBe(["┌───────┐", "│ Hello │", "└───────┘"].join("\n"));
  });

  test("renders a title in the top border and sizes to fit it", () => {
    const out = box("hi", { title: "Greeting" });
    const lines = out.split("\n");
    expect(lines[0]).toBe("┌ Greeting ┐");
    // Inner width is driven by the title (10) since the content (`hi`+padding = 4) is narrower.
    expect(lines[1]).toBe("│ hi       │");
    expect(lines[2]).toBe("└──────────┘");
    // Every line is the same visible width.
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });

  test("accepts an array of lines, sizing to the widest", () => {
    const out = box(["short", "a longer line"]);
    const lines = out.split("\n");
    expect(lines).toEqual(["┌───────────────┐", "│ short         │", "│ a longer line │", "└───────────────┘"]);
  });

  test("splits embedded newlines into rows", () => {
    expect(box("a\nb").split("\n")).toEqual(["┌───┐", "│ a │", "│ b │", "└───┘"]);
  });

  test("honors padding and border style", () => {
    const out = box("x", { padding: 0, borderStyle: "double" });
    expect(out).toBe(["╔═╗", "║x║", "╚═╝"].join("\n"));
  });

  test("supports ascii, round and bold styles", () => {
    expect(box("x", { padding: 0, borderStyle: "ascii" })).toBe(["+-+", "|x|", "+-+"].join("\n"));
    expect(box("x", { padding: 0, borderStyle: "round" }).split("\n")[0]).toBe("╭─╮");
    expect(box("x", { padding: 0, borderStyle: "bold" }).split("\n")[0]).toBe("┏━┓");
  });

  test("aligns content within the box", () => {
    const right = box(["x", "wide"], { align: "right", padding: 1 }).split("\n");
    expect(right[1]).toBe("│    x │");
    expect(right[2]).toBe("│ wide │");

    const center = box(["x", "wide"], { align: "center", padding: 1 }).split("\n");
    expect(center[1]).toBe("│  x   │");
  });

  test("ignores ANSI escapes when computing width", () => {
    const colored = "\x1b[31mred\x1b[0m";
    const out = box(colored, { padding: 0 });
    const lines = out.split("\n");
    // Border is sized to the visible width (3), not the raw string length.
    expect(lines[0]).toBe("┌───┐");
    expect(lines[2]).toBe("└───┘");
  });

  test("is pure — same input yields identical output", () => {
    expect(box("y", { title: "T" })).toBe(box("y", { title: "T" }));
  });
});

describe("tree()", () => {
  test("renders nested objects/arrays deterministically", () => {
    const out = tree({ user: { id: 1, roles: ["admin", "ops"] }, ok: true });
    expect(out).toBe(
      [
        "├─ user {}", //
        "│  ├─ id: 1",
        "│  └─ roles [2]",
        "│     ├─ 0: admin",
        "│     └─ 1: ops",
        "└─ ok: true",
      ].join("\n"),
    );
  });

  test("formats leaf primitives", () => {
    const out = tree({ s: "str", n: 42, b: false, nul: null, u: undefined, big: 7n });
    expect(out).toBe(
      [
        "├─ s: str", //
        "├─ n: 42",
        "├─ b: false",
        "├─ nul: null",
        "├─ u: undefined",
        "└─ big: 7n",
      ].join("\n"),
    );
  });

  test("treats Date/RegExp/Error as leaves, not containers", () => {
    const out = tree({ when: new Date(0), re: /ab+/g });
    const lines = out.split("\n");
    expect(lines[0].startsWith("├─ when: ")).toBe(true);
    expect(lines[1]).toBe("└─ re: /ab+/g");
    // No descent into the Date/RegExp internals.
    expect(lines).toHaveLength(2);
  });

  test("collapses containers beyond maxDepth without descending", () => {
    const out = tree({ a: { b: { c: 1 } } }, { maxDepth: 1 });
    expect(out).toBe(
      [
        "└─ a {}", //
        "   └─ b {…}",
      ].join("\n"),
    );
  });

  test("renders a top-level non-container as a single leaf", () => {
    expect(tree("plain")).toBe("plain");
    expect(tree(123)).toBe("123");
  });

  test("is deterministic across repeated calls", () => {
    const input = { z: [1, 2], a: { k: "v" } };
    expect(tree(input)).toBe(tree(input));
  });
});
