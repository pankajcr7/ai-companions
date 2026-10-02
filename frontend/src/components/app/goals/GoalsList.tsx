"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { STATUS_LABEL, type GoalListItem } from "@/lib/goals";
import { useWorkspace } from "@/lib/workspace";

export function GoalsList({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [goals, setGoals] = useState<GoalListItem[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    api<{ goals: GoalListItem[] }>(wsPath("/goals")).then(
      (r) => setGoals(r.goals),
      (e) => setError((e as Error).message),
    );
  }, [wsPath]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="goals-title" className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-5 text-ink backdrop:bg-black/40">
      <div className="flex items-center justify-between">
        <h2 id="goals-title" className="text-lg font-semibold">Goals</h2>
        <button onClick={() => dialog.current?.close()} className="rounded-[8px] px-2 py-1 text-sm hover:bg-bg">Close</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-[#b42318]">{error}</p>}
      {goals?.length === 0 && <p className="mt-3 text-sm text-muted">No goals yet. Type one in the bar at the bottom of the office.</p>}
      <ul className="mt-3 space-y-2">
        {goals?.map((g) => (
          <li key={g.id}>
            <button
              onClick={() => {
                onOpen(g.id);
                dialog.current?.close();
              }}
              className="block w-full rounded-[10px] border border-line p-3 text-left hover:border-ink"
            >
              <span className="block truncate text-sm font-medium">{g.text}</span>
              <span className="text-xs text-muted">{STATUS_LABEL[g.status]} · {new Date(g.createdAt).toLocaleString()}</span>
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
