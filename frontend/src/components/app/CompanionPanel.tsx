"use client";
import type { Agent } from "@/lib/types";
export function CompanionPanel({ agent, onClose }: { agent: Agent; onClose: () => void; onEdit: () => void; onSelect: (id: string) => void }) {
  return (
    <aside aria-label="Companion details" className="border-l border-line bg-paper p-5">
      <p className="font-semibold">{agent.name}</p>
      <button onClick={onClose}>Close</button>
    </aside>
  );
}
