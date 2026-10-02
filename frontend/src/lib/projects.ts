import { exclusionReason, normalizePath } from "./file-rules.ts";

export type ProjectSummary = { id: string; name: string; fileCount: number; totalBytes: number; updatedAt: string };
export type TreeEntry = { path: string; kind: "file" | "dir"; size: number; isText: boolean; revision: number; updatedAt: string };
export type Picked = { path: string; file: File };
export type Plan = { included: Picked[]; excluded: { path: string; reason: string; top: string | null }[]; dirs: string[]; bytes: number };
export type UploadResult = { projectId: string; added: number; skipped: { path: string; reason: string }[]; cancelled: boolean };

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function collectFromInput(files: FileList): Picked[] {
  return [...files].map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

/** Walks dropped folders recursively (DataTransfer entries), keeping empty folders. */
export async function collectFromDrop(items: DataTransferItemList): Promise<{ files: Picked[]; dirs: string[] }> {
  const files: Picked[] = [];
  const dirs: string[] = [];
  const readAll = (reader: FileSystemDirectoryReader) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const out: FileSystemEntry[] = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (!batch.length) return resolve(out);
          out.push(...batch);
          next();
        }, reject);
      next();
    });
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      files.push({ path, file });
    } else if (entry.isDirectory) {
      const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
      if (!children.length) dirs.push(path);
      for (const c of children) await walk(c, path);
    }
  };
  // Entries must be taken synchronously, before the first await, or the browser clears them.
  const roots = [...items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  for (const r of roots) await walk(r, "");
  return { files, dirs };
}

/** Same rules as the server, so the preview shows exactly what will be skipped. */
export function planUpload(files: Picked[], dirs: string[], include: Set<string>): Plan {
  const plan: Plan = { included: [], excluded: [], dirs: [], bytes: 0 };
  for (const p of files) {
    const n = normalizePath(p.path);
    if (!n.ok) {
      plan.excluded.push({ path: p.path, reason: n.reason, top: null });
      continue;
    }
    const reason = exclusionReason(n.path, "file");
    const top = reason?.endsWith("folders are excluded") ? reason.split(" ")[0] : null;
    if (reason && !(top && include.has(top))) {
      plan.excluded.push({ path: n.path, reason, top });
      continue;
    }
    plan.included.push({ path: n.path, file: p.file });
    plan.bytes += p.file.size;
  }
  plan.dirs = dirs.filter((d) => normalizePath(d).ok);
  return plan;
}

const BATCH_FILES = 100;
const BATCH_BYTES = 20 * 1024 * 1024;

export async function uploadBatches(opts: {
  workspaceId: string;
  projectId?: string;
  name?: string;
  source: "folder" | "files";
  plan: Plan;
  onProgress: (done: number, total: number) => void;
  isCancelled: () => boolean;
}): Promise<UploadResult> {
  const { plan } = opts;
  const batches: Picked[][] = [];
  let current: Picked[] = [];
  let size = 0;
  for (const p of plan.included) {
    if (current.length && (current.length >= BATCH_FILES || size + p.file.size > BATCH_BYTES)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.file.size;
  }
  if (current.length || !batches.length) batches.push(current);

  let projectId = opts.projectId;
  let importId: string | undefined;
  const result: UploadResult = { projectId: projectId ?? "", added: 0, skipped: [], cancelled: false };
  for (const [i, batch] of batches.entries()) {
    if (opts.isCancelled()) {
      result.cancelled = true;
      break;
    }
    const form = new FormData();
    form.append("source", opts.source);
    if (!projectId && opts.name) form.append("name", opts.name);
    if (importId) form.append("importId", importId);
    if (i === 0 && plan.dirs.length) form.append("dirs", JSON.stringify(plan.dirs));
    for (const p of batch) form.append(p.path, p.file, p.path.split("/").pop());
    const url = projectId ? `/api/workspaces/${opts.workspaceId}/projects/${projectId}/upload` : `/api/workspaces/${opts.workspaceId}/projects/upload`;
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = data?.error?.message ?? "Upload failed.";
      // A project this upload created is removed on failure, so a retry starts clean under the same name.
      if (!opts.projectId && projectId && importId) {
        await finish(opts.workspaceId, projectId, importId, "failed").catch(() => null);
        throw new Error(`${message} The new project was removed, so nothing was kept. Try again.`);
      }
      throw new Error(message);
    }
    projectId = data.projectId;
    importId = data.importId;
    result.projectId = data.projectId;
    result.added += data.added;
    result.skipped.push(...data.skipped);
    opts.onProgress(i + 1, batches.length);
  }
  if (projectId && importId) {
    const f = await finish(opts.workspaceId, projectId, importId, result.cancelled ? "cancelled" : "complete").catch(() => null);
    if (f?.deletedProject) result.projectId = "";
  }
  return result;
}

async function finish(workspaceId: string, projectId: string, importId: string, status: "complete" | "cancelled" | "failed") {
  const res = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/imports/${importId}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return (await res.json().catch(() => null)) as { deletedProject?: boolean } | null;
}

export const restorePrompt = (revision: number, unsaved: boolean) =>
  unsaved
    ? `Restore version ${revision}? Your unsaved changes will be replaced. The saved text becomes an older version.`
    : `Restore version ${revision}? Your current text becomes an older version, so nothing is lost.`;

export type ProjectSummaryInfo = { text: string; summarizedAt: string; stale: boolean };

export const BRIEF_TEMPLATE = `# Project brief

Shared with every companion working on this project.

## What we're making

## Who it's for

## The outcome we want

## Constraints
- Deadline:
- Must use:
- Must avoid:
`;

export const BRAND_TEMPLATE = `# Brand kit

Shared with every companion working on this project.

## Voice
- Sounds like:
- Banned words:

## Colors
- Primary: #
- Background: #
- Text: #

## Fonts
- Headings:
- Body:

## Do / don't
- Do:
- Don't:
`;
