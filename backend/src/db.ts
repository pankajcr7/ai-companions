import "./env.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Copy .env.example to backend/.env and fill it in.");

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Either the root client or an interactive-transaction client. */
export type Db = typeof prisma | Prisma.TransactionClient;
