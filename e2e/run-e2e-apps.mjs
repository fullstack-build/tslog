#!/usr/bin/env node
/**
 * Framework E2E: proves tslog's source-mapped log positions work OUT OF THE BOX against real
 * framework dev servers — the environments unit tests cannot reach (Turbopack has no library API;
 * Vite SSR stack behavior depends on its live module runner).
 *
 * For each fixture app in e2e/fixtures/: install deps (latest framework versions on purpose — this
 * suite is a canary for upstream changes), install the freshly packed tslog tarball, start the dev
 * server, hit its /api/boom probe route, and assert the returned log positions point at original
 * .ts sources (not generated chunks).
 *
 * Runs from `npm run test:e2e-apps` and the CI `test-e2e-apps` job — NOT part of `npm test` (needs
 * network + ~1min per fixture). Requires a prior `npm run build` (packs from dist/).
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesDir = join(rootDir, "e2e", "fixtures");

/** @typedef {{ name: string, dir: string, port: number, probePath: string, assert: (body: any) => string[] }} Fixture */

/** Assert helpers returning a list of failure strings (empty = pass). */
function expectMatch(failures, label, value, regex) {
  if (typeof value !== "string" || !regex.test(value)) {
    failures.push(`${label}: expected ${JSON.stringify(value)} to match ${regex}`);
  }
}

/** @type {Fixture[]} */
const fixtures = [
  {
    name: "next-turbopack",
    dir: join(fixturesDir, "next-turbopack"),
    port: 43117,
    probePath: "/api/boom",
    assert(body) {
      const failures = [];
      // The thrown error's frames resolve through Turbopack's sectioned maps back to the .ts sources.
      expectMatch(failures, "errorFrames[0] (throw site)", body?.errorFrames?.[0]?.filePathWithLine, /(^|\/)lib\/boom\.ts:4$/);
      expectMatch(failures, "errorFrames[1] (caller)", body?.errorFrames?.[1]?.filePathWithLine, /(^|\/)app\/api\/boom\/route\.ts:\d+$/);
      // The log call site: tslog's own bundled frames must be skipped, landing on the route handler.
      expectMatch(failures, "callSitePath", body?.callSitePath?.filePathWithLine, /(^|\/)app\/api\/boom\/route\.ts:\d+$/);
      return failures;
    },
  },
  {
    name: "tanstack-start",
    dir: join(fixturesDir, "tanstack-start"),
    port: 43118,
    probePath: "/api/boom",
    assert(body) {
      const failures = [];
      // Vite's SSR module runner serves original .ts paths with correct positions; tslog must keep
      // them intact (no bogus remap) and caller detection must skip tslog's own frames.
      expectMatch(failures, "errorFrames[0] (throw site)", body?.errorFrames?.[0]?.filePathWithLine, /(^|\/)src\/lib\/boom\.ts:4$/);
      expectMatch(failures, "callSitePath", body?.callSitePath?.filePathWithLine, /(^|\/)src\/routes\/api\/boom\.ts(x)?:\d+$/);
      return failures;
    },
  },
];

function run(cmd, cwd) {
  execSync(cmd, { cwd, stdio: ["ignore", "inherit", "inherit"] });
}

function packTslog(tmp) {
  const distDir = join(rootDir, "dist");
  if (!existsSync(join(distDir, "esm", "index.node.js"))) {
    console.error("dist/esm is missing — run `npm run build` first.");
    process.exit(1);
  }
  execSync(`npm pack --loglevel=error --pack-destination "${tmp}"`, { cwd: distDir, stdio: ["ignore", "ignore", "inherit"] });
  const tgz = readdirSync(tmp).find((f) => f.startsWith("tslog-") && f.endsWith(".tgz"));
  if (!tgz) {
    console.error("npm pack produced no tarball.");
    process.exit(1);
  }
  return join(tmp, tgz);
}

async function waitForProbe(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      return { ok: false, error: `dev server exited with code ${child.exitCode}` };
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        return { ok: true, body: await res.json() };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err?.cause?.code ?? err);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return { ok: false, error: `probe never became ready (${lastError})` };
}

async function runFixture(fixture, tarball) {
  console.log(`\n=== ${fixture.name} ===`);

  // Fresh framework state; keep node_modules so local re-runs are fast (CI starts clean anyway).
  for (const junk of [".next", ".tanstack", ".nitro", ".output", "node_modules/.vite"]) {
    rmSync(join(fixture.dir, junk), { recursive: true, force: true });
  }
  run("npm install --no-audit --no-fund --no-package-lock", fixture.dir);
  run(`npm install --no-save --no-audit --no-fund --no-package-lock "${tarball}"`, fixture.dir);

  const child = spawn("npm", ["run", "dev"], {
    cwd: fixture.dir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    // Ports are pinned in each fixture's dev script; NODE_ENV must not leak in (dev mode required).
    env: { ...process.env, NODE_ENV: undefined },
  });
  const output = [];
  child.stdout.on("data", (d) => output.push(String(d)));
  child.stderr.on("data", (d) => output.push(String(d)));

  try {
    const url = `http://localhost:${fixture.port}${fixture.probePath}`;
    const result = await waitForProbe(url, child, 240_000);
    if (!result.ok) {
      console.error(`${fixture.name}: FAILED — ${result.error}`);
      console.error(`--- last dev-server output ---\n${output.join("").split("\n").slice(-40).join("\n")}`);
      return false;
    }
    const failures = fixture.assert(result.body);
    if (failures.length > 0) {
      console.error(`${fixture.name}: FAILED assertions:`);
      for (const failure of failures) {
        console.error(`  - ${failure}`);
      }
      console.error(`  probe response: ${JSON.stringify(result.body, null, 2)}`);
      return false;
    }
    console.log(`${fixture.name}: OK`);
    console.log(`  throw site -> ${result.body.errorFrames?.[0]?.filePathWithLine}`);
    console.log(`  call site  -> ${result.body.callSitePath?.filePathWithLine}`);
    return true;
  } finally {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

const only = process.argv[2];
const selected = only ? fixtures.filter((fixture) => fixture.name === only) : fixtures;
if (selected.length === 0) {
  console.error(`Unknown fixture "${only}". Available: ${fixtures.map((fixture) => fixture.name).join(", ")}`);
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "tslog-e2e-"));
try {
  const tarball = packTslog(tmp);
  let allOk = true;
  for (const fixture of selected) {
    allOk = (await runFixture(fixture, tarball)) && allOk;
  }
  process.exit(allOk ? 0 : 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
