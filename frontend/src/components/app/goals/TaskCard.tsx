"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { RATING_REASONS, type EditDTO, type TaskDTO } from "@/lib/goals";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "../CompanionAvatar";
import { EditReview } from "./EditReview";

const LABEL: Record<TaskDTO["status"], string> = { pending: "Waiting", running: "Working...", done: "Done", failed: "Failed", skipped: "Skipped", interrupted: "Interrupted" };
const EDIT_LABEL: Record<EditDTO["status"], string> = { pending: "waiting for you", applied: "applied", rejected: "rejected", stale: "out of date" };

export function TaskCard({ task, edits, goalPath, editable, onChanged }: { task: TaskDTO; edits: EditDTO[]; goalPath: string; editable: boolean; onChanged: () => Promise<unknown> }) {
  const { snapshot } = useWorkspace();
  const agent = snapshot.agents.find((a) => a.id === task.agentId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<EditDTO | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
    await onChanged().catch(() => {});
  }
  const rate = (rating: 1 | -1, reason?: string) => run(() => api(`${goalPath}/tasks/${task.id}/rating`, { method: "POST", body: { rating, reason } }));

  return (
    <article className="mt-3 rounded-[12px] border border-line p-3" aria-label={`Task: ${task.title}`}>
      <div className="flex items-start gap-2">
        {agent && <CompanionAvatar look={agent.appearance} size={28} />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{task.title}</p>
          <p className="text-xs text-muted">
            {task.agentName} · {LABEL[task.status]}
            {task.verdict ? (task.verdict === "meets" ? " · Meets criteria" : " · Needs your eyes") : ""}
          </p>
        </div>
        {task.result && (
          <button aria-expanded={open} onClick={() => setOpen((o) => !o)} className="shrink-0 text-xs underline">
            {open ? "Hide result" : "Show result"}
          </button>
        )}
      </div>
      {task.verdictNote && <p className="mt-1 text-xs text-muted">{task.verdictNote}</p>}
      {task.error && <p className="mt-2 text-xs text-[#b42318]">{task.error}</p>}
      {open && task.result && <div className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-[8px] bg-bg p-2.5 text-sm">{task.result}</div>}
      {open && task.filesRead.length > 0 && <p className="mt-1 text-xs text-muted">Read: {task.filesRead.map((f) => f.path).join(", ")}</p>}
      {edits.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Proposed changes">
          {edits.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-mono">{e.path}</span>
              <span className="text-muted">{e.baseRevision === 0 ? "new file" : "changed"} · {EDIT_LABEL[e.status]}</span>
              {e.reason && <span className="text-[#b42318]">{e.reason}</span>}
              <button onClick={() => setViewing(e)} className="underline">View changes</button>
              {editable && e.status === "pending" && (
                <>
                  <button onClick={() => run(() => api(`${goalPath}/edits/${e.id}/apply`, { method: "POST" }))} className="font-semibold underline">Apply</button>
                  <button onClick={() => run(() => api(`${goalPath}/edits/${e.id}/reject`, { method: "POST" }))} className="underline">Reject</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (task.status === "failed" || task.status === "interrupted") && (
        <button onClick={() => run(() => api(`${goalPath}/tasks/${task.id}/retry`, { method: "POST" }))} className="mt-2 text-xs underline">Retry task</button>
      )}
      {editable && task.status === "done" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="Rate this result">
          <button aria-pressed={task.rating === 1} aria-label="Good result" onClick={() => rate(1)} className={`rounded-[8px] p-1.5 ${task.rating === 1 ? "bg-ink text-paper" : "hover:bg-bg"}`}><ThumbsUp size={14} /></button>
          <button aria-pressed={task.rating === -1} aria-label="Poor result" onClick={() => rate(-1)} className={`rounded-[8px] p-1.5 ${task.rating === -1 ? "bg-ink text-paper" : "hover:bg-bg"}`}><ThumbsDown size={14} /></button>
          {task.rating === -1 &&
            RATING_REASONS.map((r) => (
              <button key={r} aria-pressed={task.ratingReason === r} onClick={() => rate(-1, r)} className={`rounded-full border border-line px-2 py-0.5 ${task.ratingReason === r ? "bg-ink text-paper" : ""}`}>{r}</button>
            ))}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[#b42318]">{error}</p>}
      {viewing && <EditReview goalPath={goalPath} edit={viewing} onClose={() => setViewing(null)} />}
    </article>
  );
}
