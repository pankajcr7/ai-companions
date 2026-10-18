"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { GoalCard } from "@/components/app/goals/GoalCard";
import { PhoneScreens } from "@/components/app/files/PhoneScreens";
import { api, ApiError } from "@/lib/api";
import { appName, CHANGES_PREFIX, isActive } from "@/lib/mobile";
import type { TreeEntry } from "@/lib/projects";
import { canEdit } from "@/lib/types";
import { phoneScreens } from "@/lib/screens";
import { useWorkspace } from "@/lib/workspace";

const BUSY = "Your team is busy with another goal. Try again when it finishes.";
type GoalRow = { id: string; text: string; status: string; projectId: string | null; parentGoalId: string | null; createdAt: string };

export default function MobileAppDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { snapshot, wsPath } = useWorkspace();
  const editable = canEdit(snapshot.role);
  const [root, setRoot] = useState<GoalRow | null>(null);
  const [current, setCurrent] = useState<GoalRow | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [ask, setAsk] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  // The app: the given goal, its project, and the newest goal on that project. State is set only after the requests finish.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const goal = (await api<{ goal: GoalRow }>(wsPath(`/goals/${goalId}`))).goal;
      const all = (await api<{ goals: GoalRow[] }>(wsPath("/goals"))).goals;
      const files = goal.projectId ? (await api<{ entries: TreeEntry[] }>(wsPath(`/projects/${goal.projectId}/tree`))).entries.filter((e) => e.kind === "file").map((e) => e.path) : [];
      if (cancelled) return;
      setRoot(goal);
      setCurrent(goal.projectId ? all.find((g) => g.projectId === goal.projectId) ?? goal : goal);
      setPaths(files);
    })().catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [goalId, wsPath, tick]);
  // Refresh while the team works on it.
  useEffect(() => {
    if (!current || !isActive(current.status)) return;
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [current]);

  async function sendChanges() {
    if (!root?.projectId || !current) return;
    setError("");
    try {
      await api(wsPath("/goals"), { method: "POST", body: { text: `${CHANGES_PREFIX}${ask.trim()}`, projectId: root.projectId, parentGoalId: current.id } });
      setAsk("");
      setTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? BUSY : (e as Error).message);
    }
  }

  const screens = phoneScreens(paths);
  if (!root) return <p className="p-6 text-sm text-muted">{error || "Loading…"}</p>;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
      <Link href={`/w/${snapshot.workspace.slug}/mobile`} className="text-sm text-muted hover:underline">← Mobile App</Link>
      <h1 className="text-xl font-semibold">{appName(root.text)}</h1>
      {current && <GoalCard key={current.id} goalId={current.id} onStatus={(g) => setCurrent((c) => (c && c.status !== g.status ? { ...c, status: g.status } : c))} />}
      <section aria-label="Phone screens" className="rounded-[16px] border border-line bg-paper">
        {root.projectId && screens.length ? <PhoneScreens base={wsPath(`/projects/${root.projectId}`)} screens={screens} /> : <p className="p-4 text-sm text-muted">Screens will appear here as the team draws them.</p>}
      </section>
      {editable && root.projectId && (
        <section aria-label="Ask for changes" className="flex flex-col gap-2">
          <label htmlFor="mobile-changes" className="font-semibold">What should change?</label>
          <textarea id="mobile-changes" value={ask} onChange={(e) => setAsk(e.target.value)} rows={3} maxLength={3900} className="rounded-[10px] border border-line bg-paper p-3" />
          <button onClick={sendChanges} disabled={!ask.trim()} className="studio-primary self-start">Send changes</button>
        </section>
      )}
      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
    </div>
  );
}
