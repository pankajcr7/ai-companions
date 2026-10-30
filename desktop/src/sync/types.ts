/** A file in the project, as the server lists it. */
export type RemoteFile = { path: string; rev: number; hash: string; size: number };
/** A file in the linked folder. */
export type LocalFile = { path: string; hash: string; size: number };

export type RemoteErrorKind = "offline" | "signed-out" | "read-only" | "conflict" | "busy" | "too-big" | "rejected" | "failed";

export class RemoteError extends Error {
  constructor(
    readonly kind: RemoteErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface Remote {
  list(): Promise<RemoteFile[]>;
  read(path: string): Promise<Buffer>;
  /** Returns the new revision. baseRev 0 creates the file. */
  save(path: string, data: Buffer, baseRev: number): Promise<number>;
  remove(path: string): Promise<void>;
}

export interface Local {
  list(): Promise<LocalFile[] | "missing">;
  read(path: string): Promise<Buffer>;
  /** Creates parent folders; returns the written content's hash. */
  write(path: string, data: Buffer): Promise<string>;
  /** To the Trash / Recycle Bin, never a permanent delete. */
  trash(path: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

/** What both sides looked like at the last sync, per lower-case path. */
export type LinkState = {
  synced: Record<string, { path: string; rev: number; hash: string }>;
  deletedHere: string[];
};

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
