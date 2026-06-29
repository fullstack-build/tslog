import { execFileSync } from "child_process";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Keeps the "Current version: X.Y.Z" line in AGENTS.md in sync with package.json.
// Wired into the npm "version" lifecycle (see package.json scripts), so it runs
// after the version bump but before the release commit, and the change is
// included in that commit. Run manually with `npm run sync-version` if needed.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const main = async () => {
  const pkg = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  const { version } = pkg;

  const agentsPath = path.join(rootDir, "AGENTS.md");
  const agents = await readFile(agentsPath, "utf8");

  const pattern = /Current version: \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\./;
  if (!pattern.test(agents)) {
    console.warn("sync-version: no 'Current version: X.Y.Z' line found in AGENTS.md; nothing to update.");
    return;
  }

  const updated = agents.replace(pattern, `Current version: ${version}.`);
  if (updated === agents) {
    return; // already in sync
  }

  await writeFile(agentsPath, updated);
  console.log(`sync-version: AGENTS.md version set to ${version}.`);

  // Include the change in the version commit np/npm is about to create.
  // Best-effort: if not in a git context, don't fail the release.
  try {
    execFileSync("git", ["add", "AGENTS.md"], { cwd: rootDir, stdio: "ignore" });
  } catch {
    // ignore — running outside git or git unavailable
  }
};

main().catch((error) => {
  console.error("sync-version failed:", error);
  if (globalThis.process) {
    globalThis.process.exitCode = 1;
  }
});
