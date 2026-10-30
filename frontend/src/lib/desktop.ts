// The desktop app (desktop/) gives its window `window.agentDesktop`; in a normal browser it's absent.
// SyncStatus mirrors desktop/src/sync/types.ts.

export type SyncStatus = {
  kind: "synced" | "syncing" | "offline" | "error";
  at: number;
  /** Offline: local changes waiting to be sent. Syncing: files in this round. */
  waiting: number;
  conflicts: string[];
  deletedHere: string[];
  skipped: { path: string; reason: string }[];
  readOnly: boolean;
  message?: string;
};

export type FolderLink = { folder: string; status: SyncStatus | null };

export type AgentDesktop = {
  version: string;
  pickFolder(): Promise<string | null>;
  link(o: { workspaceId: string; projectId: string; projectName: string; folder: string }): Promise<SyncStatus>;
  unlink(projectId: string): Promise<void>;
  linkOf(projectId: string): Promise<FolderLink | null>;
  onStatus(cb: (projectId: string, status: SyncStatus) => void): () => void;
  openFolder(projectId: string): Promise<void>;
  confirmDeletes(projectId: string): Promise<void>;
  restoreDeleted(projectId: string): Promise<void>;
};

export const desktopBridge = (): AgentDesktop | null => (typeof window === "undefined" ? null : ((window as { agentDesktop?: AgentDesktop }).agentDesktop ?? null));

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function statusText(s: SyncStatus, now: number): string {
  if (s.kind === "error") return s.message ?? "Sync stopped";
  if (s.kind === "offline") return s.waiting ? `Offline: ${count(s.waiting, "change")} waiting` : "Offline";
  if (s.kind === "syncing") return `Syncing ${count(s.waiting, "file")}…`;
  const minutes = Math.floor((now - s.at) / 60_000);
  return minutes < 1 ? "Synced just now" : `Synced ${count(minutes, "minute")} ago`;
}

/** Lines that need the owner's attention, most important first. */
export function statusNotes(s: SyncStatus): string[] {
  const notes: string[] = [];
  if (s.readOnly) notes.push("You can view this project; your changes stay on this computer.");
  if (s.conflicts.length) notes.push(`${count(s.conflicts.length, "conflict")}: ${s.conflicts.join(", ")}`);
  if (s.deletedHere.length) notes.push(`${count(s.deletedHere.length, "file")} deleted on this computer`);
  notes.push(...s.skipped.slice(0, 3).map((k) => `${k.path} skipped: ${k.reason}`));
  if (s.skipped.length > 3) notes.push(`and ${s.skipped.length - 3} more skipped`);
  return notes;
}
