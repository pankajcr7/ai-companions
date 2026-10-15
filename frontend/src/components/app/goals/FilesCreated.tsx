"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowSquareOut, DownloadSimple, Eye, FileText, PencilLine } from "@phosphor-icons/react";
import type { GoalDTO } from "@/lib/goals";
import { outputKind } from "@/lib/studio";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { ProjectCover } from "../files/ProjectCover";
import { OutputDialog, useResultPreview, type PreviewSelection } from "../files/ProjectPreview";

/** Real saved outputs, with preview, download, and a follow-up back to the conversation. */
export function FilesCreated({ goal }: { goal: GoalDTO }) {
  const { snapshot, wsPath } = useWorkspace();
  const context = useResultPreview();
  const [preview, setPreview] = useState<PreviewSelection | null>(null);
  const files = [...new Map(goal.edits.filter((e) => e.status === "applied").map((e) => [e.path, e])).values()];
  if (!goal.projectId || !files.length) return null;
  const pid = goal.projectId;
  const primary = files.find((e) => /(^|\/)index\.html?$/i.test(e.path)) ?? files.find((e) => ["website", "image", "document"].includes(outputKind(e.path))) ?? files[0];
  const title = goal.projectName ?? "Project";
  const selection = (path = primary.path) => ({ projectId: pid, title, path });
  const open = (path?: string) => context ? context.open(selection(path)) : setPreview(selection(path));
  const base = wsPath(`/projects/${pid}`);
  return <section aria-label="Files created" className="studio-result-card chat-result-reveal">
    <button className="studio-result-cover" aria-label={`Preview ${primary.path}`} onClick={() => open()}><ProjectCover projectId={pid} title={title} cover={{ path: primary.path, revision: primary.baseRevision + 1, kind: outputKind(primary.path) }} /><span className="studio-cover-open"><Eye size={15} />Take a look</span></button>
    <div className="studio-result-content"><p className="studio-eyebrow">{goal.status === "done" ? "MADE BY YOUR TEAM" : "SAVED SO FAR"}</p><h3>{title}</h3><p>{files.length} {files.length === 1 ? "file" : "files"}, ready to explore.</p>
      <div className="studio-result-actions"><button onClick={() => open()} className="studio-primary"><Eye size={15} />Preview</button><a href={`${base}/download.zip`} className="studio-secondary"><DownloadSimple size={15} />Download ZIP</a>{canEdit(snapshot.role) && (context ? <button className="studio-secondary" onClick={() => context.requestChanges(selection())}><PencilLine size={15} />Request changes</button> : <Link href={`/w/${snapshot.workspace.slug}/goals/${goal.id}?change=${encodeURIComponent(`Please update ${primary.path}: `)}#goal-followup`} className="studio-secondary"><PencilLine size={15} />Request changes</Link>)}</div>
      <details className="studio-output-files"><summary>Files created · {files.length}</summary><ul>{files.map((e) => <li key={e.id}><FileText size={15} /><span title={e.path}>{e.path}</span><button onClick={() => open(e.path)} aria-label={`Preview ${e.path}`}>Preview</button><Link href={`/w/${snapshot.workspace.slug}/projects/${pid}?open=${encodeURIComponent(e.path)}`}>View</Link><a href={`${base}/download?path=${encodeURIComponent(e.path)}`}>Download</a></li>)}</ul></details>
      <Link href={`/w/${snapshot.workspace.slug}/projects/${pid}`} className="studio-open-project">Open project<ArrowSquareOut size={14} /></Link>
    </div>
    {preview && <OutputDialog selection={preview} onClose={() => setPreview(null)} />}
  </section>;
}
