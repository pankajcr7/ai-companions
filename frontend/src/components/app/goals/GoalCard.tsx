"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isActive, planSentence, type DraftTask, type GoalDTO, type TaskDTO } from "@/lib/goals";
import { goalAsMarkdown } from "@/lib/rich";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "../CompanionAvatar";
import { CopyButton } from "../chat/CopyButton";
import { RichText } from "../chat/RichText";
import { FilesCreated } from "./FilesCreated";
import { PlanEditor } from "./PlanEditor";
import { TaskCard } from "./TaskCard";

const STATE: Record<TaskDTO["status"], [string, string]> = {
  pending: ["Waiting", "bg-bg text-muted"],
  running: ["Working", "bg-[#fff4d6] text-[#7a5200]"],
  done: ["Done ✓", "bg-[#e3f4e1] text-[#22642a]"],
  failed: ["Problem", "bg-[#fde8e6] text-[#7a1b12]"],
  skipped: ["Not started", "bg-bg text-muted"],
  interrupted: ["Interrupted", "bg-[#fde8e6] text-[#7a1b12]"],
};
const minutes = (iso: string | null) => (iso ? Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null);

/** A goal inside the chat: a plain plan to start, then live progress, results, and files. */
export function GoalCard({ goalId, onStatus }: { goalId: string; onStatus?: (goal: GoalDTO) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const [goal, setGoal] = useState<GoalDTO | null>(null);
  const [changing, setChanging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = canEdit(snapshot.role);
  const path = wsPath(`/goals/${goalId}`);

  const load = useCallback(
    () =>
      api<{ goal: GoalDTO }>(path).then((r) => {
        setGoal(r.goal);
        onStatus?.(r.goal);
      }),
    [path, onStatus],
  );
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);
  const active = !goal || isActive(goal.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => load().catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [active, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await load().catch(() => {});
      setBusy(false);
    }
  }
  const start = (tasks?: DraftTask[], projectName?: string) =>
    act(async () => {
      if (tasks) await api(`${path}/plan`, { method: "PUT", body: { tasks, projectName } });
      await api(`${path}/start`, { method: "POST" });
      setChanging(false);
    });

  if (!goal) return <div className="mt-2 h-16 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />;
  const done = goal.tasks.filter((t) => t.status === "done").length;
  const agent = (id: string) => snapshot.agents.find((a) => a.id === id);

  return (
    <div role="group" aria-label={`Goal: ${goal.text}`} className="mt-2 rounded-[14px] border border-line bg-paper p-3 text-sm">
      {goal.status === "planning" && <p className="text-muted">Nova is making a plan...</p>}
      {goal.newProject && goal.projectName && <p className="text-xs text-muted">New project: {goal.projectName}</p>}

      {goal.status === "awaiting_approval" && !changing && (
        <>
          <p className="font-semibold">Here&apos;s the plan</p>
          <ul className="mt-2 space-y-1.5">
            {goal.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                {agent(t.agentId) && <CompanionAvatar look={agent(t.agentId)!.appearance} size={24} />}
                <span>{planSentence(t.agentName, t.title)}</span>
              </li>
            ))}
          </ul>
          {editable && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => start()} className="btn-dark rounded-[10px] px-4 py-2 text-sm font-semibold">Start</button>
              <button disabled={busy} onClick={() => setChanging(true)} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Change</button>
              <button disabled={busy} onClick={() => act(() => api(`${path}/cancel`, { method: "POST" }))} className="rounded-[10px] px-4 py-2 text-sm font-semibold hover:bg-bg">Cancel</button>
            </div>
          )}
        </>
      )}
      {goal.status === "awaiting_approval" && changing && <PlanEditor goal={goal} editable={editable} busy={busy} onStart={start} onCancel={() => setChanging(false)} />}

      {["running", "reviewing", "done", "failed", "cancelled"].includes(goal.status) && goal.tasks.length > 0 && (
        <>
          <p className="font-semibold">
            {goal.status === "cancelled" ? `Stopped. ${done} finished, ${goal.tasks.length - done} not started.` : goal.status === "done" ? "Done" : `Team working · ${done} of ${goal.tasks.length} done`}
          </p>
          <ul className="mt-2 space-y-1.5">
            {goal.tasks.map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpen((o) => (o === t.id ? null : t.id))} aria-expanded={open === t.id} className="flex w-full items-center gap-2 rounded-[8px] px-1 py-1 text-left hover:bg-bg">
                  {agent(t.agentId) && <CompanionAvatar look={agent(t.agentId)!.appearance} size={24} />}
                  <span className="min-w-0 flex-1 truncate">{planSentence(t.agentName, t.title)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATE[t.status][1]}`}>
                    {STATE[t.status][0]}
                    {t.status === "running" && minutes(t.startedAt) ? ` (${minutes(t.startedAt)} min)` : ""}
                  </span>
                </button>
                {open === t.id && <TaskCard task={t} edits={goal.edits.filter((e) => e.taskId === t.id)} goalPath={path} editable={editable} onChanged={load} />}
              </li>
            ))}
          </ul>
        </>
      )}

      {goal.status === "cancelled" && editable && goal.tasks.some((t) => t.status === "done" || t.startedAt) && (
        <button disabled={busy} onClick={() => act(() => api(`${path}/resume`, { method: "POST" }))} className="btn-dark mt-3 rounded-[10px] px-4 py-2 text-sm font-semibold">Resume</button>
      )}
      {goal.status === "failed" && goal.tasks.length === 0 && editable && (
        <button disabled={busy} onClick={() => act(() => api(`${path}/replan`, { method: "POST" }))} className="btn-dark mt-3 rounded-[10px] px-4 py-2 text-sm font-semibold">Try again</button>
      )}
      {goal.error && <p className="mt-2 text-xs text-[#7a1b12]">{goal.error}</p>}

      {goal.summary && (
        <div className="mt-3 rounded-[10px] bg-bg p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Nova&apos;s summary</p>
            <CopyButton text={goalAsMarkdown(goal)} label="Copy all results" />
          </div>
          <RichText text={goal.summary} />
        </div>
      )}
      <FilesCreated goal={goal} />
      {error && <p role="alert" className="mt-2 text-xs text-[#b42318]">{error}</p>}
    </div>
  );
}
