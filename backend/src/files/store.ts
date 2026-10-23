import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../db.js";

// The only module that touches file storage. Contents live in the database because the free host's disk is wiped on
// every restart; files saved on disk before that move are still read from there.
// ponytail: contents in Postgres (Neon's free plan holds 0.5 GB in all); move to object storage (R2) when projects outgrow it.
const root = () => process.env.FILES_DIR || fileURLToPath(new URL("../../data/blobs/", import.meta.url));

export const hashOf = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

function pathFor(hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("invalid blob id");
  return join(root(), hash.slice(0, 2), hash);
}

export async function putBlob(buf: Buffer): Promise<string> {
  const hash = hashOf(buf);
  await prisma.blob.createMany({ data: [{ hash, data: new Uint8Array(buf) }], skipDuplicates: true });
  return hash;
}

export async function getBlob(hash: string): Promise<Buffer> {
  const onDisk = pathFor(hash);
  const row = await prisma.blob.findUnique({ where: { hash } });
  return row ? Buffer.from(row.data) : readFile(onDisk);
}

export function isTextContent(buf: Buffer): boolean {
  if (buf.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
