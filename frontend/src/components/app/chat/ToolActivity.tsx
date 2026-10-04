"use client";

import { useState } from "react";
import { activitySummary, type ToolUseDTO } from "@/lib/activity";

/** "Read 3 files · Searched 1 time", opening into each step. */
export function ToolActivity({ uses, suggestions = 0 }: { uses: ToolUseDTO[]; suggestions?: number }) {
  const [open, setOpen] = useState(false);
  const summary = activitySummary(uses, suggestions);
  if (!summary) return null;
  return (
    <div className="mt-1.5 text-[11px] text-muted">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="underline-offset-2 hover:underline">{summary}</button>
      {open && uses.length > 0 && (
        <ol className="mt-1 space-y-0.5 pl-3">
          {uses.map((u, i) => (
            <li key={i} className={u.ok ? "" : "text-[#b42318]"}>
              {u.name.replace("_", " ")}: <span className="font-mono">{u.label}</span>{u.ok ? "" : " (didn't work)"}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
