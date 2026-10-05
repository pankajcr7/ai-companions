"use client";

import { useState } from "react";
import { reviewLabel, type TaskDTO } from "@/lib/goals";

/** "✓ Checked by Nova · 2 fixes made", opening into the fixes Nova asked for. */
export function ReviewLine({ review }: { review: TaskDTO["review"] }) {
  const [open, setOpen] = useState(false);
  const label = reviewLabel(review);
  if (!review || !label) return null;
  return (
    <div className={`text-[11px] ${review.approved ? "text-[#22642a]" : "text-[#7a5200]"}`}>
      {review.fixes.length ? <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="hover:underline">{label}</button> : <span>{label}</span>}
      {open && (
        <ol className="mt-1 space-y-1 pl-3 text-muted">
          {review.fixes.map((round, i) => (
            <li key={i}>Round {i + 1}: {round.join(" · ")}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
