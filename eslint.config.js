import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  ...compat.config({
    env: {
      browser: true,
      es2021: true,
    },
    extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
    parser: "@typescript-eslint/parser",
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: ["@typescript-eslint"],
    ignorePatterns: ["benchmarks/*", "dist/*", "*/dist/*", "/examples/*", "tests/*", "*/tests/*", "build.js"],
    rules: {
      "linebreak-style": ["error", "unix"],
      quotes: ["error", "double"],
      semi: ["error", "always"],
    },
    overrides: [
      {
        files: ["*.cjs"],
        rules: {
          "no-undef": "off",
          "@typescript-eslint/no-var-requires": "off",
          "@typescript-eslint/no-require-imports": "off",
        },
      },
    ],
  }),
];
