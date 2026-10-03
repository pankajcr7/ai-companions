"use client";

import Link from "next/link";
import { useState } from "react";
import type { GoalDTO } from "@/lib/goals";
import { useWorkspace } from "@/lib/workspace";
import { PreviewDialog } from "../files/PreviewDialog";

/** Files a goal saved into its project, with View, Download, Preview, ZIP, and Open project. */
export function FilesCreated({ goal }: { goal: GoalDTO }) {
  const { snapshot, wsPath } = useWorkspace();
  const [previewing, setPreviewing] = useState(false);
  const created = goal.edits.filter((e) => e.baseRevision === 0 && e.status === "applied");
  if (!goal.projectId || !created.length) return null;
  const pid = goal.projectId;
  return (
    <section aria-label="Files created" className="mt-3 rounded-[12px] border border-line bg-paper p-3">
      <h3 className="text-sm font-semibold">Files created</h3>
      <ul className="mt-2 space-y-1 text-xs">
        {created.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-mono">{e.path}</span>
            <Link href={`/w/${snapshot.workspace.slug}/projects/${pid}?open=${encodeURIComponent(e.path)}`} className="underline">View</Link>
            <a href={`${wsPath(`/projects/${pid}/download`)}?path=${encodeURIComponent(e.path)}`} className="underline">Download</a>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {created.some((e) => /\.html?$/i.test(e.path)) && (
          <button onClick={() => setPreviewing(true)} className="btn-dark rounded-[8px] px-3 py-1.5 text-xs font-semibold">Preview</button>
        )}
        <a href={wsPath(`/projects/${pid}/download.zip`)} className="btn-light rounded-[8px] px-3 py-1.5 text-xs font-semibold">Download ZIP</a>
        <Link href={`/w/${snapshot.workspace.slug}/projects/${pid}`} className="btn-light rounded-[8px] px-3 py-1.5 text-xs font-semibold">Open project</Link>
      </div>
      {previewing && <PreviewDialog projectApi={wsPath(`/projects/${pid}`)} title={goal.projectName ?? "Project"} onClose={() => setPreviewing(false)} />}
    </section>
  );
}
