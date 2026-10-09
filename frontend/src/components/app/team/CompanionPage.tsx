"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Archive, ArrowLeft, Copy, Pause, PencilSimple, Play } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { HireSuggestion } from "@/lib/suggest";
import { roleLabel, statusText, teamStatus, workingTasks, type TeamStatus } from "@/lib/team";
import { canEdit, type Agent } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "../CompanionAvatar";
import { CompanionChat } from "../CompanionChat";
import { CompanionForm } from "../CompanionForm";
import { useActiveWork } from "./useActiveWork";

type Recent = { id: string; title: string; finishedAt: string; goalId: string; goalText: string };
const PILL: Record<TeamStatus["kind"], string> = {
  working: "bg-[#fff4d6] text-[#7a5200]",
  free: "bg-[#e3f4e1] text-[#22642a]",
  setup: "bg-bg text-muted",
  paused: "bg-bg text-muted",
  former: "bg-bg text-muted",
};

export function StatusPill({ status }: { status: TeamStatus }) {
  return <span className={`inline-block max-w-full self-start truncate rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[status.kind]}`}>{statusText(status)}</span>;
}

/** A teammate's own page: who they are, what they're doing, what they've done, and a chat with them. */
export function CompanionPage({ agentId }: { agentId: string }) {
  const { snapshot, reload, wsPath } = useWorkspace();
  const router = useRouter();
  const base = `/w/${snapshot.workspace.slug}`;
  const agent = snapshot.agents.find((a) => a.id === agentId) ?? null;
  const goal = useActiveWork();
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [editing, setEditing] = useState<"self" | "new" | null>(null);
  const [hire, setHire] = useState<HireSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = canEdit(snapshot.role);
  const tasksPath = wsPath(`/agents/${agentId}/tasks?limit=5`);

  useEffect(() => {
    if (!agent) return;
    api<{ tasks: Recent[] }>(tasksPath).then((r) => setRecent(r.tasks), () => setRecent([]));
  }, [agent, tasksPath]);

  if (!agent) {
    return (
      <main className="p-6">
        <p className="font-medium">This teammate wasn&apos;t found</p>
        <Link href={`${base}/team`} className="mt-2 inline-block text-sm underline">Back to team</Link>
      </main>
    );
  }

  const status = teamStatus(agent, snapshot.connections, workingTasks(goal));
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const setStatus = (s: Agent["status"]) => run(() => api(wsPath(`/agents/${agent.id}`), { method: "PATCH", body: { status: s } }));

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row">
      <section aria-label={`About ${agent.name}`} className="min-w-0 lg:w-80 lg:shrink-0 lg:overflow-y-auto">
        <Link href={`${base}/team`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Back to team</Link>
        <div className="mt-4 flex items-center gap-4">
          <CompanionAvatar identity={agent.id} look={agent.appearance} size={72} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{agent.name}</h1>
            <p className="text-sm text-muted">{roleLabel(agent)}{agent.kind === "human" ? " · person" : ""}</p>
          </div>
        </div>
        <div className="mt-3"><StatusPill status={status} /></div>
        {status.kind === "working" && goal && (
          <p className="mt-3 text-sm">Now working on <Link href={`${base}/goals/${goal.id}`} className="font-semibold underline">{status.task}</Link></p>
        )}
        {agent.workingStyle && <p className="mt-3 text-sm text-muted">{agent.workingStyle}</p>}

        <h2 className="mt-6 text-sm font-semibold">Recent work</h2>
        {recent === null ? (
          <div className="mt-2 h-12 animate-pulse rounded-[10px] bg-bg" aria-busy="true" />
        ) : recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No finished work yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {recent.map((t) => (
              <li key={t.id}>
                <Link href={`${base}/goals/${t.goalId}`} className="block rounded-[8px] px-2 py-1.5 text-sm hover:bg-bg">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-muted">{new Date(t.finishedAt).toLocaleDateString()} · {t.goalText}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
        {editable && (
          <div className="mt-6 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => setEditing("self")} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><PencilSimple size={14} /> {status.kind === "setup" ? "Set up" : "Edit"}</button>
            {agent.status === "archived" ? (
              <button disabled={busy} onClick={() => setStatus("active")} className="btn-light rounded-[10px] px-3 py-2 text-sm font-semibold">Restore</button>
            ) : (
              <button disabled={busy} onClick={() => setStatus(agent.status === "paused" ? "active" : "paused")} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold">
                {agent.status === "paused" ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
              </button>
            )}
            <button disabled={busy} onClick={() => run(async () => router.push(`${base}/team/${(await api<{ id: string }>(wsPath(`/agents/${agent.id}/clone`), { method: "POST" })).id}`))} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><Copy size={14} /> Clone</button>
            {!agent.isHead && agent.status !== "archived" && (
              <button disabled={busy} onClick={() => confirm(`Move ${agent.name} to former teammates? Their history is kept and you can restore them.`) && setStatus("archived")} className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-[#b42318] hover:bg-bg"><Archive size={14} /> Let go</button>
            )}
          </div>
        )}
      </section>

      <section aria-label={`Chat with ${agent.name}`} className="flex min-h-[60dvh] min-w-0 flex-1 flex-col rounded-[14px] border border-line bg-paper p-4 lg:min-h-0">
        <CompanionChat fill agent={agent} onEdit={() => setEditing("self")} onThinking={() => {}} onOpenGoal={(gid) => router.push(`${base}/goals/${gid}`)} onHire={(h) => { setHire(h); setEditing("new"); }} />
      </section>

      {editing && (
        <CompanionForm
          agent={editing === "self" ? agent : null}
          preset={editing === "new" ? hire : null}
          onClose={() => { setEditing(null); setHire(null); }}
          // Hiring from the chat keeps you in the conversation; the new teammate shows on the Team page.
          onSaved={async () => {
            setEditing(null);
            setHire(null);
            await reload();
          }}
        />
      )}
    </main>
  );
}
