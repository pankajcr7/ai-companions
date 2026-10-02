import { createHash } from "node:crypto";
import { exclusionReason } from "../files/rules.js";

export type MapEntry = { path: string; kind: "file" | "dir"; size: number; isText: boolean };
export type ProjectFile = MapEntry & { revision: number; blobHash: string | null };
export type Loaded = { path: string; revision: number; content: string };

export const FILE_BUDGET = 60_000;
export const SUMMARY_BUDGET = 80_000;
export const SHARED_CAP = 8_000;
export const DEP_RESULT_CAP = 8_000;
export const RESULT_CAP = 50_000;

export function cap(text: string, max: number, what: string): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated: the ${what} is longer than ${max} characters]` : text;
}

/** One line per file, sorted; past maxLines the rest is counted per top-level folder. */
export function projectMap(entries: MapEntry[], maxLines = 1500): string {
  const files = entries.filter((e) => e.kind === "file").sort((a, b) => a.path.localeCompare(b.path));
  const lines = files.slice(0, maxLines).map((f) => `${f.path} (${f.size} B${f.isText ? "" : ", binary"})`);
  const byDir = new Map<string, number>();
  for (const f of files.slice(maxLines)) {
    const dir = f.path.includes("/") ? f.path.split("/")[0] : ".";
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  for (const [dir, n] of byDir) lines.push(`... and ${n} more in ${dir}`);
  return lines.join("\n") || "(no files)";
}

/** Requested paths that exist and are text, in the order asked, until the budget is spent. */
export async function pickFiles(requested: string[], entries: ProjectFile[], budget: number, load: (hash: string) => Promise<string>) {
  const byLower = new Map(entries.map((e) => [e.path.toLowerCase(), e]));
  const files: Loaded[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const seen = new Set<string>();
  let left = budget;
  for (const raw of requested.slice(0, 30)) {
    const path = raw.trim().replace(/^(\.\/)+/, "");
    const entry = byLower.get(path.toLowerCase());
    if (!entry) {
      skipped.push({ path, reason: "not in the project" });
      continue;
    }
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    if (entry.kind !== "file" || !entry.isText || !entry.blobHash) {
      skipped.push({ path: entry.path, reason: "not a text file" });
      continue;
    }
    if (exclusionReason(entry.path, "file")) {
      skipped.push({ path: entry.path, reason: "not allowed" });
      continue;
    }
    const content = await load(entry.blobHash);
    if (content.length > left) {
      skipped.push({ path: entry.path, reason: "too large for the remaining budget" });
      continue;
    }
    left -= content.length;
    files.push({ path: entry.path, revision: entry.revision, content });
  }
  return { files, skipped };
}

export function sharedContext(parts: { brief?: string; brand?: string }): string {
  const text = [parts.brief ? `## .company/brief.md\n${parts.brief}` : "", parts.brand ? `## .company/brand.md\n${parts.brand}` : ""].filter(Boolean).join("\n\n");
  return text.length > SHARED_CAP ? `${text.slice(0, SHARED_CAP)}\n[truncated: the brief and brand files are longer than ${SHARED_CAP} characters]` : text;
}

/** Changes whenever any file is added, removed, renamed, or saved. */
export function revisionKey(rows: { pathLower: string; revision: number; kind: string }[]): string {
  const files = rows.filter((r) => r.kind === "file").map((r) => `${r.pathLower}:${r.revision}`).sort();
  return createHash("sha256").update(files.join("\n")).digest("hex");
}

export const filesBlock = (files: Loaded[]) => files.map((f) => `<file path="${f.path}">\n${f.content}\n</file>`).join("\n\n");
