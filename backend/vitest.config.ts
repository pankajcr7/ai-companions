import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { USE_TEST_DB: "1", ALLOW_LOCAL_ENDPOINTS: "true", CHATGPT_LOCAL_LOGIN: "true" },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
