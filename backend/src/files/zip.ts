import { Unzip, UnzipInflate, zipSync } from "fflate";
import { LIMITS } from "./rules.js";

export type ZipEntry = { path: string; data: Buffer; isDir: boolean };
export class ZipLimitError extends Error {}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Streaming read that counts real expanded bytes, so a ZIP lying about its sizes can't
 * expand past the limits. No filesystem paths are created here; callers validate names.
 */
export function readZip(buf: Buffer, limits: Pick<typeof LIMITS, "maxEntries" | "maxTotalBytes" | "maxFileBytes"> = LIMITS): ZipEntry[] {
  // Every ZIP ends with an end-of-central-directory record; without it the file is corrupt or truncated.
  if (buf.length < 22 || buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) === -1) throw new ZipLimitError("That ZIP file couldn't be read");
  const out: ZipEntry[] = [];
  let total = 0;
  let failure: Error | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (failure) return;
    if (out.length >= limits.maxEntries) {
      failure = new ZipLimitError(`The ZIP has more than ${limits.maxEntries} entries`);
      return;
    }
    if (file.name.endsWith("/")) {
      out.push({ path: file.name, data: Buffer.alloc(0), isDir: true });
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = new ZipLimitError("That ZIP file couldn't be read");
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > limits.maxFileBytes) {
        failure = new ZipLimitError(`${file.name} is larger than ${mb(limits.maxFileBytes)}`);
        file.terminate();
        return;
      }
      if (total > limits.maxTotalBytes) {
        failure = new ZipLimitError(`The ZIP expands to more than ${mb(limits.maxTotalBytes)}`);
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) out.push({ path: file.name, data: Buffer.concat(chunks), isDir: false });
    };
    file.start();
  };
  try {
    unzip.push(new Uint8Array(buf), true);
  } catch {
    throw new ZipLimitError("That ZIP file couldn't be read");
  }
  if (failure) throw failure;
  return out;
}

export function writeZip(entries: { path: string; data?: Buffer; isDir: boolean }[]): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) files[e.isDir ? `${e.path}/` : e.path] = e.isDir ? new Uint8Array() : new Uint8Array(e.data ?? Buffer.alloc(0));
  return Buffer.from(zipSync(files, { level: 6 }));
}
