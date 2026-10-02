import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

const useTest = Boolean(process.env.USE_TEST_DB);
const testUrl = process.env.TEST_DATABASE_URL;
if (useTest && (!testUrl || testUrl === process.env.DATABASE_URL || testUrl === process.env.DIRECT_URL)) {
  throw new Error("Set TEST_DATABASE_URL in backend/.env to a separate database before running tests.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: useTest ? testUrl : (process.env.DIRECT_URL ?? process.env.DATABASE_URL) },
});
