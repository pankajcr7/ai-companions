"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FolderSimple } from "@phosphor-icons/react";
import { desktopBridge, type FolderLink, statusNotes, statusText, type SyncStatus } from "@/lib/desktop";

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const never = () => () => {};

/** Desktop app only: links the project to a folder on this computer and shows how the sync is going. */
export function FolderSync({ workspaceId, projectId, projectName, editable, onSynced }: { workspaceId: string; projectId: string; projectName: string; editable: boolean; onSynced: () => void }) {
  const desk = useSyncExternalStore(never, desktopBridge, () => null);
  const [link, setLink] = useState<FolderLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!desk) return;
    let last: SyncStatus["kind"] | undefined;
    void desk.linkOf(projectId).then(setLink);
    const off = desk.onStatus((id, status) => {
      if (id !== projectId) return;
      // A round that moved files is over: the file list may have changed.
      if (last === "syncing" && status.kind === "synced") onSynced();
      last = status.kind;
      setNow(Date.now());
      setLink((l) => l && { ...l, status });
    });
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, [desk, projectId, onSynced]);

  if (!desk) return null;

  async function pick() {
    setError("");
    const folder = await desk!.pickFolder();
    if (!folder) return;
    setBusy(true);
    try {
      setLink({ folder, status: await desk!.link({ workspaceId, projectId, projectName, folder }) });
      onSynced();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    await desk!.unlink(projectId);
    setLink(null);
  }

  const status = link?.status;
  const btn = "rounded-[8px] px-2.5 py-1 font-semibold hover:bg-bg";
  return (
    <section aria-label="Folder sync" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-paper px-4 py-2 text-sm">
      <FolderSimple size={16} aria-hidden="true" className="shrink-0 text-muted" />
      {!link ? (
        <>
          <button onClick={pick} disabled={busy} className="btn-light rounded-[10px] px-3 py-1.5 font-semibold disabled:opacity-60">
            Sync with a folder on this computer
          </button>
          <span role="status" className="text-muted">{busy ? "Linking and copying files…" : "Edits on either side follow each other, and the folder keeps working offline."}</span>
        </>
      ) : (
        <>
          <span className="font-medium" title={link.folder}>{folderName(link.folder)}</span>
          <span role="status" className={status?.kind === "error" ? "text-[#b42318]" : "text-muted"}>{status ? statusText(status, now) : "Starting…"}</span>
          <span className="ml-auto flex gap-1">
            <button onClick={() => void desk.openFolder(projectId)} className={btn}>Open folder</button>
            <button onClick={stop} className={btn}>Stop syncing</button>
          </span>
          {status && statusNotes(status).length > 0 && (
            <ul className="w-full space-y-0.5 text-[#b54708]">
              {statusNotes(status).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {status && status.deletedHere.length > 0 && (
            <div className="flex w-full flex-wrap gap-2">
              {editable && (
                <button onClick={() => void desk.confirmDeletes(projectId)} className="rounded-[10px] px-3 py-1.5 font-semibold text-[#b42318] hover:bg-bg">
                  Delete them in the project too
                </button>
              )}
              <button onClick={() => void desk.restoreDeleted(projectId)} className="btn-light rounded-[10px] px-3 py-1.5 font-semibold">Bring them back</button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="w-full text-[#b42318]">{error}</p>}
    </section>
  );
}
