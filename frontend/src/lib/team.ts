import type { GoalDTO } from "./goals.ts";
import type { Agent, ConnectionSummary, Department, Role } from "./types.ts";

export type TeamStatus = { kind: "working"; task: string } | { kind: "free" } | { kind: "setup" } | { kind: "paused" } | { kind: "former" };
export type TeamGroup = { id: string; name: string; agents: Agent[] };

/** New companies name the head "Head agent"; owners see "Team lead" unless they chose their own wording. */
export const roleLabel = (a: Pick<Agent, "isHead" | "role">) => (a.isHead && a.role === "Head agent" ? "Team lead" : a.role);

export const isReady = (a: Agent, connections: ConnectionSummary[]) => a.kind === "human" || !!(a.model && connections.some((c) => c.id === a.connectionId && c.status === "connected"));

export const workingTasks = (goal: Pick<GoalDTO, "tasks"> | null) => new Map((goal?.tasks ?? []).filter((t) => t.status === "running").map((t) => [t.agentId, t.title] as const));

export function teamStatus(a: Agent, connections: ConnectionSummary[], working: Map<string, string>): TeamStatus {
  if (a.status === "archived") return { kind: "former" };
  if (a.status === "paused") return { kind: "paused" };
  const task = working.get(a.id);
  if (task) return { kind: "working", task };
  return isReady(a, connections) ? { kind: "free" } : { kind: "setup" };
}

export const statusText = (s: TeamStatus) => (s.kind === "working" ? `Working on: ${s.task}` : { free: "Free", setup: "Needs setup", paused: "Paused", former: "Former teammate" }[s.kind]);

export function groupTeam(agents: Agent[], departments: Department[]): { groups: TeamGroup[]; former: Agent[] } {
  const current = agents.filter((a) => a.status !== "archived");
  const rest = current.filter((a) => !a.isHead);
  const known = new Set(departments.map((d) => d.id));
  const groups: TeamGroup[] = [
    { id: "lead", name: "Team lead", agents: current.filter((a) => a.isHead) },
    ...[...departments].sort((x, y) => x.sortOrder - y.sortOrder).map((d) => ({ id: d.id, name: d.name, agents: rest.filter((a) => a.departmentId === d.id) })),
    { id: "none", name: "No department", agents: rest.filter((a) => !a.departmentId || !known.has(a.departmentId)) },
  ];
  return { groups: groups.filter((g) => g.agents.length), former: agents.filter((a) => a.status === "archived") };
}

export const canGiveTask = (role: Role, a: Agent) => role !== "viewer" && a.status !== "archived";

export function setupSteps(agents: Agent[], connections: ConnectionSummary[]) {
  const service = connections.some((c) => c.status === "connected");
  const head = agents.find((a) => a.isHead);
  const model = !!head && head.kind === "ai" && isReady(head, connections);
  return { service, model, done: service && model };
}
