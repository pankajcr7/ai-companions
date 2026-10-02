import { prisma } from "./db.js";
import type { Agent, AgentAppearance, Role } from "./generated/prisma/client.js";
import type { Layout } from "./layout.js";
import { DEFAULT_LOOK, type Look } from "./templates.js";

export function toAgentDTO(a: Agent & { appearance: AgentAppearance | null }) {
  const look = a.appearance
    ? ({ style: a.appearance.style, color: a.appearance.color, head: a.appearance.head, eyes: a.appearance.eyes, accessory: a.appearance.accessory } as Look)
    : DEFAULT_LOOK;
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    kind: a.kind,
    workingStyle: a.workingStyle,
    status: a.status,
    isHead: a.isHead,
    departmentId: a.departmentId,
    managerId: a.managerId,
    connectionId: a.connectionId,
    model: a.model,
    appearance: look,
  };
}

export async function snapshot(workspaceId: string, userId: string, role: Role) {
  const [workspace, departments, agents, layout, pref, connections] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { id: true, name: true, slug: true } }),
    prisma.department.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, sortOrder: true } }),
    prisma.agent.findMany({ where: { workspaceId }, orderBy: [{ isHead: "desc" }, { createdAt: "asc" }, { name: "asc" }], include: { appearance: true } }),
    prisma.officeLayout.findUnique({ where: { workspaceId } }),
    prisma.userPreference.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } }),
    prisma.providerConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, label: true, hint: true, status: true } }),
  ]);
  return {
    workspace,
    role,
    departments,
    agents: agents.map(toAgentDTO),
    connections,
    layout: (layout?.layout as Layout | undefined) ?? { zones: [], desks: {} },
    preferences: { theme: pref?.theme ?? "system", reducedMotion: pref?.reducedMotion ?? false, calmMode: pref?.calmMode ?? false },
  };
}
