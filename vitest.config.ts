import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.browser.test.ts"],
    testTimeout: 100_000,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        // Type-only at runtime (interfaces/type aliases only) — nothing to execute, always reports 0%.
        "src/interfaces.ts",
        "src/internal/InspectOptions.interface.ts",
        "src/core/features.ts",
        "src/env/environment.ts",
        // Exercised only by Playwright (browser IIFE bundle), which does not feed the v8 coverage run.
        "src/index.browser.ts",
      ],
      reporter: ["text", "lcov", "clover", "json"],
    },
  },
});
