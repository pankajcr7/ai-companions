"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, DownloadSimple, FileText, PencilLine, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { TreeEntry } from "@/lib/projects";
import { outputKind } from "@/lib/studio";
import { useWorkspace } from "@/lib/workspace";
import { RichText } from "../chat/RichText";
import { phoneScreens } from "@/lib/screens";
import { PhoneScreens } from "./PhoneScreens";

export type PreviewSelection = { projectId: string; title: string; path?: string };
export const ResultPreviewContext = createContext<{ open: (selection: PreviewSelection) => void; requestChanges: (selection: PreviewSelection) => void } | null>(null);
export const useResultPreview = () => useContext(ResultPreviewContext);

export function ProjectPreview({ selection, version = "", onClose, onRequestChanges }: { selection: PreviewSelection; version?: string; onClose: () => void; onRequestChanges?: (path?: string) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(selection.path ?? "");
  const [userPicked, setUserPicked] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const base = wsPath(`/projects/${selection.projectId}`);
  useEffect(() => {
    let cancelled = false;
    api<{ entries: TreeEntry[] }>(`${base}/tree`).then((r) => { if (!cancelled) { setEntries(r.entries.filter((e) => e.kind === "file")); setError(""); } }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [base, refresh, version]);
  const primary = entries?.find((e) => /(^|\/)index\.html?$/i.test(e.path)) ?? entries?.find((e) => /\.(html?|md|png|webp|jpe?g|txt)$/i.test(e.path)) ?? entries?.[0];
  // The chat's Preview button always passes a file (the project's cover), so a project with screens opens on them until a file is picked.
  const SCREENS = "__screens__";
  const screens = phoneScreens((entries ?? []).map((e) => e.path));
  const showScreens = screens.length > 0 && (!userPicked || picked === SCREENS);
  const path = showScreens ? undefined : entries?.some((e) => e.path === picked) ? picked : primary?.path;
  return <section className="studio-preview" aria-label="Work preview">
    <header className="studio-preview-header"><div><p className="studio-eyebrow">YOUR WORK, TAKING SHAPE</p><h2>{selection.title}</h2></div><button onClick={onClose} className="studio-icon-button" aria-label="Close preview"><X size={19} /></button></header>
    <div className="studio-preview-toolbar"><label><span className="sr-only">Preview file</span><select value={showScreens ? SCREENS : (path ?? "")} onChange={(e) => { setPicked(e.target.value); setUserPicked(true); }} disabled={!entries?.length}>{!entries?.length && <option>No files yet</option>}{screens.length > 0 && <option value={SCREENS}>Phone screens ({screens.length})</option>}{entries?.map((e) => <option key={e.path} value={e.path}>{e.path}</option>)}</select></label><button onClick={() => setRefresh((n) => n + 1)} className="studio-icon-button" aria-label="Refresh preview"><ArrowClockwise size={17} /></button></div>
    <div className="studio-preview-body">
      {error ? <div className="studio-preview-empty" role="alert"><p>{error}</p><button className="studio-secondary" onClick={() => setRefresh((n) => n + 1)}>Try again</button></div>
        : !entries ? <div className="studio-preview-loading" aria-busy="true" aria-label="Loading preview" />
        : showScreens ? <PhoneScreens base={base} screens={screens} onAsk={onRequestChanges ? (p) => onRequestChanges(p) : undefined} />
        : path ? <PreviewContent key={`${base}:${path}:${refresh}:${version}`} base={base} path={path} title={selection.title} />
        : <div className="studio-preview-empty"><FileText size={36} weight="duotone" /><h3>A little space for something great.</h3><p>Your team’s saved files will appear here as they work.</p></div>}
    </div>
    <footer className="studio-preview-footer"><Link href={`/w/${snapshot.workspace.slug}/projects/${selection.projectId}${path ? `?open=${encodeURIComponent(path)}` : ""}`} className="studio-secondary"><ArrowSquareOut size={15} />Open project</Link><a className="studio-secondary" href={path ? `${base}/download?path=${encodeURIComponent(path)}` : `${base}/download.zip`}><DownloadSimple size={15} />Download</a>{onRequestChanges && <button className="studio-primary" onClick={() => onRequestChanges(path)}><PencilLine size={15} />Request changes</button>}</footer>
  </section>;
}

function PreviewContent({ base, path, title }: { base: string; path: string; title: string }) {
  const kind = outputKind(path);
  const [content, setContent] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const isText = /\.(md|txt|csv|html?|tsx?|jsx?|css|json|py|sql|ya?ml|xml)$/i.test(path);
  useEffect(() => {
    let cancelled = false;
    if (kind === "website") api<{ url: string }>(`${base}/preview-token`, { method: "POST", body: { path } }).then((r) => { if (!cancelled) setUrl(r.url); }, (e: Error) => { if (!cancelled) setError(e.message); });
    else if (isText) api<{ content: string }>(`${base}/files?path=${encodeURIComponent(path)}`).then((r) => { if (!cancelled) setContent(r.content); }, (e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [base, path, kind, isText]);
  if (error) return <div className="studio-preview-empty" role="alert">{error}</div>;
  if (kind === "image") return <div className="studio-image-preview">
    {/* eslint-disable-next-line @next/next/no-img-element -- private project output */}
    <img src={`${base}/download?path=${encodeURIComponent(path)}`} alt={path} />
  </div>;
  if (kind === "website") return url ? <iframe src={url} title={`Preview of ${title}`} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" /> : <div className="studio-preview-loading" aria-busy="true" aria-label="Loading website" />;
  if (isText) return content !== null ? <div className="studio-text-preview">{/\.md$/i.test(path) ? <RichText text={content} /> : <pre>{content}</pre>}</div> : <div className="studio-preview-loading" aria-busy="true" aria-label="Loading document" />;
  return <div className="studio-preview-empty"><FileText size={40} weight="duotone" /><h3>{path.split("/").pop()}</h3><p>Download this file to open it in your preferred app.</p><a href={`${base}/download?path=${encodeURIComponent(path)}`} className="studio-primary">Download file</a></div>;
}

export function OutputDialog({ selection, onClose }: { selection: PreviewSelection; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} onClose={onClose} aria-label={`Preview: ${selection.title}`} className="studio-dialog studio-output-dialog"><ProjectPreview key={`${selection.projectId}:${selection.path ?? ""}`} selection={selection} onClose={() => ref.current?.close()} /></dialog>;
}
