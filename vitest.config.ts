import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/1_json.browser.test.ts", "tests/runtime.browser.test.ts"],
    testTimeout: 100_000,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/internal/util.inspect.polyfill.ts", "src/interfaces.ts", "src/internal/InspectOptions.interface.ts", "src/index.browser.ts"],
      reporter: ["text", "lcov", "clover", "json"],
    },
  },
});
