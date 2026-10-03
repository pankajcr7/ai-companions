"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { isActive, STATUS_LABEL, type DraftTask, type GoalDTO } from "@/lib/goals";
import { canEdit } from "@/lib/types";
import { goalAsMarkdown } from "@/lib/rich";
import { useWorkspace } from "@/lib/workspace";
import { CopyButton } from "../chat/CopyButton";
import { RichText } from "../chat/RichText";
import { GoalChat } from "./GoalChat";
import { PlanEditor } from "./PlanEditor";
import { TaskCard } from "./TaskCard";

export function GoalPanel({ goalId, onClose, onWorking, onOpenGoal }: { goalId: string; onClose: () => void; onWorking: (ids: string[]) => void; onOpenGoal: (id: string) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const [goal, setGoal] = useState<GoalDTO | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = canEdit(snapshot.role);
  const path = wsPath(`/goals/${goalId}`);

  const load = useCallback(() => api<{ goal: GoalDTO }>(path).then((r) => setGoal(r.goal)), [path]);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);
  // Poll while Nova or the companions are working.
  const active = !goal || isActive(goal.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => load().catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [active, load]);
  const working = (goal?.working ?? []).join(",");
  useEffect(() => {
    onWorking(working ? working.split(",") : []);
  }, [working, onWorking]);
  useEffect(() => () => onWorking([]), [onWorking]);

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
  const start = (tasks: DraftTask[]) =>
    act(async () => {
      await api(`${path}/plan`, { method: "PUT", body: { tasks } });
      await api(`${path}/start`, { method: "POST" });
    });
  const cancel = () => act(() => api(`${path}/cancel`, { method: "POST" }));
  const tokens = goal ? goal.inputTokens + goal.outputTokens : 0;

  return (
    <aside aria-label="Company goal" className="h-full overflow-auto border-l border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted">Company goal</p>
        <button aria-label="Close goal" onClick={onClose} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><X size={18} /></button>
      </div>
      <h2 className="text-lg font-semibold">{goal?.text ?? "Loading..."}</h2>
      {goal?.parent && (
        <button onClick={() => onOpenGoal(goal.parent!.id)} className="mt-1 block max-w-full truncate text-left text-xs text-muted underline">
          Continues: {goal.parent.text}
        </button>
      )}
      {goal && (
        <p role="status" className="mt-1 text-sm text-muted">
          {STATUS_LABEL[goal.status]}
          {tokens > 0 ? ` · ${tokens.toLocaleString()} tokens` : ""}
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-[#b42318]">{error}</p>}
      {goal?.error && <p className="mt-3 rounded-[10px] bg-[#fde8e6] px-3 py-2 text-sm text-[#7a1b12]">{goal.error}</p>}
      {goal?.status === "planning" && <div className="mt-4 h-24 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
      {goal?.status === "awaiting_approval" && <PlanEditor goal={goal} editable={editable} busy={busy} onStart={start} onCancel={cancel} />}
      {goal?.summary && (
        <section className="mt-4 rounded-[12px] bg-bg p-3" aria-label="Nova's summary">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Nova&apos;s summary</h3>
            <div className="flex gap-1">
              <CopyButton text={goal.summary} label="Copy summary" />
              <CopyButton text={goalAsMarkdown(goal)} label="Copy all results" />
            </div>
          </div>
          <div className="mt-1">
            <RichText text={goal.summary} />
          </div>
        </section>
      )}
      {goal && goal.status !== "awaiting_approval" && goal.status !== "planning" &&
        goal.tasks.map((t) => <TaskCard key={t.id} task={t} edits={goal.edits.filter((e) => e.taskId === t.id)} goalPath={path} editable={editable} onChanged={load} />)}
      {goal && ["running", "reviewing", "done", "failed", "cancelled"].includes(goal.status) && (
        <GoalChat goalId={goal.id} goalPath={path} canSend={editable} projectId={goal.projectId} onOpenGoal={onOpenGoal} />
      )}
      {editable && goal?.status === "failed" && goal.tasks.length === 0 && (
        <button disabled={busy} onClick={() => act(() => api(`${path}/replan`, { method: "POST" }))} className="btn-dark mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold">Try again</button>
      )}
      {editable && goal && isActive(goal.status) && (
        <button disabled={busy} onClick={cancel} className="btn-light mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold">Cancel goal</button>
      )}
    </aside>
  );
}
