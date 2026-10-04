import type { ToolUseDTO } from "./activity.ts";
export type GoalStatus = "planning" | "awaiting_approval" | "running" | "reviewing" | "done" | "failed" | "cancelled";
export type TaskStatus = "pending" | "running" | "done" | "failed" | "skipped" | "interrupted";
export type TaskDTO = {
  id: string;
  position: number;
  agentId: string;
  agentName: string;
  title: string;
  instructions: string;
  deliverable: string;
  criteria: string[];
  dependsOn: number[];
  status: TaskStatus;
  result: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  filesRead: { path: string; revision: number }[];
  toolUses?: ToolUseDTO[];
  error: string | null;
  errorCode: string | null;
  verdict: "meets" | "needs_eyes" | null;
  verdictNote: string | null;
  rating: 1 | -1 | null;
  ratingReason: string | null;
  inputTokens: number;
  outputTokens: number;
};
export type EditDTO = { id: string; taskId: string; path: string; baseRevision: number; note: string; status: "pending" | "applied" | "rejected" | "stale"; reason: string | null };
export type GoalDTO = {
  id: string;
  text: string;
  status: GoalStatus;
  projectId: string | null;
  parent: { id: string; text: string } | null;
  newProject: boolean;
  projectName: string | null;
  summary: string | null;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  working: string[];
  tasks: TaskDTO[];
  edits: EditDTO[];
};
export type GoalListItem = { id: string; text: string; status: GoalStatus; projectId: string | null; createdAt: string };
export type DraftTask = Pick<TaskDTO, "agentId" | "title" | "instructions" | "deliverable" | "criteria" | "dependsOn">;

export const STATUS_LABEL: Record<GoalStatus, string> = {
  planning: "Nova is planning...",
  awaiting_approval: "Plan ready for your approval",
  running: "Companions are working",
  reviewing: "Nova is reviewing the results",
  done: "Done",
  failed: "Stopped",
  cancelled: "Cancelled",
};
export const RATING_REASONS = ["wrong facts", "off-brand", "too generic", "ignored files", "too long"] as const;
export const isActive = (s: GoalStatus) => s === "planning" || s === "running" || s === "reviewing";

/** "chat: ..." keeps talking to Nova directly; anything else becomes a company goal. */
export function parseCommand(text: string): { kind: "chat" | "goal"; text: string } {
  const t = text.trim();
  const m = /^chat:\s*/i.exec(t);
  return m ? { kind: "chat", text: t.slice(m[0].length).trim() } : { kind: "goal", text: t };
}

/** Removes a task from a draft plan and renumbers dependencies that pointed past it. */
export function removeTask(tasks: DraftTask[], index: number): DraftTask[] {
  return tasks.filter((_, i) => i !== index).map((t) => ({ ...t, dependsOn: t.dependsOn.filter((d) => d !== index).map((d) => (d > index ? d - 1 : d)) }));
}

const VERBS = /^(add|analy[sz]e|build|check|create|design|draft|edit|find|fix|improve|make|outline|plan|prepare|research|review|test|update|write)\b/i;

/** "Lina will design the landing page"; titles that don't start with a verb read "will work on: ...". */
export function planSentence(agentName: string, title: string): string {
  const t = title.trim();
  return VERBS.test(t) ? `${agentName} will ${t[0].toLowerCase()}${t.slice(1)}` : `${agentName} will work on: ${t}`;
}

/** Suggested changes still waiting for the owner, and the first task that has one. */
export function pendingChanges(goal: Pick<GoalDTO, "edits">): { count: number; firstTaskId: string | null } {
  const pending = goal.edits.filter((e) => e.status === "pending");
  return { count: pending.length, firstTaskId: pending[0]?.taskId ?? null };
}
