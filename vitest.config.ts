import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["tests/setup.ts"],
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
      // Hard floor: `npm run coverage` (CI's Node 20 job) fails below 100% on every metric instead of
      // reporting a drop quietly — Codecov is not configured to enforce anything.
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
