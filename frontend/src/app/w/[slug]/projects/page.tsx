"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, FolderSimple, MagnifyingGlass, Plus, UploadSimple, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatBytes, type ProjectSummary } from "@/lib/projects";
import { friendlyDate, projectState } from "@/lib/studio";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "@/components/app/CompanionAvatar";
import { createEmptyProject, UploadDialog } from "@/components/app/files/UploadDialog";
import { ProjectCover } from "@/components/app/files/ProjectCover";
import { OutputDialog, type PreviewSelection } from "@/components/app/files/ProjectPreview";

export default function ProjectsPage() {
  const { snapshot, wsPath } = useWorkspace();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [preview, setPreview] = useState<PreviewSelection | null>(null);
  const editable = canEdit(snapshot.role);
  const base = `/w/${snapshot.workspace.slug}/projects`;
  const listPath = wsPath("/projects?overview=1");
  const load = useCallback(() => api<{ projects: ProjectSummary[] }>(listPath).then((r) => setProjects(r.projects)), [listPath]);
  useEffect(() => { load().catch((e) => setError((e as Error).message)); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") load().catch(() => {}); }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  async function newProject() {
    if (!name.trim() || busy) return;
    setBusy(true); setError("");
    try { const { id } = await createEmptyProject(snapshot.workspace.id, name.trim()); router.push(`${base}/${id}`); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const shown = projects?.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || projectState(p.overview).kind === filter));
  return <section className="studio-page" aria-labelledby="projects-title">
    <header className="studio-page-header"><div><p className="studio-eyebrow"><FolderSimple size={16} />MADE WITH YOUR TEAM</p><h1 id="projects-title">Ideas, brought to life.</h1><p>Your projects, their progress, and everything you’ve made together.</p></div>{editable && <div className="studio-actions"><button onClick={() => setUploading(true)} className="studio-secondary"><UploadSimple size={16} />Open project</button><button onClick={() => setCreating((v) => !v)} className="studio-primary"><Plus size={16} />New project</button></div>}</header>
    {creating && <form aria-label="New project" className="studio-create-project" onSubmit={(e) => { e.preventDefault(); void newProject(); }}><label>Project name<input autoFocus value={name} maxLength={60} required placeholder="What are we making?" onChange={(e) => setName(e.target.value)} /></label><button disabled={busy || !name.trim()} className="studio-primary">{busy ? "Creating…" : "Create project"}</button><button type="button" onClick={() => setCreating(false)} aria-label="Cancel new project" className="studio-icon-button"><X size={18} /></button></form>}
    {error && <p role="alert" className="studio-error">{error}<button onClick={() => load().then(() => setError("")).catch((e) => setError((e as Error).message))}>Try again</button></p>}
    <div className="studio-project-toolbar"><div role="group" aria-label="Filter projects" className="studio-filter-tabs">{[["all", "All projects"], ["working", "Working"], ["review", "Needs review"], ["done", "Finished"]].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{value === "all" && projects && <span>{projects.length}</span>}</button>)}</div><label className="studio-search"><MagnifyingGlass size={17} /><input aria-label="Search projects" placeholder="Find a project…" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
    {!projects && !error && <div className="studio-project-grid" aria-label="Loading projects" aria-busy="true">{[0,1,2].map((i) => <div key={i} className="studio-project-skeleton" />)}</div>}
    {projects?.length === 0 && <div className="studio-empty"><span className="studio-empty-icon"><FolderSimple size={42} weight="duotone" /></span><h2>Good work starts with an idea.</h2><p>{editable ? "Start a project, bring in your files, or ask your team to make something new." : "Your team’s projects will appear here."}</p><Link href={`/w/${snapshot.workspace.slug}`} className="studio-primary">Talk to your team<ArrowUpRight size={16} /></Link></div>}
    {!!projects?.length && shown?.length === 0 && <div className="studio-empty"><h2>No projects match just yet.</h2><button className="studio-secondary" onClick={() => { setQuery(""); setFilter("all"); }}>Show all projects</button></div>}
    <ul className="studio-project-grid">{shown?.map((p) => {
      const state = projectState(p.overview);
      const agents = snapshot.agents.filter((a) => p.overview?.goal?.agentIds.includes(a.id));
      return <li key={p.id}><article className="studio-project-card" aria-label={p.name}>
        <button className="studio-project-preview-button" aria-label={`Preview ${p.name}`} onClick={() => setPreview({ projectId: p.id, title: p.name, path: p.overview?.cover?.path })}><ProjectCover projectId={p.id} title={p.name} cover={p.overview?.cover} /><span className="studio-cover-open">Open preview<ArrowUpRight size={15} /></span></button>
        <div className="studio-project-info"><div className="studio-project-title"><Link href={`${base}/${p.id}`}>{p.name}</Link><ArrowUpRight size={17} /></div><span className="studio-status" data-status={state.kind}><i />{state.label}</span><p className="studio-project-meta">{p.fileCount} files · {formatBytes(p.totalBytes)}</p>
          <div className="studio-project-footer"><span>{friendlyDate(p.updatedAt)}</span><span className="studio-avatar-stack" aria-label={agents.length ? `Team: ${agents.map((a) => a.name).join(", ")}` : ""}>{agents.slice(0,3).map((a) => <span key={a.id} title={a.name}><CompanionAvatar identity={a.id} look={a.appearance} size={27} /></span>)}{agents.length > 3 && <small>+{agents.length - 3}</small>}</span></div>
          {state.kind === "review" && p.overview?.goal && <Link href={`/w/${snapshot.workspace.slug}/goals/${p.overview.goal.id}`} className="studio-review-link">Review your team’s work<ArrowUpRight size={14} /></Link>}
        </div>
      </article></li>;
    })}</ul>
    {uploading && <UploadDialog onClose={() => setUploading(false)} onDone={(id) => router.push(`${base}/${id}`)} />}
    {preview && <OutputDialog selection={preview} onClose={() => setPreview(null)} />}
  </section>;
}
