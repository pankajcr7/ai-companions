import { defineConfig } from "@playwright/test";

// Launches the built app (npm run build first) against a local stand-in for the live site.
export default defineConfig({ testDir: "test", testMatch: "*.e2e.ts", timeout: 60_000, workers: 1 });
