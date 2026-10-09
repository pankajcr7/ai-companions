"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { ArrowUpRight, CaretDown, ChatCircle, FolderSimple, Globe, PencilLine, Question, UsersThree } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isActive, type GoalDTO } from "@/lib/goals";
import type { ProjectSummary } from "@/lib/projects";
import type { HireSuggestion } from "@/lib/suggest";
import { isReady } from "@/lib/team";
import { useAppSidebar } from "../AppShell";
import { CompanionAvatar } from "../CompanionAvatar";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { ChatThread } from "../chat/ChatThread";
import { CompanionForm } from "../CompanionForm";
import { GoalCard } from "../goals/GoalCard";
import { ConversationList } from "./ConversationList";
import { SetupCard } from "./SetupCard";
import { TeamStrip } from "./TeamStrip";

const EXAMPLES = [
  { title: "Build a website", prompt: "Build a landing page for my bakery", icon: <Globe size={19} /> },
  { title: "Write content", prompt: "Write a week of Instagram posts", icon: <PencilLine size={19} /> },
  { title: "Research an idea", prompt: "Research three competitors and compare prices", icon: <ChatCircle size={19} /> },
];

/** Home: a full-page conversation with Nova. Work requests become plan cards in the chat. */
export function ChatHome() {
  const { snapshot, wsPath, reload } = useWorkspace();
  const editable = canEdit(snapshot.role);
  const head = snapshot.agents.find((a) => a.isHead);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const sidebar = useAppSidebar();
  const [creating, setCreating] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [goals, setGoals] = useState<Record<string, GoalDTO>>({});
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [chip, setChip] = useState("");
  const [error, setError] = useState("");
  const [threadKey, setThreadKey] = useState(0);
  const [hire, setHire] = useState<HireSuggestion | null>(null);
  const [editingHead, setEditingHead] = useState(false);
  // "Give a task" on the Team page opens home with "@Name " ready in the input.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Filled in once: later chats start empty, and the name leaves the address so a reload doesn't repeat it.
  const [ask, setAsk] = useState(() => params.get("ask") ?? "");
  useEffect(() => {
    if (params.has("ask")) router.replace(pathname);
  }, [params, router, pathname]);

  const convPath = wsPath("/conversations");
  const newChat = useCallback(async (keepAsk = false) => {
    if (!keepAsk) setAsk("");
    setCreating(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>(convPath, { method: "POST" });
      setActiveId(id);
      setGoals({});
      setChip("");
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [convPath, setAsk, setActiveId, setGoals, setChip, setRefreshKey]);

  // Open the latest conversation, or start one.
  useEffect(() => {
    api<{ conversations: { id: string }[] }>(convPath).then(
      (r) => {
        if (r.conversations[0]) setActiveId(r.conversations[0].id);
        else if (editable) newChat(true);
      },
      (e) => setError((e as Error).message),
    );
  }, [convPath, editable, newChat]);
  const projectsPath = wsPath("/projects");
  useEffect(() => {
    api<{ projects: ProjectSummary[] }>(projectsPath).then((r) => setProjects(r.projects), () => setProjects([]));
  }, [projectsPath]);

  const onStatus = useCallback((g: GoalDTO) => setGoals((prev) => ({ ...prev, [g.id]: g })), [setGoals]);
  const running = Object.values(goals).find((g) => isActive(g.status));
  const workingIds = [...new Set(Object.values(goals).flatMap((g) => (isActive(g.status) ? g.working : [])))];
  const stop = running && editable ? { label: "Stop", onClick: () => api(wsPath(`/goals/${running.id}/cancel`), { method: "POST" }).catch((e) => setError((e as Error).message)) } : null;
  const doneCount = running ? running.tasks.filter((t) => t.status === "done").length : 0;
  const project = chip === "__new__" ? { kind: "new" } : chip ? { kind: "existing", id: chip } : { kind: "none" };
  const headReady = !!head && isReady(head, snapshot.connections);
  const name = head?.name ?? "Nova";
  const base = `/w/${snapshot.workspace.slug}`;

  return (
    <div className="chat-home">
      {sidebar.history && createPortal(
        <ConversationList activeId={activeId} editable={editable} creating={creating} onOpen={(id) => { setAsk(""); setActiveId(id); setGoals({}); setChip(""); sidebar.close(); }} onNew={() => { void newChat(); sidebar.close(); }} refreshKey={refreshKey} onDeleted={(id, rest) => {
          if (id !== activeId) return;
          setGoals({});
          setAsk("");
          setChip("");
          if (rest[0]) setActiveId(rest[0].id);
          else if (editable) void newChat();
          else setActiveId(null);
        }} />, sidebar.history,
      )}
      <section className="chat-panel" aria-label={`Chat with ${name}`}>
        <header className="chat-header">
          <div className="chat-header-person">
            <span className="chat-header-avatar">{head ? <CompanionAvatar identity={head.id} look={head.appearance} size={34} /> : <ChatCircle size={24} />}</span>
            <div><p className="text-sm font-semibold">{name}<span className="chat-header-role">Your team lead</span></p><p className="chat-header-status"><span data-ready={headReady} />{running ? "Working with your team" : headReady ? "Ready to help" : "Let’s finish setup"}</p></div>
          </div>
          <div className="chat-header-actions">
            <details className="chat-team-menu">
              <summary><UsersThree size={18} /><span>Your team</span><CaretDown size={12} /></summary>
              <div className="chat-team-popover"><p className="mb-3 text-sm font-semibold">The people behind your ideas</p><TeamStrip workingIds={workingIds} /></div>
            </details>
            <button className="workspace-icon-button" onClick={() => setShowHelp((v) => !v)} aria-label="How chat works" aria-expanded={showHelp}><Question size={21} /></button>
          </div>
        </header>
        {showHelp && <div className="chat-help"><p><strong>Start with a message.</strong> Ask a question or describe what you want to make. {name} brings in your team when needed and shows you a plan to approve before work starts.</p><Link href={`${base}/team`}>Meet your team<ArrowUpRight size={14} /></Link></div>}
        {running && (
          <div role="status" className="chat-work-status">
            <span className="flex-1">{running.status === "planning" ? `${name} is making a plan...` : `Team working · ${doneCount} of ${running.tasks.length} done`}</span>
            {stop && running.status !== "planning" && (
              <button onClick={stop.onClick} className="rounded-full bg-[#c62828] px-4 py-1.5 text-sm font-bold text-white">■ Stop</button>
            )}
          </div>
        )}
        {error && <p role="alert" className="bg-[#fde8e6] px-4 py-2 text-sm text-[#7a1b12]">{error}</p>}
        <div className="chat-body">
          <SetupCard onChooseModel={() => head && setEditingHead(true)} />
          {activeId && (
            <ChatThread
              key={`${activeId}:${threadKey}`}
              initialDraft={ask}
              attachmentsPath={wsPath("/attachments")}
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
              placeholder={`Message ${name}… what would you like to work on?`}
              emptyText="What should the team work on today?"
              welcome={{
                avatar: head ? <CompanionAvatar identity={head.id} look={head.appearance} size={64} /> : <ChatCircle size={38} />,
                greeting: `A little help. A lot of possibility.`,
                title: "What would you like to create?",
                description: `I’m ${name}, your AI team lead. Tell me what you have in mind, and we’ll take it from there.`,
              }}
              disabledHint={editable ? "Finish the setup above to start chatting." : "You have view-only access. Ask your workspace owner for permission to chat."}
              composerTools={
                <label className="chat-project-picker"><FolderSimple size={17} /><span className="sr-only">Working on</span>
                  <select value={chip} onChange={(e) => setChip(e.target.value)} aria-label="Working on">
                    <option value="">Add a project</option>
                    <option value="__new__">New project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              }
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
                  setAsk("");
                  setThreadKey((k) => k + 1);
                },
                onHire: setHire,
              }}
            />
          )}
          {!activeId && !error && <div className="chat-loading" aria-busy={editable} aria-label={editable ? "Opening your chat" : "No conversations yet"}>{editable ? "Opening your chat…" : "Your team’s conversations will appear here."}</div>}

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
