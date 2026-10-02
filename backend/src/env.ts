try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment. Values already set in the shell win.
}

if (process.env.USE_TEST_DB) {
  const url = process.env.TEST_DATABASE_URL;
  // Remember the real main URL once, so re-running this (or inheriting a switched env) still guards it.
  const main = (process.env.MAIN_DATABASE_URL ??= process.env.DATABASE_URL);
  if (!url || url === main || url === process.env.DIRECT_URL) {
    throw new Error("Set TEST_DATABASE_URL in backend/.env to a separate database before running tests.");
  }
  process.env.DATABASE_URL = url;
}
