"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { HireSuggestion } from "@/lib/suggest";
import { useWorkspace } from "@/lib/workspace";
import { ChatThread } from "../chat/ChatThread";

/** Ask Nova about a goal's results, or continue the work as a follow-up goal. */
export function GoalChat({ goalId, goalPath, canSend, projectId, onOpenGoal, onHire }: { goalId: string; goalPath: string; canSend: boolean; projectId: string | null; onOpenGoal: (id: string) => void; onHire?: (hire: HireSuggestion) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const nova = snapshot.agents.find((a) => a.isHead);
  const name = nova?.name ?? "Nova";
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Follow-up goals carry this goal's results and project into planning.
  async function planFollowUp(text: string) {
    const { id } = await api<{ id: string }>(wsPath("/goals"), { method: "POST", body: { text, parentGoalId: goalId, projectId } });
    onOpenGoal(id);
  }

  async function continueGoal() {
    if (!next?.trim()) return;
    setBusy(true);
    setError("");
    try {
      await planFollowUp(next.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={`Chat with ${name} about this goal`} className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-semibold">Ask {name} about this goal</h3>
      <ChatThread
        path={`${goalPath}/chat`}
        name={name}
        inputLabel={`Ask ${name} about this goal`}
        logLabel={`Chat with ${name} about this goal`}
        placeholder="Why this approach? Explain the code. What should we do next?"
        emptyText={`Ask ${name} about the results, the code, or what to do next.`}
        canSend={canSend}
        suggestions={{ onPlan: planFollowUp, onHire }}
      />
      {canSend && next === null && (
        <button onClick={() => setNext("")} className="btn-light mt-3 rounded-[10px] px-3 py-2 text-sm font-semibold">Continue with a new goal</button>
      )}
      {canSend && next !== null && (
        <div className="mt-3 space-y-2 rounded-[12px] border border-line p-3">
          <label className="block text-xs font-medium">
            What should happen next?
            <textarea value={next} onChange={(e) => setNext(e.target.value)} rows={2} maxLength={4000} className="mt-1 w-full rounded-[8px] border border-line bg-paper px-2.5 py-1.5 text-sm" />
          </label>
          <p className="text-xs text-muted">{name} plans it with this goal&apos;s results in mind.</p>
          {error && <p role="alert" className="text-xs text-[#b42318]">{error}</p>}
          <div className="flex gap-2">
            <button disabled={busy || !next.trim()} onClick={continueGoal} className="btn-dark rounded-[10px] px-3 py-1.5 text-sm font-semibold disabled:opacity-60">Plan it</button>
            <button onClick={() => setNext(null)} className="btn-light rounded-[10px] px-3 py-1.5 text-sm font-semibold">Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
