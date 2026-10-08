import { defineConfig } from "vitest/config";

// For tests that never touch the database: no global setup, so they can run while a database suite is running.
export default defineConfig({ test: { env: { ALLOW_LOCAL_ENDPOINTS: "true" }, testTimeout: 60_000 } });
