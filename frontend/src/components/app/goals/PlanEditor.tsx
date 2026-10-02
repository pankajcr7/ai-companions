"use client";

import { useState } from "react";
import { removeTask, type DraftTask, type GoalDTO } from "@/lib/goals";
import { useWorkspace } from "@/lib/workspace";

const field = "mt-1 w-full rounded-[8px] border border-line bg-paper px-2.5 py-1.5 text-sm";
const clean = (tasks: DraftTask[]) =>
  tasks.map((t) => ({ ...t, title: t.title.trim(), instructions: t.instructions.trim(), deliverable: t.deliverable.trim(), criteria: t.criteria.map((c) => c.trim()).filter(Boolean).slice(0, 5) }));

export function PlanEditor({ goal, editable, busy, onStart, onCancel }: { goal: GoalDTO; editable: boolean; busy: boolean; onStart: (tasks: DraftTask[]) => void; onCancel: () => void }) {
  const { snapshot } = useWorkspace();
  const [tasks, setTasks] = useState<DraftTask[]>(() => goal.tasks.map(({ agentId, title, instructions, deliverable, criteria, dependsOn }) => ({ agentId, title, instructions, deliverable, criteria, dependsOn })));
  const companions = snapshot.agents.filter((a) => a.kind === "ai" && a.status === "active");
  const ready = (id: string) => {
    const a = snapshot.agents.find((x) => x.id === id);
    return !!(a?.model && snapshot.connections.some((c) => c.id === a.connectionId));
  };
  const notReady = [...new Set(tasks.filter((t) => !ready(t.agentId)).map((t) => snapshot.agents.find((a) => a.id === t.agentId)?.name ?? "A companion"))];
  const incomplete = clean(tasks).some((t) => !t.title || !t.instructions || !t.deliverable || !t.criteria.length);
  const update = (i: number, patch: Partial<DraftTask>) => setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <div className="mt-4 space-y-3">
      {tasks.map((t, i) => (
        <fieldset key={i} disabled={!editable} className="rounded-[12px] border border-line p-3">
          <legend className="px-1 text-xs text-muted">Task {i + 1}</legend>
          <label className="block text-xs font-medium">
            Companion
            <select value={t.agentId} onChange={(e) => update(i, { agentId: e.target.value })} className={field}>
              {companions.map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {a.role}{ready(a.id) ? "" : " (no model)"}</option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-xs font-medium">Title<input value={t.title} maxLength={120} onChange={(e) => update(i, { title: e.target.value })} className={field} /></label>
          <label className="mt-2 block text-xs font-medium">Instructions<textarea rows={3} maxLength={4000} value={t.instructions} onChange={(e) => update(i, { instructions: e.target.value })} className={field} /></label>
          <label className="mt-2 block text-xs font-medium">Deliverable<input value={t.deliverable} maxLength={300} onChange={(e) => update(i, { deliverable: e.target.value })} className={field} /></label>
          <label className="mt-2 block text-xs font-medium">
            Acceptance criteria, one per line
            <textarea rows={3} value={t.criteria.join("\n")} onChange={(e) => update(i, { criteria: e.target.value.split("\n") })} className={field} />
          </label>
          {t.dependsOn.length > 0 && <p className="mt-2 text-xs text-muted">Waits for {t.dependsOn.map((d) => `task ${d + 1}`).join(", ")}</p>}
          {editable && tasks.length > 1 && (
            <button type="button" onClick={() => setTasks((ts) => removeTask(ts, i))} className="mt-2 text-xs text-[#b42318] underline">Remove task</button>
          )}
        </fieldset>
      ))}
      {editable && tasks.length < 6 && (
        <button
          type="button"
          onClick={() => setTasks((ts) => [...ts, { agentId: companions[0]?.id ?? "", title: "", instructions: "", deliverable: "", criteria: [""], dependsOn: [] }])}
          className="btn-light rounded-[10px] px-3 py-2 text-sm font-semibold"
        >
          Add task
        </button>
      )}
      {notReady.length > 0 && <p role="alert" className="text-sm text-[#b42318]">Choose an AI model for {notReady.join(", ")} before starting, or give their tasks to someone else.</p>}
      {editable && (
        <div className="flex gap-2">
          <button disabled={busy || notReady.length > 0 || incomplete} onClick={() => onStart(clean(tasks))} className="btn-dark rounded-[10px] px-4 py-2 text-sm font-semibold disabled:opacity-60">Start</button>
          <button disabled={busy} onClick={onCancel} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Cancel</button>
        </div>
      )}
    </div>
  );
}
