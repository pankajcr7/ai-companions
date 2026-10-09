"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/projects";
import type { AttachmentDTO } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files sent with a message: image thumbnails (click for full size) and file cards, each with Save to project. */
export function AttachmentList({ items, canSave }: { items: AttachmentDTO[]; canSave: boolean }) {
  const [viewing, setViewing] = useState<AttachmentDTO | null>(null);
  const [saving, setSaving] = useState<AttachmentDTO | null>(null);
  if (!items.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {items.map((a) =>
        a.kind === "image" ? (
          <figure key={a.id} className="m-0">
            <button type="button" onClick={() => setViewing(a)} className="block overflow-hidden rounded-[10px] border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- private uploads and local previews, not optimisable */}
              <img src={a.viewUrl} alt={a.name} className="h-24 w-auto max-w-48 object-cover" />
            </button>
            {canSave && <button type="button" onClick={() => setSaving(a)} className="mt-1 text-[11px] underline">Save to project</button>}
          </figure>
        ) : (
          <div key={a.id} className="flex items-center gap-2 rounded-[10px] border border-line bg-paper px-2.5 py-2 text-xs">
            <FileText size={20} className="shrink-0 text-muted" />
            <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0">
              <span className="block truncate font-medium">{a.name}</span>
              <span className="block text-muted">{size(a.size)}{a.pages ? ` · ${a.pages} page${a.pages === 1 ? "" : "s"}` : ""}{a.scanned ? " · scanned, no text" : ""}</span>
            </a>
            {canSave && <button type="button" onClick={() => setSaving(a)} className="shrink-0 underline">Save to project</button>}
          </div>
        ),
      )}
      {viewing && <ImageDialog item={viewing} onClose={() => setViewing(null)} />}
      {saving && <SaveDialog item={saving} onClose={() => setSaving(null)} />}
    </div>
  );
}

function ImageDialog({ item, onClose }: { item: AttachmentDTO; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current?.showModal(), []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-label={item.name} className="m-auto max-h-[90dvh] max-w-[min(1100px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-3 text-ink backdrop:bg-black/60">
      {/* eslint-disable-next-line @next/next/no-img-element -- private uploads and local previews, not optimisable */}
      <img src={item.url} alt={item.name} className="max-h-[78dvh] w-auto" />
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className="truncate">{item.name}</span>
        <span className="flex gap-2">
          <a href={item.url} download={item.name} className="underline">Download</a>
          <button type="button" onClick={() => dialog.current?.close()} className="underline">Close</button>
        </span>
      </div>
    </dialog>
  );
}

function SaveDialog({ item, onClose }: { item: AttachmentDTO; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [pid, setPid] = useState("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const listPath = wsPath("/projects");
  useEffect(() => {
    dialog.current?.showModal();
    api<{ projects: ProjectSummary[] }>(listPath).then(
      (r) => {
        setProjects(r.projects);
        setPid(r.projects[0]?.id ?? "");
      },
      (e: Error) => setError(e.message),
    );
  }, [listPath]);
  async function save() {
    setError("");
    try {
      const r = await api<{ path: string }>(wsPath(`/attachments/${item.id}/save`), { method: "POST", body: { projectId: pid } });
      setDone(`Saved as ${r.path}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="save-att-title" className="m-auto w-[min(420px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-5 text-ink backdrop:bg-black/40">
      <h2 id="save-att-title" className="font-semibold">Save {item.name} to a project</h2>
      {projects && projects.length === 0 && <p className="mt-2 text-sm text-muted">You don&apos;t have any projects yet.</p>}
      {projects && projects.length > 0 && (
        <label className="mt-3 block text-sm">
          Project
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="mt-1 w-full rounded-[10px] border border-line bg-paper px-3 py-2">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      {done && <p role="status" className="mt-3 text-sm">{done}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-[#b42318]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => dialog.current?.close()} className="rounded-[10px] px-4 py-2 text-sm font-semibold hover:bg-bg">Close</button>
        {!done && <button type="button" disabled={!pid} onClick={save} className="btn-dark rounded-[10px] px-4 py-2 text-sm font-semibold disabled:opacity-60">Save</button>}
      </div>
    </dialog>
  );
}
