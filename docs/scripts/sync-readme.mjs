/**
 * Transforms the root README.md and MIGRATION_v4_to_v5.md into Starlight-compatible
 * docs pages. Keeps the root markdown files as the single source of truth.
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
  )
  // Point the migration-guide link at the generated docs page instead of the repo file
  .replace(/\]\(\.\/MIGRATION_v4_to_v5\.md\)/g, "](/migration-v4-to-v5)");

const outDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/content/docs"
);
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "index.md"), frontmatter + content);

// Generate the migration guide as its own Starlight page from the root source.
const migration = readFileSync(resolve(root, "MIGRATION_v4_to_v5.md"), "utf-8");
const migrationFrontmatter = `---
title: "Migrating from tslog v4 to v5"
description: "Step-by-step guide mapping every removed v4 setting to its v5 replacement."
---

`;
const migrationContent = migration
  // Remove the H1 title (Starlight generates it from frontmatter)
  .replace(/^# .+\n/, "");
writeFileSync(resolve(outDir, "migration-v4-to-v5.md"), migrationFrontmatter + migrationContent);
