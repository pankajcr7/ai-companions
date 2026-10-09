import { defineConfig } from "@playwright/test";

// Isolated UI checks use mocked APIs, so they never reset or change a database.
export default defineConfig({
  testDir: "e2e",
  testMatch: "dashboard.spec.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 2,
  use: { baseURL: "http://localhost:3200", channel: "chrome", trace: "retain-on-failure" },
  webServer: {
    command: "npx next dev -p 3200",
    url: "http://localhost:3200",
    env: { NEXT_DIST_DIR: ".next-ui" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
