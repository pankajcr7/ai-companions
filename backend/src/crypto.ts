import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretError extends Error {
  constructor() {
    super("This connection's saved secret can't be read; replace it");
  }
}

function key() {
  const k = Buffer.from(process.env.CREDENTIALS_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
  return k;
}

/** AES-256-GCM. Stored as v1:<iv>:<tag>:<ciphertext>, each part base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new SecretError();
  const k = key();
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new SecretError();
  }
}
