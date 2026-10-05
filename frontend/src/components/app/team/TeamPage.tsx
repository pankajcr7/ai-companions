"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Plus } from "@phosphor-icons/react";
import { groupTeam, teamStatus, workingTasks } from "@/lib/team";
import { canAdmin, canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionForm } from "../CompanionForm";
import { OfficeMap } from "../office/Office";
import { OrganizeDialog } from "./OrganizeDialog";
import { TeamCard } from "./TeamCard";
import { useActiveWork } from "./useActiveWork";

const VIEW_KEY = "team-view";
const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
};

/** Everyone on the team as friendly cards, with the animated office one click away. */
export function TeamPage() {
  const { snapshot, reload } = useWorkspace();
  const router = useRouter();
  const base = `/w/${snapshot.workspace.slug}`;
  const goal = useActiveWork();
  const working = workingTasks(goal);
  // The chosen view is remembered on this device; the server render and private windows start on cards.
  const stored = useSyncExternalStore(subscribeStorage, readView, () => null);
  const [picked, setPicked] = useState<"cards" | "office" | null>(null);
  const view = picked ?? (stored === "office" ? "office" : "cards");
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [showFormer, setShowFormer] = useState(false);
  const { groups, former } = groupTeam(snapshot.agents, snapshot.departments);
  const people = groups.reduce((n, g) => n + g.agents.length, 0);

  function choose(v: "cards" | "office") {
    setPicked(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Your team</h1>
          <p className="text-sm text-muted">{people} {people === 1 ? "person" : "people"} · {working.size} working now</p>
        </div>
        <div role="group" aria-label="View" className="flex rounded-[10px] border border-line p-0.5">
          {(["cards", "office"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => choose(v)} className={`rounded-[8px] px-3 py-1.5 text-sm ${view === v ? "bg-ink text-paper" : ""}`}>
              {v === "cards" ? "Cards" : "Office"}
            </button>
          ))}
        </div>
        {canAdmin(snapshot.role) && <button onClick={() => setOrganizing(true)} className="btn-light rounded-[10px] px-3 py-2 text-sm font-semibold">Organize</button>}
        {canEdit(snapshot.role) && (
          <button onClick={() => setEditing("new")} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><Plus size={14} weight="bold" /> Add a teammate</button>
        )}
      </header>

      {view === "office" ? (
        <OfficeMap workingIds={[...working.keys()]} onOpen={(id) => router.push(`${base}/team/${id}`)} />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.id} aria-label={g.name}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{g.name}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.agents.map((a) => (
                  <TeamCard key={a.id} agent={a} status={teamStatus(a, snapshot.connections, working)} base={base} role={snapshot.role} onSetUp={() => setEditing(a.id)} />
                ))}
              </div>
            </section>
          ))}
          {former.length > 0 && (
            <section aria-label="Former teammates">
              <button onClick={() => setShowFormer((s) => !s)} aria-expanded={showFormer} className="text-sm font-semibold text-muted">Former teammates ({former.length})</button>
              {showFormer && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {former.map((a) => (
                    <TeamCard key={a.id} agent={a} status={{ kind: "former" }} base={base} role={snapshot.role} onSetUp={() => setEditing(a.id)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {editing && (
        <CompanionForm
          agent={editing === "new" ? null : (snapshot.agents.find((a) => a.id === editing) ?? null)}
          preset={null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
      {organizing && <OrganizeDialog onClose={() => setOrganizing(false)} />}
    </main>
  );
}
