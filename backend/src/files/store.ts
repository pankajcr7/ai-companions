import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The only module that touches file storage. Swap for S3/R2 here.
const root = () => process.env.FILES_DIR || fileURLToPath(new URL("../../data/blobs/", import.meta.url));

export const hashOf = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

function pathFor(hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("invalid blob id");
  return join(root(), hash.slice(0, 2), hash);
}

export async function putBlob(buf: Buffer): Promise<string> {
  const hash = hashOf(buf);
  const target = pathFor(hash);
  try {
    await stat(target);
    return hash;
  } catch {
    // not stored yet
  }
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, target);
  return hash;
}

export const getBlob = async (hash: string) => readFile(pathFor(hash));

export function isTextContent(buf: Buffer): boolean {
  if (buf.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
