import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.browser.test.ts",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:4444",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: {
    command: "npm run test-browser-serve",
    port: 4444,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
