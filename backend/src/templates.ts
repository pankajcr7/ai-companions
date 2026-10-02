import { randomBytes, randomUUID } from "node:crypto";
import { prisma, type Db } from "./db.js";
import type { Prisma } from "./generated/prisma/client.js";
import { autoLayout, type Layout } from "./layout.js";

export type TemplateKey = "starter" | "studio" | "head-only";
export type Look = {
  style: "robot" | "orb";
  color: string;
  head: "square" | "round" | "tall";
  eyes: "dots" | "visor" | "wide";
  accessory: "none" | "antenna" | "headset" | "cap";
};

export const DEFAULT_LOOK: Look = { style: "robot", color: "#a1a1aa", head: "square", eyes: "dots", accessory: "none" };

type Seed = { key: string; name: string; role: string; dept: string; manager?: string; style: string; look: Look };

const look = (color: string, head: Look["head"], eyes: Look["eyes"], accessory: Look["accessory"]): Look => ({ style: "robot", color, head, eyes, accessory });

const HEAD: Seed = {
  key: "head",
  name: "Nova",
  role: "Head agent",
  dept: "Leadership",
  style: "Calm and direct. Asks what is missing before work starts.",
  look: look("#a6ff00", "round", "visor", "antenna"),
};

export const TEMPLATES: Record<TemplateKey, { departments: string[]; agents: Seed[] }> = {
  "head-only": { departments: ["Leadership"], agents: [HEAD] },
  starter: {
    departments: ["Leadership", "Product", "Engineering", "Design", "Content"],
    agents: [
      HEAD,
      { key: "pm", name: "Priya", role: "Product manager", dept: "Product", manager: "head", style: "Turns goals into clear briefs.", look: look("#d4d4d8", "square", "dots", "headset") },
      { key: "dev", name: "Sana", role: "Full-stack developer", dept: "Engineering", manager: "head", style: "Ships small, tested changes.", look: look("#71717a", "tall", "visor", "none") },
      { key: "ux", name: "Lina", role: "UI/UX designer", dept: "Design", manager: "head", style: "Argues for the user.", look: look("#a1a1aa", "round", "wide", "cap") },
      { key: "cw", name: "Tomás", role: "Content writer", dept: "Content", manager: "head", style: "Short sentences, strong hooks.", look: look("#3f3f46", "square", "wide", "antenna") },
    ],
  },
  studio: {
    departments: ["Leadership", "Product", "Engineering", "Design", "Content", "Marketing"],
    agents: [
      HEAD,
      { key: "pm", name: "Priya", role: "Product manager", dept: "Product", manager: "head", style: "Turns goals into clear briefs.", look: look("#d4d4d8", "square", "dots", "headset") },
      { key: "em", name: "Rhea", role: "Engineering manager", dept: "Engineering", manager: "head", style: "Decides with evidence, writes it down.", look: look("#3f3f46", "square", "visor", "headset") },
      { key: "dev1", name: "Sana", role: "Frontend developer", dept: "Engineering", manager: "em", style: "Cares about first paint.", look: look("#a1a1aa", "tall", "dots", "none") },
      { key: "dev2", name: "Kofi", role: "Backend developer", dept: "Engineering", manager: "em", style: "Keeps data honest.", look: look("#52525b", "round", "visor", "antenna") },
      { key: "qa", name: "Mei", role: "QA engineer", dept: "Engineering", manager: "em", style: "Tries to break it first.", look: look("#e4e4e7", "tall", "wide", "cap") },
      { key: "dm", name: "Maya", role: "Design manager", dept: "Design", manager: "head", style: "Picks the simplest layout that works.", look: look("#71717a", "round", "dots", "headset") },
      { key: "ux", name: "Lina", role: "UI/UX designer", dept: "Design", manager: "dm", style: "Argues for the user.", look: look("#a1a1aa", "round", "wide", "cap") },
      { key: "cm", name: "Ines", role: "Content and social manager", dept: "Content", manager: "head", style: "Plans the calendar, guards the voice.", look: look("#27272a", "square", "visor", "headset") },
      { key: "sw1", name: "Tomás", role: "Scriptwriter", dept: "Content", manager: "cm", style: "Short sentences, strong hooks.", look: look("#3f3f46", "square", "wide", "antenna") },
      { key: "sw2", name: "Ari", role: "Scriptwriter", dept: "Content", manager: "cm", style: "Finds the human story.", look: look("#d4d4d8", "tall", "dots", "cap") },
      { key: "ed", name: "Jun", role: "Editor", dept: "Content", manager: "cm", style: "Cuts until it sings.", look: look("#52525b", "tall", "visor", "none") },
      { key: "mk", name: "Omar", role: "Marketing strategist", dept: "Marketing", manager: "head", style: "Every post needs a reason.", look: look("#71717a", "square", "dots", "antenna") },
    ],
  },
};

/** Recompute zones and desks after a structural change, keeping dragged desks where possible. */
export async function relayout(db: Db, workspaceId: string) {
  const departments = await db.department.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const agents = await db.agent.findMany({
    where: { workspaceId, status: { not: "archived" } },
    orderBy: [{ isHead: "desc" }, { createdAt: "asc" }, { name: "asc" }],
    select: { id: true, departmentId: true },
  });
  const current = await db.officeLayout.findUnique({ where: { workspaceId } });
  const layout = autoLayout(departments.map((d) => d.id), agents, current?.layout as Layout | undefined) as unknown as Prisma.InputJsonValue;
  await db.officeLayout.upsert({ where: { workspaceId }, create: { workspaceId, layout }, update: { layout } });
}

async function uniqueSlug(name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "company";
  // ponytail: check-then-insert can race; the unique index turns a race into a 409 the user can retry.
  for (let slug = base; ; slug = `${base}-${randomBytes(3).toString("hex")}`) {
    if (!(await prisma.workspace.findUnique({ where: { slug } }))) return slug;
  }
}

export async function createWorkspaceFromTemplate(userId: string, name: string, template: TemplateKey) {
  const t = TEMPLATES[template];
  const slug = await uniqueSlug(name);
  // Ids are made here so every row of a kind goes in one INSERT; Neon round trips dominate the cost.
  const deptIds = new Map(t.departments.map((d) => [d, randomUUID()]));
  const agentIds = new Map(t.agents.map((a) => [a.key, randomUUID()]));
  return prisma.$transaction(
    async (tx) => {
      const ws = await tx.workspace.create({ data: { name, slug, memberships: { create: { userId, role: "owner" } } } });
      await tx.department.createMany({ data: t.departments.map((d, i) => ({ id: deptIds.get(d)!, workspaceId: ws.id, name: d, sortOrder: i })) });
      // Self-referencing manager ids in one statement are fine: Postgres checks the foreign key at statement end.
      await tx.agent.createMany({
        data: t.agents.map((a) => ({
          id: agentIds.get(a.key)!,
          workspaceId: ws.id,
          name: a.name,
          role: a.role,
          workingStyle: a.style,
          isHead: a.key === "head",
          departmentId: deptIds.get(a.dept)!,
          managerId: a.manager ? agentIds.get(a.manager)! : null,
        })),
      });
      await tx.agentAppearance.createMany({ data: t.agents.map((a) => ({ agentId: agentIds.get(a.key)!, ...a.look })) });
      await relayout(tx, ws.id);
      await tx.auditLog.create({
        data: { workspaceId: ws.id, actorUserId: userId, action: "workspace.create", targetType: "workspace", targetId: ws.id, data: { template } },
      });
      return { id: ws.id, slug: ws.slug };
    },
    { timeout: 20_000 },
  );
}
