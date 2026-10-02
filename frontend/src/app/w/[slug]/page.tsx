"use client";

import { useWorkspace } from "@/lib/workspace";

export default function OfficePage() {
  const { snapshot } = useWorkspace();
  return <p className="p-8">{snapshot.agents.length} companions in {snapshot.workspace.name}</p>;
}
