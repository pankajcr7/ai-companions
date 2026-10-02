"use client";

import { useRef, useState } from "react";
import { MagnifyingGlass, PaperPlaneTilt, Plus } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { canEdit, type Snapshot } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionForm } from "../CompanionForm";
import { CompanionPanel } from "../CompanionPanel";
import { OfficeList } from "./OfficeList";
import { OfficeScene, type SceneHandle } from "./OfficeScene";

export function Office() {
  const { snapshot, setSnapshot, reload, wsPath } = useWorkspace();
  const scene = useRef<SceneHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"office" | "list">("office");
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [error, setError] = useState("");

  const editable = canEdit(snapshot.role);
  const q = query.trim().toLowerCase();
  const match = q ? snapshot.agents.find((a) => a.status !== "archived" && (a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q))) : undefined;
  const selected = snapshot.agents.find((a) => a.id === selectedId) ?? null;

  // Send only the moved desk; the server merges it, so a stale view can't erase anyone else's changes.
  async function moveDesk(agentId: string, pos: { x: number; y: number }) {
    const next: Snapshot = { ...snapshot, layout: { ...snapshot.layout, desks: { ...snapshot.layout.desks, [agentId]: pos } } };
    setSnapshot(next);
    try {
      await api(wsPath("/layout"), { method: "PUT", body: { desks: { [agentId]: pos } } });
      setError("");
    } catch (e) {
      setError(`Couldn't save the new desk position. ${(e as Error).message}`);
      await reload();
    }
  }

  const closePanel = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id) requestAnimationFrame(() => scene.current?.focusCompanion(id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-3">
        <h1 className="mr-auto text-lg font-semibold">Live Office</h1>
        <label className="relative">
          <span className="sr-only">Search companions</span>
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && match) {
                setSelectedId(match.id);
                scene.current?.centerOn(match.id);
              }
            }}
            placeholder="Search name or role"
            className="w-48 rounded-[10px] border border-line bg-bg py-2 pl-9 pr-3 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="sr-only">Filter by department</span>
          <select value={deptFilter ?? ""} onChange={(e) => setDeptFilter(e.target.value || null)} className="rounded-[10px] border border-line bg-bg px-3 py-2 text-sm">
            <option value="">All departments</option>
            {snapshot.departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="View" className="flex rounded-[10px] border border-line p-0.5">
          {(["office", "list"] as const).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-[8px] px-3 py-1.5 text-sm capitalize ${mode === m ? "bg-ink text-paper" : ""}`}>
              {m === "office" ? "Office" : "List"}
            </button>
          ))}
        </div>
        {mode === "list" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        )}
        {editable && (
          <button onClick={() => setEditing("new")} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-paper">
            <Plus size={14} weight="bold" /> New companion
          </button>
        )}
      </div>

      {error && <p role="alert" className="bg-[#fde8e6] px-4 py-2 text-sm text-[#7a1b12]">{error}</p>}
      {q && !match && <p className="px-4 py-2 text-sm text-muted">No companion matches &quot;{query}&quot;.</p>}

      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {mode === "office" ? (
            <OfficeScene
              ref={scene}
              snapshot={snapshot}
              selectedId={selectedId}
              highlightId={match?.id ?? null}
              deptFilter={deptFilter}
              editable={editable}
              onSelect={setSelectedId}
              onMoveDesk={moveDesk}
            />
          ) : (
            <OfficeList snapshot={snapshot} showArchived={showArchived} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
        {selected && (
          <div className="fixed inset-x-0 bottom-0 z-20 max-h-[70dvh] overflow-auto rounded-t-[16px] shadow-2xl lg:static lg:max-h-none lg:w-80 lg:rounded-none lg:shadow-none">
            <CompanionPanel agent={selected} onClose={closePanel} onEdit={() => setEditing(selected.id)} onSelect={setSelectedId} />
          </div>
        )}
      </div>

      <div className="border-t border-line bg-paper p-3">
        <div className="flex items-center gap-3 rounded-full border border-line bg-bg py-2 pl-5 pr-2 opacity-70">
          <label htmlFor="command" className="sr-only">Tell your company what to do</label>
          <input id="command" disabled placeholder="Tell your company what to do" aria-describedby="command-help" className="min-w-0 flex-1 bg-transparent text-sm" />
          <span className="grid size-9 place-items-center rounded-full bg-[#0b0d10] text-lime" aria-hidden="true"><PaperPlaneTilt size={15} weight="fill" /></span>
        </div>
        <p id="command-help" className="mt-1.5 px-5 text-xs text-muted">Connect an AI provider to give your company goals. Coming in milestone 2.</p>
      </div>

      {editing && (
        <CompanionForm
          agent={editing === "new" ? null : (snapshot.agents.find((a) => a.id === editing) ?? null)}
          onClose={() => setEditing(null)}
          onSaved={async (id) => {
            setEditing(null);
            await reload();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}
