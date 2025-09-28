import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const adjustPaths = (value) => {
  if (typeof value === "string") {
    return value.replace(/^\.\/dist\//, "./");
  }

  if (Array.isArray(value)) {
    return value.map((entry) => adjustPaths(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, adjustPaths(entry)])
    );
  }

  return value;
};

const pick = (source, fields) => {
  return Object.fromEntries(
    fields
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]])
  );
};

const main = async () => {
  const pkgPath = path.join(rootDir, "package.json");
  const pkgRaw = await readFile(pkgPath, "utf8");
  const rootPkg = JSON.parse(pkgRaw);

  const publishPkg = {
    ...pick(rootPkg, [
      "name",
      "version",
      "description",
      "keywords",
      "homepage",
      "repository",
      "bugs",
      "author",
      "license",
      "funding",
      "sideEffects",
      "type",
      "engines",
    ]),
    main: adjustPaths(rootPkg.main),
    module: adjustPaths(rootPkg.module),
    types: adjustPaths(rootPkg.types),
    browser: adjustPaths(rootPkg.browser),
    exports: adjustPaths(rootPkg.exports),
    "react-native": adjustPaths(rootPkg["react-native"]),
  };

  if (rootPkg.publishConfig && rootPkg.publishConfig.access) {
    publishPkg.publishConfig = { access: rootPkg.publishConfig.access };
  }

  if (rootPkg.sideEffects === undefined) {
    publishPkg.sideEffects = false;
  }

  await mkdir(distDir, { recursive: true });
  const packageJsonPath = path.join(distDir, "package.json");
  await writeFile(packageJsonPath, JSON.stringify(publishPkg, null, 2) + "\n");

  const licensePath = path.join(rootDir, "LICENSE");
  await copyFile(licensePath, path.join(distDir, "LICENSE"));
};

main().catch((error) => {
  console.error("Failed to prepare dist package:", error);
  process.exitCode = 1;
});
