"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isActive, type GoalDTO } from "@/lib/goals";
import type { ProjectSummary } from "@/lib/projects";
import type { HireSuggestion } from "@/lib/suggest";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { ChatThread } from "../chat/ChatThread";
import { CompanionForm } from "../CompanionForm";
import { GoalCard } from "../goals/GoalCard";
import { ConversationList } from "./ConversationList";
import { SetupCard } from "./SetupCard";
import { TeamStrip } from "./TeamStrip";

const EXAMPLES = ["Build a landing page for my bakery", "Write a week of Instagram posts", "Research three competitors and compare prices"];

/** Home: a full-page conversation with Nova. Work requests become plan cards in the chat. */
export function ChatHome() {
  const { snapshot, wsPath, reload } = useWorkspace();
  const editable = canEdit(snapshot.role);
  const head = snapshot.agents.find((a) => a.isHead);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showList, setShowList] = useState(false);
  const [goals, setGoals] = useState<Record<string, GoalDTO>>({});
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [chip, setChip] = useState("");
  const [error, setError] = useState("");
  const [threadKey, setThreadKey] = useState(0);
  const [hire, setHire] = useState<HireSuggestion | null>(null);
  const [editingHead, setEditingHead] = useState(false);
  // "Give a task" on the Team page opens home with "@Name " ready in the input.
  const ask = useSearchParams().get("ask") ?? "";

  const convPath = wsPath("/conversations");
  const newChat = useCallback(async () => {
    try {
      const { id } = await api<{ id: string }>(convPath, { method: "POST" });
      setActiveId(id);
      setGoals({});
      setShowList(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [convPath]);

  // Open the latest conversation, or start one.
  useEffect(() => {
    api<{ conversations: { id: string }[] }>(convPath).then(
      (r) => {
        if (r.conversations[0]) setActiveId(r.conversations[0].id);
        else if (editable) newChat();
      },
      (e) => setError((e as Error).message),
    );
  }, [convPath, editable, newChat]);
  const projectsPath = wsPath("/projects");
  useEffect(() => {
    api<{ projects: ProjectSummary[] }>(projectsPath).then((r) => setProjects(r.projects), () => setProjects([]));
  }, [projectsPath]);

  const onStatus = useCallback((g: GoalDTO) => setGoals((prev) => ({ ...prev, [g.id]: g })), []);
  const running = Object.values(goals).find((g) => isActive(g.status));
  const workingIds = [...new Set(Object.values(goals).flatMap((g) => (isActive(g.status) ? g.working : [])))];
  const stop = running && editable ? { label: "Stop", onClick: () => api(wsPath(`/goals/${running.id}/cancel`), { method: "POST" }).catch((e) => setError((e as Error).message)) } : null;
  const doneCount = running ? running.tasks.filter((t) => t.status === "done").length : 0;
  const project = chip === "__new__" ? { kind: "new" } : chip ? { kind: "existing", id: chip } : { kind: "none" };
  const headReady = !!(head?.model && snapshot.connections.some((c) => c.id === head.connectionId));

  return (
    <div className="flex min-h-0 flex-1">
      <aside className={`${showList ? "block" : "hidden"} w-full shrink-0 border-r border-line bg-paper p-3 md:block md:w-64`}>
        <ConversationList activeId={activeId} onOpen={(id) => { setActiveId(id); setGoals({}); setShowList(false); }} onNew={newChat} refreshKey={refreshKey} onDeleted={(id, rest) => {
          if (id !== activeId) return;
          setGoals({});
          if (rest[0]) setActiveId(rest[0].id);
          else if (editable) newChat();
          else setActiveId(null);
        }} />
      </aside>
      <section className={`${showList ? "hidden" : "flex"} min-w-0 flex-1 flex-col md:flex`} aria-label="Chat with Nova">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-2.5">
          <button onClick={() => setShowList(true)} className="rounded-[8px] border border-line px-2.5 py-1 text-xs md:hidden">Chats</button>
          <TeamStrip workingIds={workingIds} />
        </div>
        {running && (
          <div role="status" className="flex items-center gap-3 border-b border-line bg-[#fff8e5] px-4 py-2 text-sm">
            <span className="flex-1">{running.status === "planning" ? "Nova is making a plan..." : `Team working · ${doneCount} of ${running.tasks.length} done`}</span>
            {stop && running.status !== "planning" && (
              <button onClick={stop.onClick} className="rounded-full bg-[#c62828] px-4 py-1.5 text-sm font-bold text-white">■ Stop</button>
            )}
          </div>
        )}
        {error && <p role="alert" className="bg-[#fde8e6] px-4 py-2 text-sm text-[#7a1b12]">{error}</p>}
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <SetupCard onChooseModel={() => head && setEditingHead(true)} />
          {activeId && (
            <ChatThread
              key={`${activeId}:${threadKey}`}
              initialDraft={ask}
              fill
              hideMeta
              // When Nova finishes a reply, the chat list picks up the new title.
              onThinking={(busy) => !busy && setRefreshKey((k) => k + 1)}
              path={`${convPath}/${activeId}`}
              postPath={`${convPath}/${activeId}/messages`}
              extraBody={() => ({ project })}
              name={head?.name ?? "Nova"}
              inputLabel={`Message ${head?.name ?? "Nova"}`}
              logLabel={`Chat with ${head?.name ?? "Nova"}`}
              placeholder="Ask anything, or tell the team what to do..."
              emptyText={`Hi! I'm ${head?.name ?? "Nova"}. What should the team work on today?`}
              examples={EXAMPLES}
              canSend={editable && headReady}
              goalStop={stop && running?.status !== "planning" ? stop : null}
              renderExtra={(m) =>
                m.goalId ? (
                  <GoalCard goalId={m.goalId} onStatus={onStatus} />
                ) : m.planBlocked ? (
                  <p className="mt-2 text-xs text-muted">{m.planBlocked === "busy" ? "The team was busy when you asked, so this wasn't planned yet. Press Plan it once they finish." : `This wasn't planned: ${m.planBlocked}`}</p>
                ) : null
              }
              suggestions={{
                // Planned from its message, so the plan card appears right here in the chat.
                onPlan: async (goal, _newProject, messageId) => {
                  await api(`${convPath}/${activeId}/messages/${messageId}/plan`, { method: "POST", body: { text: goal } });
                  setThreadKey((k) => k + 1);
                },
                onHire: setHire,
              }}
            />
          )}
          {editable && (
            <label className="mt-2 flex items-center gap-2 self-start text-xs text-muted">
              Working on
              <select value={chip} onChange={(e) => setChip(e.target.value)} aria-label="Working on" className="rounded-full border border-line bg-paper px-2 py-1 text-xs text-ink">
                <option value="">No project</option>
                <option value="__new__">New project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
      {editingHead && head && (
        <CompanionForm
          agent={head}
          preset={null}
          onClose={() => setEditingHead(false)}
          onSaved={async () => {
            setEditingHead(false);
            await reload();
          }}
        />
      )}
      {hire && (
        <CompanionForm
          agent={null}
          preset={hire}
          onClose={() => setHire(null)}
          onSaved={async () => {
            setHire(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}
