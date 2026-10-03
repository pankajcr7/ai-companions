"use client";

import Image from "next/image";
import { api } from "@/lib/api";
import type { HireSuggestion } from "@/lib/suggest";
import { canEdit, CHATGPT_USAGE_URL, type Agent } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { ChatThread } from "./chat/ChatThread";

export function CompanionChat({ agent, onEdit, onThinking, command, onCommandSent, onOpenGoal, onHire }: { agent: Agent; onEdit: () => void; onThinking: (busy: boolean) => void; command?: string; onCommandSent?: () => void; onOpenGoal?: (id: string) => void; onHire?: (hire: HireSuggestion) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const conn = snapshot.connections.find((c) => c.id === agent.connectionId);

  if (!canEdit(snapshot.role)) return <p className="p-1 text-sm text-muted">Viewers can&apos;t chat with companions.</p>;
  if (!conn || !agent.model) {
    return (
      <div className="rounded-[12px] border border-dashed border-line p-5 text-center">
        <p className="font-medium">Choose an AI model for {agent.name} first</p>
        <p className="mt-1 text-sm text-muted">Pick a provider and model in the Customize form.</p>
        <button onClick={onEdit} className="btn-dark mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold">Choose a model</button>
      </div>
    );
  }
  return (
    <ChatThread
      path={wsPath(`/agents/${agent.id}/chat`)}
      name={agent.name}
      inputLabel={`Message ${agent.name}`}
      logLabel={`Chat with ${agent.name}`}
      placeholder={`Message ${agent.name}...`}
      emptyText={`Say hello to ${agent.name}.`}
      canSend
      usageLink={conn.kind === "chatgpt"}
      command={command}
      onCommandSent={onCommandSent}
      onThinking={onThinking}
      suggestions={
        agent.isHead
          ? {
              onPlan: async (goal, newProject) => {
                const { id } = await api<{ id: string }>(wsPath("/goals"), { method: "POST", body: { text: goal, newProject } });
                onOpenGoal?.(id);
              },
              onHire,
            }
          : undefined
      }
      footer={
        conn.kind === "chatgpt" ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Image src="/logos/openai.svg" alt="" width={12} height={12} /> Using ChatGPT plan ·
            <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="underline">Manage usage</a>
          </p>
        ) : null
      }
    />
  );
}
