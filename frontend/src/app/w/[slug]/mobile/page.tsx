"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DeviceMobile, ImageSquare, PaperPlaneRight, X } from "@phosphor-icons/react";
import { useAttachments } from "@/components/app/chat/AttachmentPicker";
import { api, ApiError } from "@/lib/api";
import { APP_PREFIX, appName, appStatus } from "@/lib/mobile";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

type GoalRow = { id: string; text: string; status: string; projectId: string | null; parentGoalId: string | null; mobile: boolean };
type ProjectRow = { id: string; overview?: { screens?: number } };

const EXAMPLES = [
  { label: "Hiking trails", text: "A hiking trails app: saved trails, a trail map and a trip log" },
  { label: "Cycle tracker", text: "A cycle tracker app: rides, weekly goals and a ride map" },
  { label: "Recipe planner", text: "A recipe planner app: weekly meal plan, recipes and a shopping list" },
];
const BUSY = "Your team is busy with another goal. Try again when it finishes.";

export default function MobileAppPage() {
  const { snapshot, wsPath } = useWorkspace();
  const router = useRouter();
  const editable = canEdit(snapshot.role);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<{ goal: GoalRow; screens: number | null }[] | null>(null);
  const att = useAttachments(editable ? wsPath("/attachments") : undefined);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([api<{ goals: GoalRow[] }>(wsPath("/goals?roots=1")), api<{ projects: ProjectRow[] }>(wsPath("/projects?overview=1"))]).then(([g, p]) => {
      const screens = new Map(p.projects.map((x) => [x.id, x.overview?.screens ?? 0]));
      setApps(g.goals.filter((x) => x.mobile && !x.parentGoalId).map((goal) => ({ goal, screens: goal.projectId ? (screens.get(goal.projectId) ?? 0) : null })));
    }, (e: Error) => setError(e.message));
  }, [wsPath]);

  async function design() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>(wsPath("/goals"), { method: "POST", body: { text: `${APP_PREFIX}${text.trim()}`, newProject: true, attachmentIds: att.ids } });
      router.push(`/w/${snapshot.workspace.slug}/mobile/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "busy" ? BUSY : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Mobile App</h1>
        <p className="mt-1 text-muted">Make your app look designed.</p>
      </header>
      {editable && (
        <section aria-label="Design a new app" className="rounded-[16px] border border-line bg-paper p-4">
          <label htmlFor="mobile-brief" className="sr-only">Describe your app, or paste your spec</label>
          <textarea id="mobile-brief" aria-label="Describe your app, or paste your spec" value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe your app, or paste your spec" rows={4} maxLength={3900} className="w-full resize-y rounded-[10px] bg-bg p-3 text-base" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { att.items.forEach((i) => att.remove(i.key)); att.add([f]); } e.target.value = ""; }} />
            <button onClick={() => file.current?.click()} className="studio-secondary"><ImageSquare size={16} />Add screenshot</button>
            {att.items.map((i) => <span key={i.key} className="flex items-center gap-1 rounded-full bg-bg px-3 py-1 text-sm">{i.name}{i.status === "uploading" ? " (uploading…)" : i.status === "error" ? ` (${i.error})` : ""}<button aria-label={`Remove ${i.name}`} onClick={() => att.remove(i.key)}><X size={13} /></button></span>)}
            <button onClick={design} disabled={!text.trim() || att.uploading || busy} className="studio-primary ml-auto"><PaperPlaneRight size={16} />Design it</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map((x) => <button key={x.label} onClick={() => setText(x.text)} className="rounded-full border border-line px-3 py-1 text-sm">{x.label}</button>)}</div>
        </section>
      )}
      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
      <section aria-label="Your apps">
        <h2 className="mb-3 font-semibold">Your apps</h2>
        {!apps ? <p className="text-sm text-muted">Loading…</p> : !apps.length ? <p className="text-sm text-muted">Your app designs will appear here.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map(({ goal, screens }) => (
              <li key={goal.id}>
                <Link href={`/w/${snapshot.workspace.slug}/mobile/${goal.id}`} className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3 hover:bg-bg">
                  <DeviceMobile size={28} />
                  <span className="min-w-0"><span className="block truncate font-semibold">{appName(goal.text)}</span><span className="text-sm text-muted">{appStatus(goal.status)}{screens ? ` · ${screens} screen${screens === 1 ? "" : "s"}` : ""}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
