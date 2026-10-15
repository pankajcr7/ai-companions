"use client";

import Link from "next/link";
import { ArrowUpRight, CaretDown, ClockCounterClockwise } from "@phosphor-icons/react";
import type { ProjectSummary } from "@/lib/projects";
import type { GoalListItem } from "@/lib/goals";
import { projectState } from "@/lib/studio";
import { useWorkspace } from "@/lib/workspace";

export function ContinueWorking({ projects, goals }: { projects: ProjectSummary[]; goals: GoalListItem[] }) {
  const { snapshot } = useWorkspace();
  const base = `/w/${snapshot.workspace.slug}`;
  const review = projects.filter((p) => projectState(p.overview).kind === "review");
  const pending = goals.filter((g) => g.status === "awaiting_approval" && !review.some((p) => p.overview?.goal?.id === g.id));
  const count = review.length + pending.length;
  if (!projects.length && !pending.length) return null;
  return <details className="studio-continue"><summary><ClockCounterClockwise size={17} /><span>Continue where you left off</span>{count > 0 && <span className="studio-review-count">{count} to review</span>}<CaretDown size={13} /></summary><div className="studio-continue-content">
    {projects[0] && <Link href={`${base}/projects/${projects[0].id}`}><span className="studio-continue-label">LATEST PROJECT</span><strong>{projects[0].name}</strong><span>{projectState(projects[0].overview).label}<ArrowUpRight size={14} /></span></Link>}
    {(review[0]?.overview?.goal || pending[0]) && <Link href={`${base}/goals/${review[0]?.overview?.goal?.id ?? pending[0].id}`}><span className="studio-continue-label">READY FOR YOU</span><strong>{review[0]?.name ?? pending[0].text}</strong><span>Review and keep things moving<ArrowUpRight size={14} /></span></Link>}
    {projects.find((p) => p.overview?.cover) && (() => { const p = projects.find((p) => p.overview?.cover)!; return <Link href={`${base}/projects/${p.id}?open=${encodeURIComponent(p.overview!.cover!.path)}`}><span className="studio-continue-label">RECENT OUTPUT</span><strong>{p.overview!.cover!.path.split("/").pop()}</strong><span>Open your latest saved work<ArrowUpRight size={14} /></span></Link>; })()}
  </div></details>;
}
