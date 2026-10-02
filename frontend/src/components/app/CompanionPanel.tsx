"use client";

import { useState } from "react";
import { Archive, Copy, Pause, PencilSimple, Play, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { canEdit, statusLabel, type Agent } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "./CompanionAvatar";

export function CompanionPanel({ agent, onClose, onEdit, onSelect }: { agent: Agent; onClose: () => void; onEdit: () => void; onSelect: (id: string) => void }) {
  const { snapshot, reload, wsPath } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = canEdit(snapshot.role);
  const dept = snapshot.departments.find((d) => d.id === agent.departmentId)?.name ?? "Unassigned";
  const manager = agent.isHead ? "You (the owner)" : (snapshot.agents.find((a) => a.id === agent.managerId)?.name ?? "No manager");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const setStatus = (status: Agent["status"]) => run(() => api(wsPath(`/agents/${agent.id}`), { method: "PATCH", body: { status } }));

  return (
    <aside aria-label="Companion details" className="h-full border-l border-line bg-paper p-5">
      <div className="flex items-start justify-between">
        <CompanionAvatar look={agent.appearance} size={72} />
        <button aria-label="Close details" onClick={onClose} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><X size={18} /></button>
      </div>
      <h2 className="mt-3 text-xl font-semibold">{agent.name}</h2>
      <p className="text-sm text-muted">
        {agent.role}
        {agent.kind === "human" ? " (human collaborator)" : ""}
      </p>
      <dl className="mt-5 space-y-3 text-sm">
        {[
          ["Status", statusLabel(agent)],
          ["Department", dept],
          ["Reports to", manager],
          ["AI provider", "Not connected yet"],
          ["Working style", agent.workingStyle || "Not set"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
            <dd className="mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
      {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
      {editable && (
        <div className="mt-6 grid gap-2">
          <button disabled={busy} onClick={onEdit} className="btn-dark flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold text-paper">
            <PencilSimple size={16} /> Customize
          </button>
          {agent.status !== "archived" && (
            <button disabled={busy} onClick={() => setStatus(agent.status === "paused" ? "active" : "paused")} className="btn-light flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold">
              {agent.status === "paused" ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
            </button>
          )}
          {agent.status === "archived" && (
            <button disabled={busy} onClick={() => setStatus("active")} className="btn-light rounded-[10px] py-2.5 text-sm font-semibold">Restore</button>
          )}
          <button
            disabled={busy}
            onClick={() => run(async () => onSelect((await api<{ id: string }>(wsPath(`/agents/${agent.id}/clone`), { method: "POST" })).id))}
            className="btn-light flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold"
          >
            <Copy size={16} /> Clone
          </button>
          {!agent.isHead && agent.status !== "archived" && (
            <button
              disabled={busy}
              onClick={() => confirm(`Archive ${agent.name}? Their history is kept and you can restore them from the list view.`) && setStatus("archived")}
              className="flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold text-[#b42318] hover:bg-bg"
            >
              <Archive size={16} /> Archive
            </button>
          )}
        </div>
      )}
      <p className="mt-6 text-xs text-muted">Pause and archive are saved now. They will stop real work once companions can work (milestone 3).</p>
    </aside>
  );
}
