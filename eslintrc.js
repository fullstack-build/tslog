// This is a workaround for https://github.com/eslint/eslint/issues/3458
require("@rushstack/eslint-config/patch-eslint6");

module.exports = {
  plugins: ["prettier"],
  rules: {
    "prettier/prettier": "error",
    "eqeqeq": [2, "smart"]
  },
  extends: ["@rushstack/eslint-config", "plugin:prettier/recommended"],
  "ignorePatterns": ["node_modules/", "dist/", "tests", "*.test.ts"],
  env: {
    node: true
  }
};