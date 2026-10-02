"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FolderSimple, Plus, UploadSimple } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatBytes, type ProjectSummary } from "@/lib/projects";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { createEmptyProject, UploadDialog } from "@/components/app/files/UploadDialog";

export default function ProjectsPage() {
  const { snapshot, wsPath } = useWorkspace();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const editable = canEdit(snapshot.role);
  const base = `/w/${snapshot.workspace.slug}/projects`;
  const listPath = wsPath("/projects");

  const load = useCallback(() => api<{ projects: ProjectSummary[] }>(listPath).then((r) => setProjects(r.projects)), [listPath]);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function newProject() {
    const name = prompt("Project name");
    if (!name?.trim()) return;
    try {
      const { id } = await createEmptyProject(snapshot.workspace.id, name.trim());
      router.push(`${base}/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted">Upload a folder, ZIP, or files, then edit them here. Nothing you upload is run.</p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <button onClick={newProject} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><Plus size={14} /> New project</button>
            <button onClick={() => setUploading(true)} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><UploadSimple size={14} /> Open project</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="rounded-[10px] bg-[#fde8e6] px-4 py-3 text-sm text-[#7a1b12]">{error}</p>}
      {!projects && !error && <div className="h-24 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
      {projects?.length === 0 && (
        <div className="rounded-[14px] border border-dashed border-line p-8 text-center">
          <FolderSimple size={28} className="mx-auto text-muted" />
          <p className="mt-2 font-medium">No projects yet</p>
          <p className="text-sm text-muted">{editable ? "Open a project by uploading a folder, ZIP, or files." : "An owner or member can upload one."}</p>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link href={`${base}/${p.id}`} className="block rounded-[14px] border border-line bg-paper p-4 hover:border-ink">
              <p className="font-semibold">{p.name}</p>
              <p className="text-sm text-muted">{p.fileCount} files · {formatBytes(p.totalBytes)}</p>
            </Link>
          </li>
        ))}
      </ul>
      {uploading && <UploadDialog onClose={() => setUploading(false)} onDone={(id) => router.push(`${base}/${id}`)} />}
    </main>
  );
}
