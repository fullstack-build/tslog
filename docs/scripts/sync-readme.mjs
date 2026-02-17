/**
 * Transforms the root README.md into a Starlight-compatible docs page.
 * Keeps root README.md as the single source of truth.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readme = readFileSync(resolve(root, "README.md"), "utf-8");

const frontmatter = `---
title: "tslog: Beautiful logging experience for TypeScript and JavaScript"
description: "Powerful, fast and expressive logging for TypeScript and JavaScript"
---

`;

let content = readme
  // Remove the H1 title (Starlight generates it from frontmatter)
  .replace(/^# .+\n/, "")
  // Join consecutive badge lines into a single line so they render inline
  .replace(/^(\n*(?:\[?!\[.*\]\(.*\)(?:\(.*\))?\n)+)/m, (block) =>
    block.trim().replace(/\n/g, " ") + "\n"
  )
  // Rewrite raw.githubusercontent image URLs to local paths
  .replace(
    /https:\/\/raw\.githubusercontent\.com\/fullstack-build\/tslog\/master\/docs\/assets\//g,
    "/assets/"
  )
  // Strip <a name="life_cycle"> anchor, keep the heading text
  .replace(
    /### <a name="life_cycle"><\/a>Lifecycle of a log message/,
    "### Lifecycle of a log message"
  )
  // Convert <a href="#life_cycle"> links to use Starlight's auto-generated heading ID
  .replace(
    /<a href="#life_cycle">"Lifecycle of a log message"<\/a>/g,
    '[Lifecycle of a log message](#lifecycle-of-a-log-message)'
  );

const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/content/docs"
);
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "index.md"), frontmatter + content);
