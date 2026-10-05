"use client";

import Link from "next/link";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "../CompanionAvatar";

/** Who's on the team: yellow is working, green is free, grey needs setup. */
export function TeamStrip({ workingIds }: { workingIds: string[] }) {
  const { snapshot } = useWorkspace();
  const team = snapshot.agents.filter((a) => a.kind === "ai" && a.status !== "archived");
  const ready = (id: string) => {
    const a = snapshot.agents.find((x) => x.id === id);
    return !!(a?.model && a.status === "active" && snapshot.connections.some((c) => c.id === a.connectionId));
  };
  return (
    <div role="list" aria-label="Your team" className="flex flex-wrap items-center gap-2">
      {team.map((a) => {
        const state = workingIds.includes(a.id) ? ["working", "bg-[#e0a400]"] : ready(a.id) ? ["free", "bg-[#3c9a3c]"] : ["needs setup", "bg-[#b5b8b1]"];
        return (
          <span key={a.id} role="listitem">
            <Link href={`/w/${snapshot.workspace.slug}/team/${a.id}`} title={`${a.name}: ${state[0]}`} className="flex items-center gap-1.5 rounded-full border border-line bg-paper py-0.5 pl-0.5 pr-2.5 text-xs hover:border-ink">
              <CompanionAvatar look={a.appearance} size={22} />
              {a.name}
              <span className={`size-2 rounded-full ${state[1]}`} aria-label={state[0]} />
            </Link>
          </span>
        );
      })}
      <Link href={`/w/${snapshot.workspace.slug}/team`} className="text-xs text-muted underline">See whole team</Link>
    </div>
  );
}
