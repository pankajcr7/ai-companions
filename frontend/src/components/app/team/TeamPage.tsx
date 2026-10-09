"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Buildings, ChatCircle, Plus, SquaresFour } from "@phosphor-icons/react";
import { groupTeam, roleLabel, statusText, teamStatus, workingTasks } from "@/lib/team";
import { canAdmin, canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "../CompanionAvatar";
import { CompanionForm } from "../CompanionForm";
import { OfficeMap } from "../office/Office";
import { OrganizeDialog } from "./OrganizeDialog";
import { TeamCard } from "./TeamCard";
import { useActiveWork } from "./useActiveWork";

const VIEW_KEY = "team-view-v2";
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

/** The team opens in its shared studio; cards remain available as a compact directory. */
export function TeamPage() {
  const { snapshot, reload } = useWorkspace();
  const router = useRouter();
  const base = `/w/${snapshot.workspace.slug}`;
  const goal = useActiveWork();
  const working = workingTasks(goal);
  // Start in the office, then remember an explicit choice on this device.
  const stored = useSyncExternalStore(subscribeStorage, readView, () => null);
  const [picked, setPicked] = useState<"cards" | "office" | null>(null);
  const view = picked ?? (stored === "cards" ? "cards" : "office");
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
    <section className="team-workspace">
      <header className="team-page-header">
        <div>
          <p className="team-page-eyebrow"><Buildings size={16} />A space to do good work</p>
          <h1>Your team</h1>
          <p className="team-page-description">Meet the companions turning your ideas into reality.</p>
        </div>
        <div className="team-page-actions">
          {canAdmin(snapshot.role) && <button onClick={() => setOrganizing(true)} className="team-secondary-action">Organize</button>}
          {canEdit(snapshot.role) && <button onClick={() => setEditing("new")} className="team-primary-action"><Plus size={16} weight="bold" />Add a teammate</button>}
        </div>
      </header>
      <div className="team-view-bar">
        <div role="group" aria-label="View" className="team-view-switch">
          {(["office", "cards"] as const).map((v) => <button key={v} aria-pressed={view === v} onClick={() => choose(v)}>{v === "office" ? <Buildings size={16} /> : <SquaresFour size={16} />}{v === "cards" ? "Cards" : "Office"}</button>)}
        </div>
        <p className="team-presence"><span>{people} {people === 1 ? "teammate" : "teammates"}</span><span><i data-working={working.size > 0} />{working.size ? `${working.size} working now` : "No tasks in progress"}</span></p>
      </div>

      {view === "office" ? (
        <>
          <OfficeMap working={working} onOpen={(id) => router.push(`${base}/team/${id}`)} />
          <section className="office-roster" aria-label="Companions in the office">
            <div className="office-roster-heading"><h2>Around the office</h2><p>Pick a teammate to say hello.</p></div>
            <div className="office-roster-list">
              {groups.flatMap((group) => group.agents).map((a) => {
                const status = teamStatus(a, snapshot.connections, working);
                return <button key={a.id} onClick={() => router.push(`${base}/team/${a.id}`)} aria-label={`Chat with ${a.name}`} className="office-roster-person">
                  <span className="office-roster-avatar"><CompanionAvatar identity={a.id} look={a.appearance} size={49} /></span>
                  <span className="office-roster-info"><strong>{a.name}</strong><span>{roleLabel(a)}</span><small data-status={status.kind}>{statusText(status)}</small></span>
                  <ChatCircle size={17} className="office-roster-chat" />
                </button>;
              })}
            </div>
            {people === 0 && <p className="office-empty">Your office is ready. Add your first teammate to bring it to life.</p>}
          </section>
        </>
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
    </section>
  );
}
