import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import pg from "pg";

/** Bring the test database to the latest migration and empty every table. Owner-approved: test DB only. */
export async function resetTestDb() {
  // Prisma's config picks the test DB itself; give it the environment before env.js rewrites DATABASE_URL.
  const prismaEnv = { ...process.env, USE_TEST_DB: "1" };
  process.env.USE_TEST_DB = "1";
  await import("../src/env.js"); // points DATABASE_URL at TEST_DATABASE_URL, refuses if it equals the main DB
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: prismaEnv });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> '_prisma_migrations'",
    );
    if (rows.length) await client.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await resetTestDb();
