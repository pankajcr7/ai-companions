import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: { baseURL: "http://localhost:3100", channel: "chrome", trace: "retain-on-failure" },
  webServer: [
    { command: "npm --prefix ../backend run dev:test", url: "http://127.0.0.1:4100/health", reuseExistingServer: false, timeout: 60_000 },
    {
      command: "npx next build && npx next start -p 3100",
      url: "http://localhost:3100",
      env: { BACKEND_URL: "http://127.0.0.1:4100", NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
