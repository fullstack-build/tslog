import { build } from "esbuild";

build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/browser/index.js",
  platform: "browser",
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "tslog",
  loader: { ".ts": "ts" },
})
  .then(() => console.log("⚡ Done"))
  .catch(() => process.exit(1));
