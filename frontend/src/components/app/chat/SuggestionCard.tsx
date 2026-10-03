"use client";

import { useState } from "react";
import type { HireSuggestion, Suggestion } from "@/lib/suggest";

/** Nova's hand-off: plan the work with the team in one click, or add a missing companion first. */
export function SuggestionCard({ suggestion, onPlan, onHire }: { suggestion: Suggestion; onPlan?: (goal: string, newProject: boolean) => Promise<void>; onHire?: (hire: HireSuggestion) => void }) {
  const [text, setText] = useState(suggestion.goal ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function plan() {
    if (!onPlan || !text.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await onPlan(text.trim(), suggestion.newProject);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Nova's suggestion" className="mt-2 space-y-2.5 rounded-[10px] border border-line bg-paper p-2.5 text-xs">
      {suggestion.hire.map((h) => (
        <div key={h.role} className="flex flex-wrap items-center gap-2">
          <span>
            No one on the team covers <strong>{h.role}</strong> yet.
          </span>
          {onHire && (
            <button type="button" onClick={() => onHire(h)} className="btn-light rounded-[8px] px-2.5 py-1 font-semibold">
              Add a {h.role} companion
            </button>
          )}
        </div>
      ))}
      {suggestion.goal && (
        <div>
          <p className="font-semibold">Plan this with the team</p>
          {editing ? (
            <textarea aria-label="Goal for the team" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} className="mt-1 w-full rounded-[8px] border border-line bg-paper px-2 py-1.5 text-xs" />
          ) : (
            <p className="mt-1 whitespace-pre-wrap">{text}</p>
          )}
          {suggestion.newProject && <p className="mt-1 text-muted">New project{suggestion.projectName ? `: ${suggestion.projectName}` : ""}</p>}
          {onPlan && (
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy || !text.trim()} onClick={plan} className="btn-dark rounded-[8px] px-3 py-1 font-semibold disabled:opacity-60">
                {busy ? "Planning..." : suggestion.newProject ? "Plan it in a new project" : "Plan it"}
              </button>
              {!editing && (
                <button type="button" onClick={() => setEditing(true)} className="btn-light rounded-[8px] px-3 py-1 font-semibold">
                  Edit first
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-[#b42318]">{error}</p>}
    </div>
  );
}
