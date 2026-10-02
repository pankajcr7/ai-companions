"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DownloadSimple, FilePlus, FolderPlus, UploadSimple } from "@phosphor-icons/react";
import { api, ApiError } from "@/lib/api";
import { formatBytes, type ProjectSummary, type ProjectSummaryInfo, type TreeEntry } from "@/lib/projects";
import { canAdmin, canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { FileTree, type TreeAction } from "@/components/app/files/FileTree";
import { SummaryBox } from "@/components/app/files/SummaryBox";
import { HistoryPanel } from "@/components/app/files/HistoryPanel";
import { UploadDialog } from "@/components/app/files/UploadDialog";

const CodeEditor = dynamic(() => import("@/components/app/files/CodeEditor").then((m) => m.CodeEditor), { ssr: false, loading: () => <div className="h-full animate-pulse bg-bg" /> });

type Open = { path: string; kind: "text"; content: string; saved: string; revision: number } | { path: string; kind: "image" | "binary"; size: number };
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const q = (p: string) => `path=${encodeURIComponent(p)}`;
const inside = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);

export default function ProjectWorkspace() {
  const { snapshot, wsPath } = useWorkspace();
  const { pid } = useParams<{ pid: string }>();
  const router = useRouter();
  const base = wsPath(`/projects/${pid}`);
  const editable = canEdit(snapshot.role);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [summary, setSummary] = useState<ProjectSummaryInfo | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pane, setPane] = useState<"tree" | "editor">("tree");
  const theme = snapshot.preferences.theme;
  const dark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const loadTree = useCallback(
    () =>
      api<{ project: ProjectSummary; entries: TreeEntry[]; summary: ProjectSummaryInfo | null }>(`${base}/tree`).then((r) => {
        setProject(r.project);
        setEntries(r.entries);
        setSummary(r.summary);
      }),
    [base],
  );
  useEffect(() => {
    loadTree().catch((e) => setNotice((e as Error).message));
  }, [loadTree]);

  const dirty = open?.kind === "text" && open.content !== open.saved;

  async function openFile(path: string, force = false) {
    if (!force && dirty && !confirm("You have unsaved changes. Discard them?")) return;
    setConflict(false);
    setNotice("");
    setPane("editor");
    const entry = entries.find((e) => e.path === path);
    if (IMAGE.test(path)) return setOpen({ path, kind: "image", size: entry?.size ?? 0 });
    try {
      const f = await api<{ content: string; revision: number }>(`${base}/files?${q(path)}`);
      setOpen({ path, kind: "text", content: f.content, saved: f.content, revision: f.revision });
    } catch (e) {
      if (e instanceof ApiError && e.status === 415) setOpen({ path, kind: "binary", size: entry?.size ?? 0 });
      else setNotice((e as Error).message);
    }
  }

  async function save() {
    if (open?.kind !== "text" || busy || !editable) return;
    const sent = open;
    setBusy(true);
    try {
      const r = await api<{ revision: number }>(`${base}/files`, { method: "PUT", body: { path: sent.path, content: sent.content, baseRevision: sent.revision } });
      // Keep anything typed while the save was in flight; only the sent text counts as saved.
      setOpen((o) => (o?.kind === "text" && o.path === sent.path ? { ...o, saved: sent.content, revision: r.revision } : o));
      setNotice(`Saved version ${r.revision}.`);
      await loadTree();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(kind: TreeAction, path: string | null) {
    setNotice("");
    try {
      if (kind === "download" && path) {
        const a = document.createElement("a");
        a.href = `${base}/download?${q(path)}`;
        a.click();
      }
      if (kind === "history" && path) setHistory(path);
      if (kind === "upload") setUploading(true);
      if (kind === "newFile" || kind === "newFolder") {
        const name = prompt(kind === "newFile" ? "New file name (for example notes.md)" : "New folder name");
        if (!name?.trim()) return;
        const target = path ? `${path}/${name.trim()}` : name.trim();
        if (kind === "newFile") {
          await api(`${base}/files`, { method: "PUT", body: { path: target, content: "", baseRevision: 0 } });
          await loadTree();
          await openFile(target);
        } else {
          await api(`${base}/folders`, { method: "POST", body: { path: target } });
          await loadTree();
        }
      }
      if (kind === "rename" && path) {
        const to = prompt("New path", path);
        if (!to?.trim() || to.trim() === path) return;
        if (open && inside(open.path, path) && dirty && !confirm("You have unsaved changes in the open file. Discard them?")) return;
        await api(`${base}/move`, { method: "POST", body: { from: path, to: to.trim() } });
        if (open && inside(open.path, path)) setOpen(null);
        await loadTree();
      }
      if (kind === "delete" && path) {
        if (!confirm(`Delete ${path}? Its history is deleted too.`)) return;
        await api(`${base}/entries?${q(path)}`, { method: "DELETE" });
        if (open && inside(open.path, path)) setOpen(null);
        await loadTree();
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function deleteProject() {
    if (!confirm(`Delete the project ${project?.name}? This can't be undone.`)) return;
    try {
      await api(base, { method: "DELETE" });
      router.push(projectsHref);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  const projectsHref = `/w/${snapshot.workspace.slug}/projects`;
  const iconBtn = "rounded-[8px] p-1.5 hover:bg-bg";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-3">
        <Link href={projectsHref} className="text-sm text-muted hover:underline">Projects</Link>
        <span className="text-muted">/</span>
        <h1 className="mr-auto truncate font-semibold">{project?.name ?? "Project"}</h1>
        {project && <span className="text-xs text-muted">{project.fileCount} files · {formatBytes(project.totalBytes)}</span>}
        <a href={`${base}/download.zip`} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><DownloadSimple size={14} /> Download ZIP</a>
        {canAdmin(snapshot.role) && <button onClick={deleteProject} className="rounded-[10px] px-3 py-2 text-sm font-semibold text-[#b42318] hover:bg-bg">Delete project</button>}
      </div>
      {notice && <p role="status" className="bg-bg px-4 py-2 text-sm">{notice}</p>}
      <div className="flex gap-1 border-b border-line p-1 lg:hidden" role="group" aria-label="View">
        {(["tree", "editor"] as const).map((p) => (
          <button key={p} aria-pressed={pane === p} onClick={() => setPane(p)} className={`flex-1 rounded-[8px] py-1.5 text-sm ${pane === p ? "bg-ink text-paper" : ""}`}>
            {p === "tree" ? "Files" : "Editor"}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <section aria-label="Files" className={`${pane === "tree" ? "flex" : "hidden"} w-full flex-col border-r border-line bg-paper lg:flex lg:w-72`}>
          <div className="flex items-center gap-1 border-b border-line p-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Filter files</span>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" className="w-full rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-sm" />
            </label>
            {editable && (
              <>
                <button aria-label="New file" title="New file" onClick={() => act("newFile", null)} className={iconBtn}><FilePlus size={16} /></button>
                <button aria-label="New folder" title="New folder" onClick={() => act("newFolder", null)} className={iconBtn}><FolderPlus size={16} /></button>
                <button aria-label="Upload into project" title="Upload into project" onClick={() => act("upload", null)} className={iconBtn}><UploadSimple size={16} /></button>
              </>
            )}
          </div>
          <SummaryBox
            base={base}
            summary={summary}
            editable={editable}
            hasBrief={entries.some((e) => e.path.toLowerCase() === ".company/brief.md")}
            hasBrand={entries.some((e) => e.path.toLowerCase() === ".company/brand.md")}
            onChanged={loadTree}
            onOpenFile={(p) => openFile(p)}
          />
          <div className="min-h-0 flex-1 overflow-auto p-1">
            <FileTree entries={entries} selected={open?.path ?? null} filter={filter} editable={editable} onOpen={(p) => openFile(p)} onAction={act} />
          </div>
        </section>
        <section aria-label="Editor" className={`${pane === "editor" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>
          {!open && <p className="m-auto p-6 text-sm text-muted">Choose a file to open it.</p>}
          {open && (
            <>
              <div className="flex items-center gap-2 border-b border-line bg-paper px-3 py-2">
                <p className="min-w-0 flex-1 truncate font-mono text-sm">{open.path}{dirty ? " (unsaved)" : ""}</p>
                {open.kind === "text" && <button onClick={() => setHistory(open.path)} className="rounded-[8px] px-2.5 py-1.5 text-sm hover:bg-bg">History</button>}
                {open.kind === "text" && editable && (
                  <button disabled={!dirty || busy} onClick={save} className="btn-dark rounded-[10px] px-3 py-1.5 text-sm font-semibold disabled:opacity-60">{busy ? "Saving..." : "Save"}</button>
                )}
              </div>
              {conflict && open.kind === "text" && (
                <div role="alert" className="flex flex-wrap items-center gap-2 bg-[#fff4d6] px-3 py-2 text-sm text-[#5c4300]">
                  This file changed since you opened it. Your text is still here.
                  <button onClick={() => navigator.clipboard?.writeText(open.content)} className="underline">Copy my text</button>
                  <button onClick={() => openFile(open.path, true)} className="underline">Load the latest version</button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {open.kind === "text" && (
                  <CodeEditor
                    key={open.path}
                    value={open.content}
                    path={open.path}
                    readOnly={!editable}
                    dark={dark}
                    onChange={(v) => setOpen((o) => (o?.kind === "text" ? { ...o, content: v } : o))}
                    onSave={save}
                  />
                )}
                {open.kind === "image" && (
                  <div className="grid h-full place-items-center bg-bg p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${base}/download?${q(open.path)}`} alt={open.path} className="max-h-full max-w-full rounded-[8px] border border-line" />
                  </div>
                )}
                {open.kind === "binary" && (
                  <div className="grid h-full place-items-center p-6 text-center text-sm">
                    <div>
                      <p>This file can&apos;t be opened in the editor ({formatBytes(open.size)}).</p>
                      <a href={`${base}/download?${q(open.path)}`} className="btn-dark mt-3 inline-block rounded-[10px] px-4 py-2 font-semibold">Download</a>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
        {history && (
          <div className="fixed inset-y-0 right-0 z-30 w-[min(360px,100vw)] lg:static lg:z-auto">
            <HistoryPanel
              key={history}
              path={history}
              base={base}
              editable={editable}
              unsaved={dirty && open?.path === history}
              onClose={() => setHistory(null)}
              onRestored={async () => {
                const restored = history;
                setHistory(null);
                await loadTree();
                if (open?.path === restored) await openFile(restored, true);
                setNotice("Version restored.");
              }}
            />
          </div>
        )}
      </div>
      {uploading && (
        <UploadDialog
          projectId={pid}
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            loadTree();
          }}
        />
      )}
    </div>
  );
}
