/**
 * Side-effect audit (M0.6).
 *
 * v5 promises `sideEffects: false` so bundlers can drop unused subpaths (presets, transports,
 * the off-Node `util.inspect` polyfill, CSS styling) from edge/browser builds. That promise only
 * holds if importing a module performs no *observable* work at import time — the regression we
 * actually care about is a module-level call into runtime-probing/IO code, e.g. the v4
 * `const loggerEnvironment = createLoggerEnvironment()` singleton, or a bare `console.log(...)`.
 *
 * What is allowed at top level (pure initialization, tree-shakeable, not a side effect):
 *   - import / export / type / interface / enum / class / function declarations
 *   - const/let/var bindings to ANY expression, including multi-line ones
 *     (`const T = Object.freeze({...})`, `const M = Object.fromEntries(...)`)
 *   - property setup on a module-local binding (`inspect.colors = ...`) — pure, no external effect
 *
 * What is flagged (genuine import-time side effects):
 *   - a bare call statement at top level:           `createLoggerEnvironment();`  `setup();`
 *   - a bare `new X()` statement at top level:       `new Thing();`
 *   - a call used as the whole statement via member: `something.run();` `console.log(...)`
 *
 * The scan strips comments and string/template literals first, then tracks brace/paren/bracket
 * depth and whether we are mid-binding, so multi-line RHS expressions are not misread as statements.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "..", "src");

/** Files allowed to have side effects (e.g. the CLI entry actually runs work). */
// Legitimate runnable ENTRY points (not library modules): the CLI bin and the worker-thread runner.
// Both are *meant* to execute at top level — the CLI when invoked as a binary, the worker runner when
// Node spawns it inside a worker thread. Neither is ever imported on the main thread, so their top-level
// code does not affect tree-shaking of the library surface.
const ALLOWLIST = new Set(["subpaths/cli.ts", "subpaths/transports/worker.runner.ts"]);

/** Member roots whose top-level method calls are pure local setup, not observable side effects. */
const LOCAL_SETUP_ROOTS = new Set(["Object", "Reflect", "Symbol"]);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Remove line/block comments and string/template contents so they can't confuse the scanner. */
function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code"; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { state = "block"; out += "  "; i += 2; continue; }
      if (c === "'") { state = "sq"; out += '""'.slice(0, 1); i++; continue; }
      if (c === '"') { state = "dq"; out += '"'; i++; continue; }
      if (c === "`") { state = "tpl"; out += "`"; i++; continue; }
      out += c; i++; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i++; continue; }
    if (state === "block") { if (c === "*" && next === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i++; continue; }
    if (state === "sq") { if (c === "\\") { i += 2; continue; } if (c === "'") { state = "code"; out += '"'; } i++; continue; }
    if (state === "dq") { if (c === "\\") { i += 2; continue; } if (c === '"') { state = "code"; out += '"'; } i++; continue; }
    if (state === "tpl") { if (c === "\\") { i += 2; continue; } if (c === "`") { state = "code"; out += "`"; } if (c === "\n") out += "\n"; i++; continue; }
  }
  return out;
}

const DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:import|export|type|interface|enum|class|function|const|let|var|namespace|module)\b/;

function findSideEffects(source) {
  const clean = stripCommentsAndStrings(source);
  const lines = clean.split("\n");
  const rawLines = source.split("\n");
  const offenders = [];

  let depth = 0;        // {} [] () nesting
  let inBinding = false; // inside an unterminated declaration/expression statement

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    if (depth === 0 && !inBinding) {
      const isDecl = DECL_RE.test(line) || line.startsWith("}") || line.startsWith(")") || line.startsWith("]") || line.startsWith("export");
      if (!isDecl) {
        // A statement that is purely a call/new at top level is a side effect.
        const bareCall = /^[A-Za-z_$][\w$]*\s*\(/.test(line);
        const bareNew = /^new\s+[A-Za-z_$]/.test(line);
        const memberCall = /^([A-Za-z_$][\w$]*)\s*\.[\w$.]+\s*\(/.exec(line);
        const isLocalSetup = memberCall != null && LOCAL_SETUP_ROOTS.has(memberCall[1]);
        if ((bareCall || bareNew || (memberCall != null && !isLocalSetup))) {
          offenders.push({ line: i + 1, text: rawLines[i].trim() });
        }
      }
    }

    // Update nesting depth and binding continuation.
    for (const ch of line) {
      if (ch === "{" || ch === "[" || ch === "(") depth++;
      else if (ch === "}" || ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    }
    // Mid-binding if we're nested, or the line doesn't clearly end a statement/block.
    inBinding = depth > 0 || !/[;}]\s*$/.test(line);
  }

  return offenders;
}

const files = await walk(srcDir);
let failed = false;

for (const file of files) {
  const rel = path.relative(srcDir, file).split(path.sep).join("/");
  if (ALLOWLIST.has(rel)) continue;
  const source = await readFile(file, "utf8");
  const offenders = findSideEffects(source);
  if (offenders.length > 0) {
    failed = true;
    console.error(`\nside-effect(s) in src/${rel}:`);
    for (const o of offenders) console.error(`  L${o.line}: ${o.text}`);
  }
}

// The entry points' default singleton is the one intentional import-time construction; it is only
// droppable by bundlers because of its `/* @__PURE__ */` annotation. `removeComments` in the ESM
// tsconfig would silently strip it, so assert it survives into dist when a build is present.
const distEsmDir = path.resolve(__dirname, "..", "dist", "esm");
for (const entry of ["index.node.js", "index.browser.js", "index.universal.js"]) {
  const distFile = path.join(distEsmDir, entry);
  let compiled;
  try {
    compiled = await readFile(distFile, "utf8");
  } catch {
    continue; // no build present — the source scan above is the pre-build gate
  }
  if (!/\/\*\s*@__PURE__\s*\*\/\s*new Logger/.test(compiled)) {
    failed = true;
    console.error(`\ndist/esm/${entry}: the default \`log\` singleton lost its /* @__PURE__ */ annotation.`);
    console.error("Check that tsconfig.esm.json keeps removeComments:false so bundlers can drop the unused singleton.");
  }
}

if (failed) {
  console.error("\nsideEffects:false is violated — modules must not run observable code at import time.");
  console.error("Move work into functions called by the Logger, not module top-level.");
  process.exitCode = 1;
} else {
  console.log(`side-effect audit passed (${files.length} files, sideEffects:false holds).`);
}
