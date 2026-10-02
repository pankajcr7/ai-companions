"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { collectFromDrop, collectFromInput, formatBytes, planUpload, uploadBatches, type Picked, type UploadResult } from "@/lib/projects";
import { useWorkspace } from "@/lib/workspace";

const field = "mt-1.5 w-full rounded-[10px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";

export function UploadDialog({ projectId, onClose, onDone }: { projectId?: string; onClose: () => void; onDone: (projectId: string) => void }) {
  const { snapshot } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const [picked, setPicked] = useState<{ files: Picked[]; dirs: string[]; source: "folder" | "files" } | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const plan = useMemo(() => (picked ? planUpload(picked.files, picked.dirs, include) : null), [picked, include]);
  const tops = useMemo(() => [...new Set(plan?.excluded.map((e) => e.top).filter((t): t is string => !!t))], [plan]);

  useEffect(() => {
    dialog.current?.showModal();
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const choose = (files: Picked[], dirs: string[], source: "folder" | "files") => {
    setZip(null);
    setPicked({ files, dirs, source });
    if (!projectId && !name) setName(source === "folder" ? (files[0]?.path.split("/")[0] ?? dirs[0]?.split("/")[0] ?? "") : "New project");
  };

  async function start() {
    setError("");
    cancelled.current = false;
    try {
      if (zip) {
        const form = new FormData();
        form.append("source", "zip");
        if (!projectId) form.append("name", name.trim());
        form.append("zip", zip, zip.name);
        setProgress([0, 1]);
        const url = projectId ? `/api/workspaces/${snapshot.workspace.id}/projects/${projectId}/upload` : `/api/workspaces/${snapshot.workspace.id}/projects/upload`;
        const res = await fetch(url, { method: "POST", body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error?.message ?? "Upload failed. Try again.");
        setProgress([1, 1]);
        setResult({ projectId: data.projectId, added: data.added, skipped: data.skipped, cancelled: false });
        return;
      }
      if (!plan || !picked) return;
      const r = await uploadBatches({
        workspaceId: snapshot.workspace.id,
        projectId,
        name: projectId ? undefined : name.trim(),
        source: picked.source,
        plan,
        onProgress: (d, t) => setProgress([d, t]),
        isCancelled: () => cancelled.current,
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  const busy = progress !== null && !result;
  const ready = !!(zip || (plan && (plan.included.length || plan.dirs.length))) && !!(projectId || name.trim());
  const btn = "rounded-[10px] px-4 py-2 text-sm font-semibold";

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="upload-title" className="m-auto w-[min(640px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-6 text-ink backdrop:bg-black/40">
      <h2 id="upload-title" className="text-xl font-semibold">{projectId ? "Upload into this project" : "Open a project"}</h2>
      {!result && (
        <>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const { files, dirs } = await collectFromDrop(e.dataTransfer.items);
              choose(files, dirs, dirs.length || files.some((f) => f.path.includes("/")) ? "folder" : "files");
            }}
            className="mt-4 grid place-items-center gap-3 rounded-[14px] border-2 border-dashed border-line p-6 text-center"
          >
            <p className="text-sm text-muted">Drop a folder or files here, or choose:</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => folderInput.current?.click()} className={`btn-dark ${btn}`}>Upload folder</button>
              <button type="button" onClick={() => zipInput.current?.click()} className={`btn-light ${btn}`}>Upload ZIP</button>
              <button type="button" onClick={() => filesInput.current?.click()} className={`btn-light ${btn}`}>Upload files</button>
            </div>
            <input ref={folderInput} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Choose a folder" onChange={(e) => e.target.files && choose(collectFromInput(e.target.files), [], "folder")} />
            <input ref={filesInput} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Choose files" onChange={(e) => e.target.files && choose(collectFromInput(e.target.files), [], "files")} />
            <input
              ref={zipInput}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose a ZIP file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setPicked(null);
                setZip(f);
                if (!projectId && !name) setName(f.name.replace(/\.zip$/i, ""));
              }}
            />
          </div>

          {!projectId && (zip || plan) && (
            <label className="mt-4 block text-sm font-medium">
              Project name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={field} />
            </label>
          )}

          {zip && <p className="mt-4 text-sm">{zip.name} ({formatBytes(zip.size)}). Files are checked on the server; you&apos;ll see what was skipped afterwards.</p>}

          {plan && (
            <div className="mt-4 space-y-3 text-sm">
              <p>
                <strong>{plan.included.length}</strong> files ({formatBytes(plan.bytes)}){plan.dirs.length ? `, ${plan.dirs.length} empty folders` : ""} will be uploaded.
              </p>
              <details>
                <summary className="cursor-pointer text-muted">Show included files</summary>
                <ul className="mt-2 max-h-40 overflow-auto rounded-[10px] bg-bg p-2 font-mono text-xs">
                  {plan.included.slice(0, 500).map((p) => <li key={p.path}>{p.path}</li>)}
                  {plan.included.length > 500 && <li>and {plan.included.length - 500} more</li>}
                </ul>
              </details>
              {plan.excluded.length > 0 && (
                <div>
                  <p>{plan.excluded.length} skipped:</p>
                  <ul className="mt-1 max-h-32 overflow-auto rounded-[10px] bg-bg p-2 text-xs">
                    {plan.excluded.slice(0, 200).map((e) => (
                      <li key={e.path}><span className="font-mono">{e.path}</span>: {e.reason}</li>
                    ))}
                  </ul>
                  {tops.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-3">
                      {tops.map((t) => (
                        <label key={t} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={include.has(t)}
                            onChange={(e) =>
                              setInclude((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(t);
                                else n.delete(t);
                                return n;
                              })
                            }
                          />
                          Include {t} folders
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {progress && (
            <div className="mt-4" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-bg">
                <div className="h-full bg-ink transition-all" style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">Uploading part {Math.min(progress[0] + 1, progress[1])} of {progress[1]}...</p>
            </div>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
          <div className="mt-6 flex justify-end gap-2">
            {busy ? (
              <button type="button" onClick={() => (cancelled.current = true)} className={`btn-light ${btn}`}>Cancel upload</button>
            ) : (
              <button type="button" onClick={() => dialog.current?.close()} className={`btn-light ${btn}`}>Cancel</button>
            )}
            <button type="button" disabled={!ready || busy} onClick={start} className={`btn-dark ${btn} disabled:opacity-60`}>Upload</button>
          </div>
        </>
      )}
      {result && (
        <div className="mt-4 space-y-3 text-sm">
          <p role="status">
            {result.cancelled ? "Upload cancelled." : "Upload finished."} {result.added} files added{result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.
          </p>
          {result.skipped.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-[10px] bg-bg p-2 text-xs">
              {result.skipped.map((s) => (
                <li key={s.path}><span className="font-mono">{s.path}</span>: {s.reason}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={() => (result.projectId ? onDone(result.projectId) : dialog.current?.close())} className={`btn-dark ${btn}`}>
              {result.projectId ? "Open project" : "Close"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export function createEmptyProject(workspaceId: string, name: string) {
  return api<{ id: string }>(`/api/workspaces/${workspaceId}/projects`, { method: "POST", body: { name } });
}
