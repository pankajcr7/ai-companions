"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isActive, type GoalDTO } from "@/lib/goals";
import type { ProjectSummary } from "@/lib/projects";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { ChatThread } from "../chat/ChatThread";
import { GoalCard } from "../goals/GoalCard";
import { ConversationList } from "./ConversationList";
import { TeamStrip } from "./TeamStrip";

const EXAMPLES = ["Build a landing page for my bakery", "Write a week of Instagram posts", "Research three competitors and compare prices"];

/** Home: a full-page conversation with Nova. Work requests become plan cards in the chat. */
export function ChatHome() {
  const { snapshot, wsPath } = useWorkspace();
  const editable = canEdit(snapshot.role);
  const head = snapshot.agents.find((a) => a.isHead);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showList, setShowList] = useState(false);
  const [goals, setGoals] = useState<Record<string, GoalDTO>>({});
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [chip, setChip] = useState("");
  const [error, setError] = useState("");

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
        <ConversationList activeId={activeId} onOpen={(id) => { setActiveId(id); setGoals({}); setShowList(false); }} onNew={newChat} refreshKey={refreshKey} />
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
          {!headReady && <p className="mb-3 rounded-[10px] bg-bg px-3 py-2 text-sm">Nova needs an AI model before it can help. Open <b>See whole team</b>, choose Nova, and press Customize.</p>}
          {activeId && (
            <ChatThread
              key={activeId}
              fill
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
              renderExtra={(m) => (m.goalId ? <GoalCard goalId={m.goalId} onStatus={onStatus} /> : null)}
              suggestions={{
                onPlan: async (goal, newProject) => {
                  await api(wsPath("/goals"), { method: "POST", body: { text: goal, newProject } });
                  setRefreshKey((k) => k + 1);
                },
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
    </div>
  );
}
