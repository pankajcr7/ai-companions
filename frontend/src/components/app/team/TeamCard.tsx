"use client";

import Link from "next/link";
import { canGiveTask, roleLabel, type TeamStatus } from "@/lib/team";
import type { Agent, Role } from "@/lib/types";
import { CompanionAvatar } from "../CompanionAvatar";
import { StatusPill } from "./CompanionPage";

export function TeamCard({ agent, status, base, role, onSetUp }: { agent: Agent; status: TeamStatus; base: string; role: Role; onSetUp: () => void }) {
  const page = `${base}/team/${agent.id}`;
  return (
    <article aria-label={agent.name} className="relative flex flex-col gap-3 rounded-[14px] border border-line bg-paper p-4 hover:border-ink">
      <div className="flex items-center gap-3">
        <CompanionAvatar identity={agent.id} look={agent.appearance} size={48} />
        <div className="min-w-0">
          <Link href={page} className="block truncate font-semibold after:absolute after:inset-0">{agent.name}</Link>
          <p className="truncate text-sm text-muted">{roleLabel(agent)}</p>
        </div>
      </div>
      <StatusPill status={status} />
      <div className="relative z-10 mt-auto flex flex-wrap gap-2">
        {status.kind === "setup" && role !== "viewer" ? (
          <button onClick={onSetUp} className="btn-dark rounded-[8px] px-3 py-1.5 text-xs font-semibold">Set up</button>
        ) : (
          <Link href={page} aria-label={`Chat with ${agent.name}`} className="btn-light rounded-[8px] px-3 py-1.5 text-xs font-semibold">Chat</Link>
        )}
        {canGiveTask(role, agent) && status.kind !== "setup" && (
          <Link href={`${base}?ask=${encodeURIComponent(`@${agent.name} `)}`} className="btn-light rounded-[8px] px-3 py-1.5 text-xs font-semibold">Give a task</Link>
        )}
      </div>
    </article>
  );
}
