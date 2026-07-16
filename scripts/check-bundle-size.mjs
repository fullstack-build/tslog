#!/usr/bin/env node
/**
 * Bundle-size budget check (S1). Bundles representative entry usages straight from `src/` with esbuild
 * (minified ESM, browser platform — the same treatment a user's bundler applies) and fails when the
 * gzipped output exceeds its budget. Guards three promises:
 *
 *  - `tslog/lite` stays the smallest possible leveled console (its methods are bound native
 *    `console.*` functions; nothing from the full pipeline may leak in);
 *  - `tslog/slim` stays a genuinely small structured logger (masking, pretty, the inspect polyfill,
 *    stack parsing, and the JSON line-plan compiler must all remain tree-shaken out);
 *  - the full browser entry does not creep.
 *
 * Budgets have headroom over the measured sizes at introduction (lite ~0.8KB, slim ~9.3KB, full
 * ~19.6KB); bump them CONSCIOUSLY in a commit that explains the growth, never to make a red check
 * pass.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Entry paths are interpolated into a generated source file: forward slashes only, or Windows
// backslashes would be consumed as string-escape sequences by the bundler's parser.
const entryPath = (relative) => join(root, relative).replaceAll("\\", "/");

const PROBES = [
  {
    name: "tslog/lite (createLiteLogger, sub-logger)",
    budgetGzipBytes: 1_024,
    entry: `
      import { createLiteLogger } from "${entryPath("src/subpaths/lite.ts")}";
      const log = createLiteLogger({ name: "probe", minLevel: "INFO" });
      log.getSubLogger({ name: "child" }).info("hi", { a: 1 });
    `,
  },
  {
    name: "tslog/slim (Logger, json)",
    budgetGzipBytes: 10_500,
    entry: `
      import { Logger } from "${entryPath("src/subpaths/slim.ts")}";
      const log = new Logger({ bindings: { service: "probe" } });
      log.info("hi", { a: 1 });
    `,
  },
  {
    name: "tslog (browser entry, Logger, json)",
    // 21_500 -> 21_800: ansiToCssConsoleFormat (errors rendered as %c CSS on the browser console path).
    budgetGzipBytes: 21_800,
    entry: `
      import { Logger } from "${entryPath("src/index.browser.ts")}";
      const log = new Logger({ type: "json" });
      log.info("hi", { a: 1 });
    `,
  },
];

const workDir = mkdtempSync(join(tmpdir(), "tslog-size-"));
let failed = false;

try {
  for (const probe of PROBES) {
    const entryFile = join(workDir, "entry.ts");
    writeFileSync(entryFile, probe.entry);
    const result = await build({
      entryPoints: [entryFile],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      write: false,
      treeShaking: true,
      absWorkingDir: root,
      logLevel: "silent",
    });
    const minified = result.outputFiles[0].contents;
    const gzip = gzipSync(minified, { level: 9 }).length;
    const overBudget = gzip > probe.budgetGzipBytes;
    failed ||= overBudget;
    const status = overBudget ? "OVER BUDGET" : "ok";
    console.log(
      `${status.padEnd(12)} ${probe.name}: ${(minified.length / 1024).toFixed(1)}KB min, ${(gzip / 1024).toFixed(2)}KB gzip (budget ${(probe.budgetGzipBytes / 1024).toFixed(2)}KB)`,
    );
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failed) {
  console.error("\ncheck-bundle-size: a probe exceeded its gzip budget — see above.");
  process.exit(1);
}
console.log("check-bundle-size: all probes within budget.");
