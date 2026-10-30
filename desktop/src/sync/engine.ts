import { createHash } from "node:crypto";
import { type LinkState, type Local, type LocalFile, type Remote, RemoteError, type RemoteFile, type SyncStatus } from "./types";

/** The server's per-file limit (LIMITS.maxFileBytes). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const COPY = / \(my copy(?: \d+)?\)(?=\.[^.]*$|$)/;
/** Conflict copies stay on this computer: never uploaded, never downloaded. */
const isCopy = (p: string) => COPY.test(nameOf(p));

/** notes.md → "notes (my copy).md"; n > 1 → "notes (my copy 2).md". */
export function copyName(path: string, n = 1): string {
  const slash = path.lastIndexOf("/") + 1;
  const dot = path.lastIndexOf(".");
  const cut = dot > slash ? dot : path.length;
  return `${path.slice(0, cut)} (my copy${n > 1 ? ` ${n}` : ""})${path.slice(cut)}`;
}

type Action =
  | { kind: "download"; r: RemoteFile; to: string }
  | { kind: "conflict"; r: RemoteFile; l: LocalFile }
  | { kind: "trash"; l: LocalFile }
  | { kind: "upload"; l: LocalFile; to: string; base: number };

function errorStatus(e: unknown): Pick<SyncStatus, "kind" | "message"> {
  if (!(e instanceof RemoteError)) return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  if (e.kind === "offline") return { kind: "offline" };
  if (e.kind === "signed-out") return { kind: "error", message: "Sign in again to keep syncing" };
  if (e.kind === "busy") return { kind: "error", message: "The server is busy. Trying again soon." };
  return { kind: "error", message: e.message };
}

/**
 * One round of two-way sync. Compares each path's project version, folder version and last-synced version,
 * and records a path as synced only after its action succeeded, so a round cut short resumes next time.
 */
export async function syncOnce(remote: Remote, local: Local, state: LinkState, now: number, onSyncing?: (files: number) => void): Promise<{ state: LinkState; status: SyncStatus }> {
  const status = (s: Partial<SyncStatus>): SyncStatus => ({ kind: "synced", at: now, waiting: 0, conflicts: [], deletedHere: state.deletedHere, skipped: [], readOnly: false, ...s });
  const listed = await local.list();
  if (listed === "missing") return { state, status: status({ kind: "error", message: "Folder not found" }) };

  const conflicts: string[] = [];
  const skipped: SyncStatus["skipped"] = [];
  const locals = new Map<string, LocalFile>();
  const ignored = new Set<string>();
  for (const f of listed) {
    if (isCopy(f.path)) conflicts.push(f.path);
    else if (f.size > MAX_FILE_BYTES) {
      skipped.push({ path: f.path, reason: "too big" });
      ignored.add(f.path.toLowerCase());
    } else locals.set(f.path.toLowerCase(), f);
  }
  const takenLocal = new Set(listed.map((f) => f.path.toLowerCase()));

  let remotes: RemoteFile[];
  try {
    remotes = await remote.list();
  } catch (e) {
    const waiting = [...locals].filter(([k, l]) => state.synced[k]?.hash !== l.hash).length;
    return { state, status: status({ ...errorStatus(e), waiting, conflicts, skipped }) };
  }
  const byKey = new Map(remotes.filter((r) => !isCopy(r.path)).map((r) => [r.path.toLowerCase(), r]));

  const synced = { ...state.synced };
  const deletedHere: string[] = [];
  const first: Action[] = [];
  const uploads: Action[] = [];
  for (const k of new Set([...byKey.keys(), ...locals.keys(), ...Object.keys(synced)])) {
    if (ignored.has(k)) continue;
    const r = byKey.get(k);
    const l = locals.get(k);
    const s = synced[k];
    if (r && l) {
      if (r.hash === l.hash) synced[k] = { path: r.path, rev: r.rev, hash: r.hash };
      else if (s && l.hash === s.hash) first.push({ kind: "download", r, to: l.path });
      else if (s && r.hash === s.hash) uploads.push({ kind: "upload", l, to: r.path, base: r.rev });
      else first.push({ kind: "conflict", r, l });
    } else if (r) {
      if (!s || r.hash !== s.hash) first.push({ kind: "download", r, to: r.path });
      else deletedHere.push(r.path);
    } else if (l) {
      if (s && l.hash === s.hash) first.push({ kind: "trash", l });
      else uploads.push({ kind: "upload", l, to: l.path, base: 0 });
    } else delete synced[k];
  }

  const download = async (r: RemoteFile, to: string) => {
    await local.write(to, await remote.read(r.path));
    synced[r.path.toLowerCase()] = { path: r.path, rev: r.rev, hash: r.hash };
  };
  const actions = [...first, ...uploads];
  if (actions.length) onSyncing?.(actions.length);
  let readOnly = false;
  for (const [i, a] of actions.entries()) {
    try {
      if (a.kind === "download") await download(a.r, a.to);
      else if (a.kind === "conflict") {
        let n = 1;
        while (takenLocal.has(copyName(a.l.path, n).toLowerCase())) n++;
        const copy = copyName(a.l.path, n);
        await local.copy(a.l.path, copy);
        takenLocal.add(copy.toLowerCase());
        conflicts.push(copy);
        await download(a.r, a.l.path);
      } else if (a.kind === "trash") {
        await local.trash(a.l.path);
        delete synced[a.l.path.toLowerCase()];
      } else if (!readOnly) {
        // The hash of what was sent, not of the listed file: an edit made meanwhile goes up next round.
        const data = await local.read(a.l.path);
        const rev = await remote.save(a.to, data, a.base);
        synced[a.to.toLowerCase()] = { path: a.to, rev, hash: sha(data) };
      }
    } catch (e) {
      // ponytail: a local file another app holds open (or a parse error) is retried next round, not reported.
      if (!(e instanceof RemoteError)) continue;
      if (e.kind === "read-only") readOnly = true;
      else if (e.kind === "too-big" || e.kind === "rejected") skipped.push({ path: "l" in a ? a.l.path : a.r.path, reason: e.message });
      else if (e.kind !== "conflict") {
        const waiting = actions.slice(i).filter((x) => x.kind === "upload").length;
        return { state: { synced, deletedHere }, status: status({ ...errorStatus(e), waiting, conflicts, deletedHere, skipped }) };
      }
    }
  }
  return { state: { synced, deletedHere }, status: status({ conflicts, deletedHere, skipped, readOnly }) };
}

/** "Delete them in the project too". */
export async function confirmDeletes(remote: Remote, state: LinkState): Promise<LinkState> {
  const synced = { ...state.synced };
  for (const p of state.deletedHere) {
    await remote.remove(p);
    delete synced[p.toLowerCase()];
  }
  return { synced, deletedHere: [] };
}

/** "Bring them back": forgetting them makes the next round download them as new. */
export function restoreDeleted(state: LinkState): LinkState {
  const synced = { ...state.synced };
  for (const p of state.deletedHere) delete synced[p.toLowerCase()];
  return { synced, deletedHere: [] };
}
