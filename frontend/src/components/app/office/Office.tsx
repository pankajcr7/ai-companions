"use client";

import { ArrowLeft, SlidersHorizontal } from "@phosphor-icons/react";
import { useState } from "react";
import { api } from "@/lib/api";
import { canEdit, type Snapshot } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { OfficeScene } from "./OfficeScene";
import { StudioOffice } from "./StudioOffice";
import "./office.css";

/** The animated office: the same team as the cards, at their desks. Selecting someone opens their page. */
export function OfficeMap({ working, onOpen }: { working: Map<string, string>; onOpen: (id: string) => void }) {
  const { snapshot, setSnapshot, reload, wsPath } = useWorkspace();
  const [error, setError] = useState("");
  const [arranging, setArranging] = useState(false);

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
    <div className="office-map">
      {error && <p role="alert" className="bg-[#fde8e6] px-4 py-2 text-sm text-[#7a1b12]">{error}</p>}
      {arranging ? <>
        <div className="office-arrange-bar"><button onClick={() => setArranging(false)}><ArrowLeft size={16} />Back to office</button><p>Drag desks to arrange your saved floor plan.</p></div>
        <div className="office-arrange-scene"><OfficeScene snapshot={snapshot} selectedId={null} highlightId={null} thinkingIds={[...working.keys()]} deptFilter={null} editable={canEdit(snapshot.role)} onSelect={onOpen} onMoveDesk={moveDesk} /></div>
      </> : <StudioOffice snapshot={snapshot} working={working} onOpen={onOpen} />}
      {!arranging && canEdit(snapshot.role) && <details className="office-options"><summary><SlidersHorizontal size={13} />Office options</summary><p>The studio seats your team automatically. You can also arrange desks in your department floor plan.</p><button onClick={() => setArranging(true)}>Arrange department floor plan</button></details>}
    </div>
  );
}
