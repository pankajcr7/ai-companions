import { defineConfig } from "vitest/config";

// For tests that never touch the database: no global setup, so they can run while a database suite is running.
// USE_TEST_DB anyway: a test that does reach the database must never land in the main one.
export default defineConfig({ test: { env: { ALLOW_LOCAL_ENDPOINTS: "true", USE_TEST_DB: "1" }, testTimeout: 60_000 } });
