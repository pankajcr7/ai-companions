"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { ChatEditDTO } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { EditReview } from "../goals/EditReview";

const STATUS: Record<ChatEditDTO["status"], string> = { pending: "Waiting for you", applied: "Applied", rejected: "Skipped", stale: "Out of date: the file changed" };

/** A file change a companion suggested in chat: nothing changes until the owner presses Apply. */
export function ChatEditCard({ edits, canDecide, onChanged }: { edits: ChatEditDTO[]; canDecide: boolean; onChanged: () => void }) {
  const { wsPath } = useWorkspace();
  const [reviewing, setReviewing] = useState<ChatEditDTO | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!edits.length) return null;
  async function decide(e: ChatEditDTO, action: "apply" | "skip") {
    setBusy(e.id);
    setError("");
    try {
      await api(wsPath(`/chat-edits/${e.id}/${action}`), { method: "POST" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      onChanged();
    }
  }
  return (
    <div role="group" aria-label="Suggested changes" className="mt-2 space-y-1.5 rounded-[10px] border border-line bg-paper p-2.5 text-xs">
      <p className="font-semibold">Suggested changes</p>
      {edits.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono">{e.path}</span>
          <span className="text-muted">{STATUS[e.status]}</span>
          <button onClick={() => setReviewing(e)} className="btn-light rounded-[8px] px-2.5 py-1 font-semibold">Review</button>
          {canDecide && e.status === "pending" && (
            <>
              <button disabled={busy === e.id} onClick={() => decide(e, "apply")} className="btn-dark rounded-[8px] px-2.5 py-1 font-semibold">Apply</button>
              <button disabled={busy === e.id} onClick={() => decide(e, "skip")} className="rounded-[8px] px-2.5 py-1 font-semibold hover:bg-bg">Skip</button>
            </>
          )}
        </div>
      ))}
      {error && <p role="alert" className="text-[#b42318]">{error}</p>}
      {reviewing && <EditReview url={wsPath(`/chat-edits/${reviewing.id}`)} edit={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}
