"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { canEdit, type Snapshot } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { OfficeScene } from "./OfficeScene";

/** The animated office: the same team as the cards, at their desks. Selecting someone opens their page. */
export function OfficeMap({ workingIds, onOpen }: { workingIds: string[]; onOpen: (id: string) => void }) {
  const { snapshot, setSnapshot, reload, wsPath } = useWorkspace();
  const [error, setError] = useState("");

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

  return (
    <div className="flex min-h-[60dvh] flex-1 flex-col">
      {error && <p role="alert" className="bg-[#fde8e6] px-4 py-2 text-sm text-[#7a1b12]">{error}</p>}
      <div className="min-h-0 flex-1">
        <OfficeScene snapshot={snapshot} selectedId={null} highlightId={null} thinkingIds={workingIds} deptFilter={null} editable={canEdit(snapshot.role)} onSelect={onOpen} onMoveDesk={moveDesk} />
      </div>
    </div>
  );
}
