import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { USE_TEST_DB: "1" },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
