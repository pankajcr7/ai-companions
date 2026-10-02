"use client";

import { statusLabel, type Snapshot } from "@/lib/types";
import { CompanionAvatar } from "../CompanionAvatar";

export function OfficeList({ snapshot, showArchived, selectedId, onSelect, thinkingIds }: { snapshot: Snapshot; showArchived: boolean; selectedId: string | null; onSelect: (id: string) => void; thinkingIds: string[] }) {
  const dept = (id: string | null) => snapshot.departments.find((d) => d.id === id)?.name ?? "Unassigned";
  const name = (id: string | null) => snapshot.agents.find((a) => a.id === id)?.name ?? "No manager";
  const rows = snapshot.agents.filter((a) => showArchived || a.status !== "archived");
  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Companions</caption>
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="p-3">Name</th>
            <th className="p-3">Role</th>
            <th className="p-3">Department</th>
            <th className="p-3">Manager</th>
            <th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={`border-t border-line ${selectedId === a.id ? "bg-paper" : ""}`}>
              <td className="p-3">
                <button onClick={() => onSelect(a.id)} className="flex items-center gap-3 font-medium hover:underline">
                  <CompanionAvatar look={a.appearance} size={32} />
                  {a.name}
                  {a.kind === "human" && <span className="rounded-[4px] border border-line px-1.5 text-xs text-muted">Human</span>}
                </button>
              </td>
              <td className="p-3">{a.role}</td>
              <td className="p-3">{dept(a.departmentId)}</td>
              <td className="p-3">{a.isHead ? "You" : name(a.managerId)}</td>
              <td className="p-3">{statusLabel(a, thinkingIds.includes(a.id))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-muted">No companions yet. Use New companion to hire one.</p>}
    </div>
  );
}
