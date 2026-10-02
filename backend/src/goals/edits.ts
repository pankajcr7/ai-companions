import { z } from "zod";
import { exclusionReason, LIMITS, normalizePath, PRIVATE_KEY } from "../files/rules.js";

const EditList = z.object({
  edits: z
    .array(z.object({ path: z.string().min(1).max(1024), content: z.string().max(LIMITS.maxEditorBytes), note: z.string().max(500).optional().default("") }))
    .max(10),
});
export type RawEdit = { path: string; content: string; note: string };

/** Separates a task reply into the visible result and its trailing edits block, if any. */
export function splitEdits(text: string): { visible: string; edits: RawEdit[]; error: string | null } {
  const last = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1);
  if (!last || last.index === undefined || !/"edits"\s*:/.test(last[1])) return { visible: text.trim(), edits: [], error: null };
  const visible = (text.slice(0, last.index) + text.slice(last.index + last[0].length)).trim();
  try {
    return { visible, edits: EditList.parse(JSON.parse(last[1])).edits, error: null };
  } catch {
    return { visible, edits: [], error: "The proposed edits couldn't be read, so none were saved." };
  }
}

export type EditCheck = { path: string; baseRevision: number; status: "pending" | "rejected"; reason: string | null };

/** Upload rules apply; changing an existing file requires that the task read it, and the edit is based on that revision. */
export function checkEdit(
  edit: RawEdit,
  read: Map<string, { path: string; revision: number }>,
  existing: Map<string, { path: string; kind: "file" | "dir"; revision: number }>,
): EditCheck {
  const reject = (path: string, reason: string): EditCheck => ({ path, baseRevision: 0, status: "rejected", reason });
  const n = normalizePath(edit.path);
  if (!n.ok) return reject(edit.path, `invalid path: ${n.reason}`);
  const excluded = exclusionReason(n.path, "file");
  if (excluded) return reject(n.path, excluded);
  if (PRIVATE_KEY.test(edit.content)) return reject(n.path, "contains a private key");
  if (Buffer.byteLength(edit.content, "utf8") > LIMITS.maxEditorBytes) return reject(n.path, "larger than 1 MB");
  const lower = n.path.toLowerCase();
  const current = existing.get(lower);
  if (current?.kind === "dir") return reject(current.path, "a folder has this name");
  if (!current) return { path: n.path, baseRevision: 0, status: "pending", reason: null };
  const seen = read.get(lower);
  if (!seen) return reject(current.path, "the companion didn't read this file");
  return { path: current.path, baseRevision: seen.revision, status: "pending", reason: null };
}
