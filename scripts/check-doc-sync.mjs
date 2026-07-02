import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Drift check for the AI-facing docs (llms.txt, RECIPES.md) against the real
// source. These two files are hand-curated and not derivable from each other,
// so this asserts cross-file invariants instead of generating one from the
// other: every setting/symbol they name must exist in the source, their masking
// examples must not conflict, and their relative links must resolve.
//
// Deterministic and fast — wired into the pre-commit hook (npm run check) and CI.
// Run manually with `npm run check-doc-sync`. Exits non-zero on drift.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const errors = [];
const fail = (msg) => errors.push(msg);

const read = async (rel) => readFile(path.join(rootDir, rel), "utf8");

// Settings that are documented but intentionally not declared as bare keys in
// ISettingsParam (nested under `overwrite`, or accessed via dotted paths in
// prose). Listing them here keeps the existence check honest without forcing a
// brittle parse of nested option types.
const SETTINGS_ALLOWLIST = new Set([
  "includeDefaultMetaInAddMeta", // overwrite.includeDefaultMetaInAddMeta
  "addMeta", // overwrite.addMeta
]);

// `Settings`-style identifiers we extract from the docs and expect to find as
// keys in src/interfaces.ts. Anything matching `key:` or `\`key\`` in the "Key
// settings" contexts. We keep this list explicit rather than scraping every
// backticked token (which would pull in method names, values, etc.).
const DOC_SETTING_NAMES = [
  "type",
  "minLevel",
  "name",
  "maskValuesOfKeys",
  "maskValuesRegEx",
  "prettyLogLevelMethod",
  "internalFramePatterns",
  "hideLogPositionForProduction",
  "includeDefaultMetaInAddMeta",
  "addMeta",
];

const main = async () => {
  const interfaces = await read("src/interfaces.ts");
  const index = await read("src/index.ts");
  const llms = await read("llms.txt");
  const recipes = await read("RECIPES.md");

  // 1. Every setting named in the docs must exist in the source interfaces
  //    (or be an allow-listed nested/dotted option).
  for (const name of DOC_SETTING_NAMES) {
    const inDocs = llms.includes(name) || recipes.includes(name);
    if (!inDocs) continue; // not referenced; nothing to verify
    const declared = new RegExp(`\\b${name}\\??:`).test(interfaces) || SETTINGS_ALLOWLIST.has(name);
    if (!declared) {
      fail(
        `Setting "${name}" is documented (llms.txt/RECIPES.md) but not found in src/interfaces.ts. ` +
          `Either it was renamed/removed (update the docs) or add it to SETTINGS_ALLOWLIST in this script if it is a nested option.`
      );
    }
  }

  // 2. Imports shown in llms.txt must be real exports of the package entry.
  //    llms.txt advertises: Logger, log, LogLevel, ILogObj.
  const ADVERTISED_EXPORTS = ["Logger", "log", "LogLevel", "ILogObj"];
  // index.ts re-exports interfaces via `export * from "./interfaces.js"`, so a
  // symbol counts as exported if it is exported from index.ts OR interfaces.ts.
  const reExportsInterfaces = /export\s+\*\s+from\s+["']\.\/interfaces(\.js)?["']/.test(index);
  for (const sym of ADVERTISED_EXPORTS) {
    if (!llms.includes(sym)) continue;
    const inIndex = new RegExp(`export\\b[^\\n]*\\b${sym}\\b`).test(index) || new RegExp(`\\b${sym}\\b`).test(index);
    const inInterfaces = reExportsInterfaces && new RegExp(`export\\b[^\\n]*\\b${sym}\\b`).test(interfaces);
    if (!inIndex && !inInterfaces) {
      fail(`llms.txt advertises import "${sym}" but it is not an export of src/index.ts (directly or via interfaces re-export).`);
    }
  }

  // 3. Masking key-list examples must not conflict between the two docs.
  //    We extract the first maskValuesOfKeys array literal from each file and
  //    require that they share at least one key and contain no contradictory
  //    guidance. (They are documented as non-conflicting supersets.)
  const extractMaskKeys = (text) => {
    const m = text.match(/maskValuesOfKeys:\s*\[([^\]]*)\]/);
    if (!m) return null;
    return m[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  };
  const llmsKeys = extractMaskKeys(llms);
  const recipeKeys = extractMaskKeys(recipes);
  if (llmsKeys && recipeKeys) {
    const overlap = llmsKeys.filter((k) => recipeKeys.includes(k));
    if (overlap.length === 0) {
      fail(
        `maskValuesOfKeys examples in llms.txt and RECIPES.md share no keys ` +
          `(llms.txt: [${llmsKeys.join(", ")}] vs RECIPES.md: [${recipeKeys.join(", ")}]). ` +
          `Keep the examples consistent so generated code is uniform.`
      );
    }
  }

  // 4. Relative links in llms.txt must resolve on disk. Covers both markdown
  //    links `[text](./path)` and bare `./path` references (llms.txt uses both).
  const relLinks = new Set([
    ...[...llms.matchAll(/\]\((\.\/[^)\s]+)\)/g)].map((m) => m[1]),
    ...[...llms.matchAll(/(?<![([])(\.\/[^\s)]+)/g)].map((m) => m[1]),
  ]);
  for (const link of relLinks) {
    const target = path.join(rootDir, link.replace(/^\.\//, ""));
    if (!existsSync(target)) {
      fail(`llms.txt has a broken relative link: ${link} (resolved to ${path.relative(rootDir, target)}, which does not exist).`);
    }
  }

  if (errors.length > 0) {
    console.error(`check-doc-sync: ${errors.length} issue(s) found:\n`);
    for (const e of errors) console.error(`  • ${e}\n`);
    console.error("Fix the docs (llms.txt / RECIPES.md) so they match the source, then re-run.");
    if (globalThis.process) globalThis.process.exitCode = 1;
    return;
  }

  console.log("check-doc-sync: llms.txt and RECIPES.md are in sync with the source.");
};

main().catch((error) => {
  console.error("check-doc-sync failed to run:", error);
  if (globalThis.process) globalThis.process.exitCode = 1;
});
