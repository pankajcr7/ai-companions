import "./env.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Copy .env.example to backend/.env and fill it in.");

// Interactive transactions default to 5 s, which a far-away database (about 250 ms per query) can exceed.
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  transactionOptions: { timeout: 20_000, maxWait: 10_000 },
});

/** Either the root client or an interactive-transaction client. */
export type Db = typeof prisma | Prisma.TransactionClient;
