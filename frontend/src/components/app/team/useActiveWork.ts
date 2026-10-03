"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isActive, type GoalDTO } from "@/lib/goals";
import { useWorkspace } from "@/lib/workspace";

/** The company's goal in progress, refreshed every 3 seconds while one runs and every 15 seconds otherwise. */
export function useActiveWork(): GoalDTO | null {
  const { wsPath } = useWorkspace();
  const [goal, setGoal] = useState<GoalDTO | null>(null);
  const path = wsPath("/goals");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      let next: GoalDTO | null = null;
      try {
        const { goals } = await api<{ goals: { id: string; status: GoalDTO["status"] }[] }>(path);
        const active = goals.find((g) => isActive(g.status));
        next = active ? (await api<{ goal: GoalDTO }>(`${path}/${active.id}`)).goal : null;
      } catch {
        // Keep showing the last known state; the next tick tries again.
      }
      if (stopped) return;
      setGoal(next);
      timer = setTimeout(tick, next ? 3000 : 15000);
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [path]);
  return goal;
}
