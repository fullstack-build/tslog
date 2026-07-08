/**
 * Transforms the root README.md and MIGRATION_v4_to_v5.md into Starlight-compatible
 * docs pages. Keeps the root markdown files as the single source of truth.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readme = readFileSync(resolve(root, "README.md"), "utf-8");

// GitHub-flavoured alerts (`> [!NOTE]` blockquotes) → Starlight asides (`:::note`).
// GitHub renders these natively on the repo; Starlight needs its own directive syntax.
const ALERT_TITLE = {
  NOTE: { type: "note", title: "Note" },
  TIP: { type: "tip", title: "Tip" },
  IMPORTANT: { type: "caution", title: "Important" },
  WARNING: { type: "caution", title: "Warning" },
  CAUTION: { type: "danger", title: "Caution" },
};

function convertGithubAlerts(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^>\s*\[!(\w+)\]\s*$/);
    if (marker && ALERT_TITLE[marker[1].toUpperCase()]) {
      const { type, title } = ALERT_TITLE[marker[1].toUpperCase()];
      const body = [];
      i++;
      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      i--; // step back; the outer loop's i++ consumes the terminator
      out.push(`:::${type}[${title}]`, ...body, ":::");
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n");
}

// tslog's default level colors (verbatim from src/render/styles.ts), reused
// so the "Log levels" table's name column matches the pretty-print output
// exactly — same tokens as the homepage hero terminal.
const LEVEL_NAMES = ["SILLY", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

// Docs-only: replace the "id | name | method" markdown table with a raw HTML
// table (a <colgroup> is the only reliable cross-browser way to force
// table-layout: fixed columns to actually fill the row) and recolor each
// level name to match tslog's real pretty-print colors. The root README
// keeps a plain markdown table for GitHub; this only touches the generated
// docs copy.
function styleLogLevelsTable(md) {
  const lines = md.split("\n");
  const headerIdx = lines.findIndex((l) => /^\|\s*id\s*\|\s*name\s*\|\s*method\s*\|/i.test(l));
  if (headerIdx === -1) return md;

  let end = headerIdx + 2; // header + separator row
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;

  const rows = lines.slice(headerIdx + 2, end).map((l) => {
    const cells = l.split("|").slice(1, -1).map((c) => c.trim());
    const [id, name, method] = cells;
    const pill = LEVEL_NAMES.includes(name)
      ? `<span class="lvl-pill lvl-pill--${name.toLowerCase()}">${name}</span>`
      : name;
    // `method` arrives as markdown (`` `log.silly()` ``); render its backticks as <code>.
    const methodHtml = method.replace(/`([^`]+)`/g, "<code>$1</code>");
    return `<tr><td>${id}</td><td>${pill}</td><td>${methodHtml}</td></tr>`;
  });

  const table = [
    '<div class="log-levels-table">',
    "",
    '<table><colgroup><col style="width:12%"><col style="width:28%"><col style="width:60%"></colgroup>',
    "<thead><tr><th>id</th><th>name</th><th>method</th></tr></thead>",
    `<tbody>${rows.join("")}</tbody></table>`,
    "",
    "</div>",
  ];

  return [...lines.slice(0, headerIdx), ...table, ...lines.slice(end)].join("\n");
}

const frontmatter = `---
title: "Beautiful logging for TypeScript"
description: "Powerful, fast and expressive logging for TypeScript and JavaScript"
---

`;

let content = readme
  // Remove the H1 title (Starlight generates it from frontmatter)
  .replace(/^# .+\n/, "")
  // Link the un-linked MIT license badge to the repository's LICENSE
  .replace(
    /!\[License: MIT\]\((https:\/\/img\.shields\.io\/npm\/l\/tslog[^)]*)\)/,
    "[![License: MIT]($1)](https://github.com/fullstack-build/tslog/blob/master/LICENSE)"
  )
  // Point the relative "[MIT](./LICENSE)" link (License section) at GitHub —
  // ./LICENSE 404s on the docs site.
  .replace(
    /\[MIT\]\(\.\/LICENSE\)/g,
    "[MIT](https://github.com/fullstack-build/tslog/blob/master/LICENSE)"
  )
  // Join consecutive badge lines into a single line so they render inline
  .replace(/^(\n*(?:\[?!\[.*\]\(.*\)(?:\(.*\))?\n)+)/m, (block) =>
    block.trim().replace(/\n/g, " ") + "\n"
  )
  // Rewrite raw.githubusercontent image URLs to local paths (served from /public)
  .replace(
    /https:\/\/raw\.githubusercontent\.com\/fullstack-build\/tslog\/master\/docs\/public\/assets\//g,
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
  .replace(/\]\(\.\/MIGRATION_v4_to_v5\.md\)/g, "](/migration-v4-to-v5)")
  // Strip the leading emoji from each Highlights bullet (docs render them as
  // styled cards; the README keeps its emoji for GitHub). Scoped to the
  // "## Highlights" section so no other emoji are touched.
  .replace(/(## Highlights\n[\s\S]*?)(?=\n## )/, (block) =>
    block.replace(
      /^(-\s+)\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️]*\s*/gmu,
      "$1"
    )
  );

content = convertGithubAlerts(content);
content = styleLogLevelsTable(content);

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
const migrationContent = convertGithubAlerts(
  migration
    // Remove the H1 title (Starlight generates it from frontmatter)
    .replace(/^# .+\n/, "")
);
// Prepend a "back to docs" link so deep pages are never a dead end.
const backLink = `[← Back to tslog docs](/)\n\n`;
writeFileSync(
  resolve(outDir, "migration-v4-to-v5.md"),
  migrationFrontmatter + backLink + migrationContent
);
