"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react";
import type { GoalStatus } from "@/lib/goals";
import { useWorkspace } from "@/lib/workspace";
import { useStudioPreferences } from "../StudioPreferences";

export function GoalCompletion({ status }: { status: GoalStatus }) {
  const previous = useRef(status);
  const [celebrating, setCelebrating] = useState(false);
  const { prefs } = useStudioPreferences();
  const { snapshot } = useWorkspace();
  useEffect(() => {
    const justFinished = ["running", "reviewing", "planning"].includes(previous.current) && status === "done";
    previous.current = status;
    if (!justFinished || !prefs.celebrations || snapshot.preferences.reducedMotion || snapshot.preferences.calmMode || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = setTimeout(() => setCelebrating(true), 0);
    const end = setTimeout(() => setCelebrating(false), 3200);
    return () => { clearTimeout(start); clearTimeout(end); };
  }, [status, prefs.celebrations, snapshot.preferences.reducedMotion, snapshot.preferences.calmMode]);
  if (status !== "done") return null;
  return <div className="studio-completion" aria-live="polite"><span className="studio-completion-check"><Check size={18} weight="bold" /></span><div><strong>Your work is ready.</strong><p>A good idea, one step further.</p></div>{celebrating && prefs.celebrations && <div className="studio-confetti" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--piece": i } as React.CSSProperties} />)}</div>}</div>;
}
