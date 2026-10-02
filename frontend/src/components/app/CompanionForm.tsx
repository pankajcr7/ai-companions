"use client";
import type { Agent } from "@/lib/types";
export function CompanionForm({ onClose }: { agent: Agent | null; onClose: () => void; onSaved: (id: string) => void }) {
  return <button onClick={onClose}>Close</button>;
}
