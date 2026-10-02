"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { restorePrompt } from "@/lib/projects";

type Rev = { id: string; revision: number; reason: string; size: number; fromPath: string | null; createdAt: string; createdBy: string };
const REASON: Record<string, string> = { upload: "Uploaded", edit: "Edited", restore: "Restored", rename: "Renamed" };

export function HistoryPanel({ path, base, editable, unsaved, onRestored, onClose }: { path: string; base: string; editable: boolean; unsaved: boolean; onRestored: () => void; onClose: () => void }) {
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const q = `path=${encodeURIComponent(path)}`;

  useEffect(() => {
    api<{ revisions: Rev[] }>(`${base}/history?${q}`).then(
      (r) => setRevs(r.revisions),
      (e) => setError((e as Error).message),
    );
  }, [base, q]);

  async function restore(r: Rev) {
    if (!confirm(restorePrompt(r.revision, unsaved))) return;
    try {
      await api(`${base}/restore`, { method: "POST", body: { path, revisionId: r.id } });
      onRestored();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <aside aria-label="File history" className="flex h-full flex-col border-l border-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">History</h2>
        <button onClick={onClose} className="rounded-[8px] px-2 py-1 text-sm hover:bg-bg">Close</button>
      </div>
      <p className="truncate text-xs text-muted">{path}</p>
      {error && <p role="alert" className="mt-2 text-sm text-[#b42318]">{error}</p>}
      {!revs && !error && <p className="mt-3 text-sm text-muted" aria-busy="true">Loading versions...</p>}
      <ul className="mt-3 space-y-2 overflow-auto text-sm">
        {revs?.map((r, i) => (
          <li key={r.id} className="rounded-[10px] border border-line p-2.5">
            <p className="font-medium">Version {r.revision}{i === 0 ? " (current)" : ""}</p>
            <p className="text-xs text-muted">
              {REASON[r.reason] ?? r.reason}{r.fromPath ? ` from ${r.fromPath}` : ""} by {r.createdBy}, {new Date(r.createdAt).toLocaleString()}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => api<{ content: string }>(`${base}/history/${r.id}`).then((v) => setPreview({ id: r.id, content: v.content }), (e) => setError((e as Error).message))}
                className="btn-light rounded-[8px] px-2.5 py-1 text-xs font-semibold"
              >
                View
              </button>
              {editable && i > 0 && <button onClick={() => restore(r)} className="btn-dark rounded-[8px] px-2.5 py-1 text-xs font-semibold">Restore</button>}
            </div>
            {preview?.id === r.id && <pre className="mt-2 max-h-48 overflow-auto rounded-[8px] bg-bg p-2 text-xs">{preview.content}</pre>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
