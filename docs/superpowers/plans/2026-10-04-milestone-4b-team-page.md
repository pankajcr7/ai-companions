# Milestone 4b: Team Page, Simpler Navigation, Plain Language — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the office map page and Organization page with a friendly Team page and full companion pages, shrink the sidebar to Home · Team · Projects · Settings, guide first-run setup, and remove technical words from app screens.

**Architecture:** Frontend reorganization on Next.js App Router plus one backend read route. Pure team logic (status, grouping, labels) lives in `frontend/src/lib/team.ts` with node unit tests; pages compose existing pieces (`CompanionChat`, `CompanionForm`, `OfficeScene`, the providers page content). Old URLs become server-side `redirect()` stubs.

**Tech Stack:** Next.js 16 (App Router, React 19, React Compiler lint), Tailwind 4, Phosphor icons, Fastify 5, Prisma 7, Zod 4, Vitest, Playwright, `node --test` for frontend unit tests.

**Spec:** `docs/superpowers/specs/2026-10-04-milestone-4b-team-page-design.md`

## Global Constraints

- Run every git command from the repo root `/Users/newlaptopparts/Documents/ai-companions` (`frontend/` contains a nested repo; git inside it misbehaves).
- Backend tests share one Neon test database and `globalSetup` truncates it: never run two backend test runs, or a backend run and Playwright, at the same time. Prefix long runs with `caffeinate -i`.
- Never touch the main database, never print `.env` values, never kill the user's dev servers on ports 3000 and 4000.
- Frontend checks: `cd frontend && npx tsc --noEmit && npx eslint src e2e && npm run test:unit`. Backend checks: `cd backend && npx tsc --noEmit -p . && npx vitest run <file>`. E2E: `cd frontend && npx playwright test <spec> --reporter=line` (starts its own stack on ports 3100/4100 and the fake LLM on 4199).
- Code, API, and database names stay unchanged; only on-screen words change (spec §1.7).
- Code style: one-line Tailwind class strings, existing helpers (`api`, `useWorkspace`, `canEdit`, `canAdmin`, `CompanionAvatar`, `CompanionForm`), comments only where the reason isn't obvious, no new dependencies.
- localStorage access is always wrapped in try/catch and the page works without it.
- Screens must work at 390px wide (16px side gutter, no horizontal page scroll) and in dark mode (use the existing `bg-paper`, `bg-bg`, `text-ink`, `text-muted`, `border-line` tokens).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A companion page opened for an id that doesn't exist, or for a former (archived) teammate: shows "This teammate wasn't found" / a Restore button, never a crash. Pinned in Task 4's e2e.
2. Coming back from ChatGPT sign-in after `/providers` moved: the `connected` / `chatgpt_error` query must survive the redirect and show its notice. Pinned in Task 1 (backend target) and Task 6 (redirect keeps the query, e2e).
3. Viewers (read-only members): Team page hides Add, Organize, Give a task; companion page hides Edit/Pause/Archive; setup card says "Ask the company owner to finish setup". Pinned in Task 2 unit test (`canGiveTask`) and Task 7 setup-card logic test.
4. A renamed head agent (role no longer "Head agent") keeps the owner's wording instead of being forced to "Team lead". Pinned in Task 2 unit test.
5. "Give a task" with a name containing spaces or symbols ("Mira & Co") arrives intact in the home input. Pinned in Task 7 e2e (URL-encoded `ask`).

---

### Task 1: Backend — recent tasks route, ChatGPT return URL, plain error words

**Files:**
- Modify: `backend/src/routes/agents.ts` (add route at the end of `agentRoutes`)
- Modify: `backend/src/routes/chatgpt.ts:50-55`
- Modify: `backend/src/routes/chat.ts:68`, `backend/src/chatgpt-oauth.ts:111`
- Test: `backend/test/agent-tasks.test.ts` (new), `backend/test/chatgpt.test.ts:106`

**Interfaces:**
- Produces: `GET /api/workspaces/:id/agents/:agentId/tasks?limit=N` → `{ tasks: { id: string; title: string; finishedAt: string; goalId: string; goalText: string }[] }`, done tasks only, newest `finishedAt` first, `limit` 1–20 default 5, 404 `"Companion not found"` when the agent isn't in that workspace. Any member (viewer included).
- Produces: ChatGPT callback redirects to `/w/<slug>/settings?tab=ai&connected=chatgpt` and errors to `/w/<slug>/settings?tab=ai&chatgpt_error=<msg>`.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/agent-tasks.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function company(req: ReturnType<typeof client>, name: string) {
  const id = (await req("POST", "/api/workspaces", { name, template: "starter" })).json().id as string;
  const snap = (await req("GET", `/api/workspaces/${id}`)).json();
  return { id, agents: snap.agents as { id: string; isHead: boolean }[] };
}

test("a companion's recent work: finished tasks only, newest first, limited", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const co = await company(req, "Tasks Co");
  const me = (await req("GET", "/api/me")).json().user.id as string;
  const agent = co.agents.find((a) => !a.isHead)!;
  const goal = await prisma.goal.create({ data: { workspaceId: co.id, text: "Launch the shop", createdById: me, status: "done" } });
  const t0 = Date.now() - 100_000;
  await prisma.goalTask.createMany({
    data: [
      ...Array.from({ length: 7 }, (_, i) => ({ goalId: goal.id, agentId: agent.id, position: i, title: `Task ${i}`, instructions: "i", deliverable: "d", status: "done" as const, finishedAt: new Date(t0 + i * 1000) })),
      { goalId: goal.id, agentId: agent.id, position: 7, title: "Still going", instructions: "i", deliverable: "d", status: "running" as const },
      { goalId: goal.id, agentId: co.agents.find((a) => a.isHead)!.id, position: 8, title: "Someone else", instructions: "i", deliverable: "d", status: "done" as const, finishedAt: new Date() },
    ],
  });

  const res = await req("GET", `/api/workspaces/${co.id}/agents/${agent.id}/tasks`);
  expect(res.statusCode).toBe(200);
  expect(res.json().tasks.map((t: { title: string }) => t.title)).toEqual(["Task 6", "Task 5", "Task 4", "Task 3", "Task 2"]);
  expect(res.json().tasks[0]).toMatchObject({ goalId: goal.id, goalText: "Launch the shop" });
  const two = await req("GET", `/api/workspaces/${co.id}/agents/${agent.id}/tasks?limit=2`);
  expect(two.json().tasks).toHaveLength(2);
  expect((await req("GET", `/api/workspaces/${co.id}/agents/${agent.id}/tasks?limit=50`)).statusCode).toBe(400);
});

test("another company's companion is not found", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const a = await company(req, "Alpha Co");
  const b = await company(req, "Beta Co");
  const res = await req("GET", `/api/workspaces/${b.id}/agents/${a.agents[0].id}/tasks`);
  expect(res.statusCode).toBe(404);
});
```

In `backend/test/chatgpt.test.ts` line 106 change the expectation to:

```ts
  expect(cb.headers.location).toBe(`http://localhost:3000/w/${slug}/settings?tab=ai&connected=chatgpt`);
```

Also search that file for other `/providers` expectations (`grep -n "/providers" backend/test/chatgpt.test.ts`) and change each to `/settings?tab=ai&` followed by the query that was after `?`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && caffeinate -i npx vitest run test/agent-tasks.test.ts test/chatgpt.test.ts`
Expected: agent-tasks fails with 404 for the route; chatgpt fails on the location header.

- [ ] **Step 3: Implement**

Append inside `agentRoutes` in `backend/src/routes/agents.ts` (after the clone route):

```ts
  // A companion's recent finished work, for their profile page.
  app.get("/api/workspaces/:id/agents/:agentId/tasks", async (req) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) }).parse(req.query);
    await requireMember(req, id);
    const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: id }, select: { id: true } });
    if (!agent) throw new HttpError(404, "not_found", "Companion not found");
    const rows = await prisma.goalTask.findMany({
      where: { agentId, status: "done", goal: { workspaceId: id } },
      orderBy: { finishedAt: "desc" },
      take: limit,
      select: { id: true, title: true, finishedAt: true, goalId: true, goal: { select: { text: true } } },
    });
    return { tasks: rows.map((t) => ({ id: t.id, title: t.title, finishedAt: t.finishedAt, goalId: t.goalId, goalText: t.goal.text })) };
  });
```

In `backend/src/routes/chatgpt.ts` replace the two redirect targets:

```ts
      return reply.redirect(`${frontend()}/w/${pending.slug}/settings?tab=ai&connected=chatgpt`);
```

```ts
      const target = p ? `/w/${p.slug}/settings?tab=ai&` : "/app?";
      return reply.redirect(`${frontend()}${target}chatgpt_error=${encodeURIComponent(message)}`);
```

Plain words: in `backend/src/routes/chat.ts:68` change the message to `"Sign in to ChatGPT again in Settings › AI services"`; in `backend/src/chatgpt-oauth.ts:111` change `"Start again from AI providers."` to `"Start again from Settings › AI services."`. Then `grep -rn "AI providers" backend/src backend/test` and update any test expecting the old text.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx tsc --noEmit -p . && caffeinate -i npx vitest run test/agent-tasks.test.ts test/chatgpt.test.ts test/chat.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/agents.ts backend/src/routes/chatgpt.ts backend/src/routes/chat.ts backend/src/chatgpt-oauth.ts backend/test/agent-tasks.test.ts backend/test/chatgpt.test.ts backend/test/chat.test.ts
git commit -m "feat(backend): companions' recent work; ChatGPT sign-in returns to Settings › AI services"
```

---

### Task 2: Team logic and live work hook

**Files:**
- Create: `frontend/src/lib/team.ts`, `frontend/src/lib/team.test.ts`, `frontend/src/components/app/team/useActiveWork.ts`

**Interfaces:**
- Consumes: `Agent`, `Department`, `ConnectionSummary`, `Role` from `frontend/src/lib/types.ts`; `GoalDTO`, `isActive` from `frontend/src/lib/goals.ts`; `canEdit` from types.
- Produces (all exported from `lib/team.ts`):
  - `type TeamStatus = { kind: "working"; task: string } | { kind: "free" } | { kind: "setup" } | { kind: "paused" } | { kind: "former" }`
  - `roleLabel(a: Pick<Agent, "isHead" | "role">): string`
  - `isReady(a: Agent, connections: ConnectionSummary[]): boolean`
  - `workingTasks(goal: Pick<GoalDTO, "tasks"> | null): Map<string, string>` (agentId → running task title)
  - `teamStatus(a: Agent, connections: ConnectionSummary[], working: Map<string, string>): TeamStatus`
  - `statusText(s: TeamStatus): string`
  - `type TeamGroup = { id: string; name: string; agents: Agent[] }`
  - `groupTeam(agents: Agent[], departments: Department[]): { groups: TeamGroup[]; former: Agent[] }`
  - `canGiveTask(role: Role, a: Agent): boolean`
- Produces: `useActiveWork(): GoalDTO | null` from `components/app/team/useActiveWork.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/team.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, ConnectionSummary, Department } from "./types.ts";
import { canGiveTask, groupTeam, isReady, roleLabel, statusText, teamStatus, workingTasks } from "./team.ts";

const look = { style: "robot", color: "#000000", head: "round", eyes: "dots", accessory: "none" } as Agent["appearance"];
const agent = (o: Partial<Agent>): Agent => ({ id: "a", name: "A", role: "Writer", kind: "ai", workingStyle: "", status: "active", isHead: false, departmentId: null, managerId: null, appearance: look, connectionId: "c1", model: "m", ...o });
const conns: ConnectionSummary[] = [{ id: "c1", kind: "custom", label: "Fake", hint: "x", status: "connected" }];

test("the head's default role reads as Team lead; a renamed role stays", () => {
  assert.equal(roleLabel({ isHead: true, role: "Head agent" }), "Team lead");
  assert.equal(roleLabel({ isHead: true, role: "Chief of staff" }), "Chief of staff");
  assert.equal(roleLabel({ isHead: false, role: "Head agent" }), "Head agent");
});

test("ready means an AI model on a connected service; humans are always ready", () => {
  assert.equal(isReady(agent({}), conns), true);
  assert.equal(isReady(agent({ model: null }), conns), false);
  assert.equal(isReady(agent({ connectionId: "gone" }), conns), false);
  assert.equal(isReady(agent({}), [{ ...conns[0], status: "reauth" }]), false);
  assert.equal(isReady(agent({ kind: "human", model: null, connectionId: null }), conns), true);
});

test("status: former, paused, working, free, needs setup", () => {
  const working = workingTasks({ tasks: [{ agentId: "a", title: "Write posts", status: "running" }, { agentId: "b", title: "Done one", status: "done" }] as never });
  assert.deepEqual([...working], [["a", "Write posts"]]);
  assert.deepEqual(teamStatus(agent({ status: "archived" }), conns, working), { kind: "former" });
  assert.deepEqual(teamStatus(agent({ status: "paused" }), conns, working), { kind: "paused" });
  assert.deepEqual(teamStatus(agent({}), conns, working), { kind: "working", task: "Write posts" });
  assert.deepEqual(teamStatus(agent({ id: "b" }), conns, working), { kind: "free" });
  assert.deepEqual(teamStatus(agent({ id: "b", model: null }), conns, working), { kind: "setup" });
  assert.equal(statusText({ kind: "working", task: "Write posts" }), "Working on: Write posts");
  assert.equal(statusText({ kind: "setup" }), "Needs setup");
  assert.equal(workingTasks(null).size, 0);
});

test("grouping: lead first, departments in order, then no department; former apart; empty groups dropped", () => {
  const depts: Department[] = [{ id: "d2", name: "Sales", sortOrder: 2 }, { id: "d1", name: "Design", sortOrder: 1 }, { id: "d3", name: "Empty", sortOrder: 3 }];
  const team = [agent({ id: "h", isHead: true, departmentId: "d1" }), agent({ id: "s", departmentId: "d2" }), agent({ id: "x", departmentId: "d1" }), agent({ id: "n" }), agent({ id: "lost", departmentId: "deleted" }), agent({ id: "old", status: "archived" })];
  const { groups, former } = groupTeam(team, depts);
  assert.deepEqual(groups.map((g) => [g.name, g.agents.map((a) => a.id)]), [["Team lead", ["h"]], ["Design", ["x"]], ["Sales", ["s"]], ["No department", ["n", "lost"]]]);
  assert.deepEqual(former.map((a) => a.id), ["old"]);
});

test("only members and admins can give tasks, and only to current teammates", () => {
  assert.equal(canGiveTask("owner", agent({})), true);
  assert.equal(canGiveTask("viewer", agent({})), false);
  assert.equal(canGiveTask("member", agent({ status: "archived" })), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — `Cannot find module './team.ts'`.

- [ ] **Step 3: Implement**

First check `Role` and `canEdit` exist in `frontend/src/lib/types.ts` (`grep -n "export type Role\|export const canEdit" frontend/src/lib/types.ts`); use them as named there. Create `frontend/src/lib/team.ts`:

```ts
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
```

If `types.ts` names roles differently (e.g. `"viewer"` spelled otherwise), match it. Create `frontend/src/components/app/team/useActiveWork.ts`:

```ts
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isActive, type GoalDTO } from "@/lib/goals";
import { useWorkspace } from "@/lib/workspace";

/** The company's goal in progress, refreshed every 3 seconds while one runs and every 15 seconds otherwise. */
export function useActiveWork(): GoalDTO | null {
  const { wsPath } = useWorkspace();
  const [goal, setGoal] = useState<GoalDTO | null>(null);
  const path = wsPath("/goals");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      let next: GoalDTO | null = null;
      try {
        const { goals } = await api<{ goals: { id: string; status: GoalDTO["status"] }[] }>(path);
        const active = goals.find((g) => isActive(g.status));
        next = active ? (await api<{ goal: GoalDTO }>(`${path}/${active.id}`)).goal : null;
      } catch {
        // Keep showing the last known state; the next tick tries again.
      }
      if (stopped) return;
      setGoal(next);
      timer = setTimeout(tick, next ? 3000 : 15000);
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [path]);
  return goal;
}
```

- [ ] **Step 4: Run checks**

Run: `cd frontend && npm run test:unit && npx tsc --noEmit && npx eslint src/lib src/components/app/team`
Expected: all unit tests pass (previous 17 plus the new 5); tsc and eslint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/team.ts frontend/src/lib/team.test.ts frontend/src/components/app/team/useActiveWork.ts
git commit -m "feat(frontend): team status, grouping and live work for the Team page"
```

---

### Task 3: E2E setup helper; specs stop depending on the office command bar

The office command bar and the providers page are about to move. This task makes every existing spec set up its company through one helper (UI sign-up, API connection) and start goals through the API plus the full goal page, so later tasks only change what they own.

**Files:**
- Create: `frontend/e2e/setup.ts`
- Modify: `frontend/e2e/chat.spec.ts`, `frontend/e2e/goals.spec.ts`, `frontend/e2e/build.spec.ts`, `frontend/e2e/home.spec.ts`, `frontend/e2e/projects.spec.ts` (only if it contains the same setup block)

**Interfaces:**
- Produces (from `e2e/setup.ts`):
  - `newCompany(page: Page, o: { prefix: string; company: string; template: RegExp }): Promise<{ id: string; slug: string }>`
  - `connectFakeLLM(page: Page, id: string, who?: "head" | "all"): Promise<string>` (returns the connection id; gives the chosen AI companions `model: "fake-model"` on it)
  - `startGoal(page: Page, c: { id: string; slug: string }, body: { text: string; projectId?: string; newProject?: boolean }): Promise<string>` (creates the goal through the API, opens `/w/<slug>/goals/<gid>`, returns the goal id)

- [ ] **Step 1: Write the helper**

Create `frontend/e2e/setup.ts`:

```ts
import { expect, type Page } from "@playwright/test";

const headers = { origin: "http://localhost:3100" };

/** Signs up a new owner through the UI and creates their company. */
export async function newCompany(page: Page, o: { prefix: string; company: string; template: RegExp }) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(`${o.prefix} Owner`);
  await page.getByLabel("Email").fill(`${o.prefix.toLowerCase()}-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill(o.company);
  await page.getByRole("radio", { name: o.template }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/[^/]+$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  const me = await (await page.request.get("/api/me")).json();
  return { id: me.workspaces.find((w: { slug: string }) => w.slug === slug).id as string, slug };
}

/** Connects the fake model server and gives the head agent (or every AI companion) its model. */
export async function connectFakeLLM(page: Page, id: string, who: "head" | "all" = "head") {
  const res = await page.request.post(`/api/workspaces/${id}/connections`, { headers, data: { kind: "custom", label: "Fake LLM", baseUrl: "http://127.0.0.1:4199/v1" } });
  expect(res.status()).toBe(201);
  const connectionId = (await res.json()).id as string;
  const snap = await (await page.request.get(`/api/workspaces/${id}`)).json();
  for (const a of snap.agents.filter((x: { kind: string; isHead: boolean }) => x.kind === "ai" && (who === "all" || x.isHead))) {
    const patch = await page.request.patch(`/api/workspaces/${id}/agents/${a.id}`, { headers, data: { connectionId, model: "fake-model" } });
    expect(patch.ok()).toBe(true);
  }
  await page.reload();
  return connectionId;
}

/** Starts planning a goal and opens its full page. */
export async function startGoal(page: Page, c: { id: string; slug: string }, body: { text: string; projectId?: string; newProject?: boolean }) {
  const res = await page.request.post(`/api/workspaces/${c.id}/goals`, { headers, data: body });
  expect(res.status()).toBe(201);
  const gid = (await res.json()).id as string;
  await page.goto(`/w/${c.slug}/goals/${gid}`);
  return gid;
}
```

Check `POST /goals` returns 201 (`grep -n "code(201)" backend/src/routes/goals.ts`); if it returns 200, use `expect(res.ok()).toBe(true)` instead.

- [ ] **Step 2: Move the specs onto the helper**

In each of `chat.spec.ts`, `goals.spec.ts`, `build.spec.ts`, `home.spec.ts` (and `projects.spec.ts` if it has the block): replace everything from `await page.goto("/sign-up")` through the Nova model `form ... toBeHidden()` (and a following `Close details` click, if any) with:

```ts
  const co = await newCompany(page, { prefix: "Chat", company: "Chat Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);
```

keeping each spec's own prefix, company name, and template radio. Add `import { connectFakeLLM, newCompany, startGoal } from "./setup";` (only the names used).

Specific rewrites:
- `chat.spec.ts`: this spec tests the AI services UI itself, so keep its "Add endpoint" connection and its Office/Customize steps (Task 4 moves them). Only replace its sign-up block with `const co = await newCompany(page, { prefix: "Chat", company: "Chat Bakery", template: /Just the head agent/ });` and delete the block from `// The office command bar sends to the head agent` up to (not including) `// Nova knows the team`. Everything else stays.
- `goals.spec.ts`: replace the three lines from `getByRole("link", { name: "Office map" ...` through `Send to your company` with:

```ts
  const projectId = new URL(page.url()).pathname.split("/").pop()!;
  await startGoal(page, co, { text: "Document the math helper", projectId });
```

  Place the `projectId` line right after the project heading assertion (the URL is `/w/<slug>/projects/<pid>` there). The rest of the spec keeps using `page.getByRole("complementary", { name: "Company goal" })`, which the full goal page renders.
- `build.spec.ts`: replace the `Project for this goal` / `Tell your company what to do` / `Send to your company` lines with `await startGoal(page, co, { text: "Build a landing page for my bakery", newProject: true });`.
- `home.spec.ts`: replace its sign-up and Office/Customize setup with the helper; it then goes straight to `page.goto(\`/w/${co.slug}\`)` (it is already on home after `connectFakeLLM` reloads). Remove the `Home` link click if it now duplicates.

- [ ] **Step 3: Run the affected specs**

Run: `cd frontend && npx tsc --noEmit && npx eslint e2e && caffeinate -i npx playwright test e2e/chat.spec.ts e2e/goals.spec.ts e2e/build.spec.ts e2e/home.spec.ts e2e/projects.spec.ts --reporter=line`
Expected: 5 passed. If `build.spec` fails because the plan editor's project-name field only exists when the goal came from the office, read the failure and adjust only the selector, not the app.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e
git commit -m "test(e2e): shared company setup; goals start through the API and the goal page"
```

---

### Task 4: Companion page

**Files:**
- Create: `frontend/src/app/w/[slug]/team/[id]/page.tsx`, `frontend/src/components/app/team/CompanionPage.tsx`, `frontend/e2e/team.spec.ts`
- Modify: `frontend/e2e/chat.spec.ts` (companion chat moves from the office panel to the page)

**Interfaces:**
- Consumes: `useActiveWork`, `teamStatus`, `statusText`, `roleLabel`, `workingTasks`, `canGiveTask` (Task 2); `GET /agents/:agentId/tasks` (Task 1); `CompanionChat`, `CompanionForm`, `CompanionAvatar`.
- Produces: route `/w/<slug>/team/<agentId>`; exported `StatusPill({ status }: { status: TeamStatus })` from `CompanionPage.tsx` (reused by Task 5's cards).

- [ ] **Step 1: Write the failing e2e**

Create `frontend/e2e/team.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("a companion's page: profile, chat, edit, and a missing teammate", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Team", company: "Team Bakery", template: /Starter/ });
  await connectFakeLLM(page, co.id);
  const snap = await (await page.request.get(`/api/workspaces/${co.id}`)).json();
  const nova = snap.agents.find((a: { isHead: boolean }) => a.isHead);

  await page.goto(`/w/${co.slug}/team/${nova.id}`);
  const about = page.getByRole("region", { name: "About Nova" });
  await expect(about.getByRole("heading", { name: "Nova" })).toBeVisible();
  await expect(about.getByText("Team lead")).toBeVisible();
  await expect(about.getByText("Free")).toBeVisible();
  await expect(about.getByText("No finished work yet.")).toBeVisible();

  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await chat.getByLabel("Message Nova").fill("Hello Nova");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Hello from the fake model.")).toBeVisible();

  await about.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill("Nova Prime");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("region", { name: "About Nova Prime" }).getByRole("heading", { name: "Nova Prime" })).toBeVisible();

  const other = snap.agents.find((a: { isHead: boolean }) => !a.isHead);
  await page.goto(`/w/${co.slug}/team/${other.id}`);
  await expect(page.getByText("Needs setup").first()).toBeVisible();
  await expect(page.getByRole("region", { name: `Chat with ${other.name}` }).getByRole("button", { name: "Choose a model" })).toBeVisible();

  await page.goto(`/w/${co.slug}/team/does-not-exist`);
  await expect(page.getByText("This teammate wasn't found")).toBeVisible();
  await page.getByRole("link", { name: "Back to team" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${co.slug}/team$`));
});
```

(The final URL check passes once Task 5 adds the Team page; until then Next shows its 404 at that URL but the URL assertion still holds.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && caffeinate -i npx playwright test e2e/team.spec.ts --reporter=line`
Expected: FAIL — region "About Nova" not found (404 page).

- [ ] **Step 3: Implement the page**

Create `frontend/src/app/w/[slug]/team/[id]/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import { CompanionPage } from "@/components/app/team/CompanionPage";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <CompanionPage key={id} agentId={id} />;
}
```

Create `frontend/src/components/app/team/CompanionPage.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Archive, ArrowLeft, Copy, Pause, PencilSimple, Play } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { HireSuggestion } from "@/lib/suggest";
import { roleLabel, statusText, teamStatus, workingTasks, type TeamStatus } from "@/lib/team";
import { canEdit, type Agent } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "../CompanionAvatar";
import { CompanionChat } from "../CompanionChat";
import { CompanionForm } from "../CompanionForm";
import { useActiveWork } from "./useActiveWork";

type Recent = { id: string; title: string; finishedAt: string; goalId: string; goalText: string };
const PILL: Record<TeamStatus["kind"], string> = {
  working: "bg-[#fff4d6] text-[#7a5200]",
  free: "bg-[#e3f4e1] text-[#22642a]",
  setup: "bg-bg text-muted",
  paused: "bg-bg text-muted",
  former: "bg-bg text-muted",
};

export function StatusPill({ status }: { status: TeamStatus }) {
  return <span className={`inline-block max-w-full truncate rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[status.kind]}`}>{statusText(status)}</span>;
}

/** A teammate's own page: who they are, what they're doing, what they've done, and a chat with them. */
export function CompanionPage({ agentId }: { agentId: string }) {
  const { snapshot, reload, wsPath } = useWorkspace();
  const router = useRouter();
  const base = `/w/${snapshot.workspace.slug}`;
  const agent = snapshot.agents.find((a) => a.id === agentId) ?? null;
  const goal = useActiveWork();
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [editing, setEditing] = useState<"self" | "new" | null>(null);
  const [hire, setHire] = useState<HireSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = canEdit(snapshot.role);
  const tasksPath = wsPath(`/agents/${agentId}/tasks?limit=5`);

  useEffect(() => {
    if (!agent) return;
    api<{ tasks: Recent[] }>(tasksPath).then((r) => setRecent(r.tasks), () => setRecent([]));
  }, [agent, tasksPath]);

  if (!agent) {
    return (
      <main className="p-6">
        <p className="font-medium">This teammate wasn&apos;t found</p>
        <Link href={`${base}/team`} className="mt-2 inline-block text-sm underline">Back to team</Link>
      </main>
    );
  }

  const status = teamStatus(agent, snapshot.connections, workingTasks(goal));
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const setStatus = (s: Agent["status"]) => run(() => api(wsPath(`/agents/${agent.id}`), { method: "PATCH", body: { status: s } }));

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row">
      <section aria-label={`About ${agent.name}`} className="min-w-0 lg:w-80 lg:shrink-0 lg:overflow-y-auto">
        <Link href={`${base}/team`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Back to team</Link>
        <div className="mt-4 flex items-center gap-4">
          <CompanionAvatar look={agent.appearance} size={72} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold">{agent.name}</h1>
            <p className="text-sm text-muted">{roleLabel(agent)}{agent.kind === "human" ? " · person" : ""}</p>
          </div>
        </div>
        <div className="mt-3"><StatusPill status={status} /></div>
        {status.kind === "working" && goal && (
          <p className="mt-3 text-sm">Now working on <Link href={`${base}/goals/${goal.id}`} className="font-semibold underline">{status.task}</Link></p>
        )}
        {agent.workingStyle && <p className="mt-3 text-sm text-muted">{agent.workingStyle}</p>}

        <h2 className="mt-6 text-sm font-semibold">Recent work</h2>
        {recent === null ? (
          <div className="mt-2 h-12 animate-pulse rounded-[10px] bg-bg" aria-busy="true" />
        ) : recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No finished work yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {recent.map((t) => (
              <li key={t.id}>
                <Link href={`${base}/goals/${t.goalId}`} className="block rounded-[8px] px-2 py-1.5 text-sm hover:bg-bg">
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block truncate text-xs text-muted">{new Date(t.finishedAt).toLocaleDateString()} · {t.goalText}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
        {editable && (
          <div className="mt-6 flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => setEditing("self")} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><PencilSimple size={14} /> {status.kind === "setup" ? "Set up" : "Edit"}</button>
            {agent.status === "archived" ? (
              <button disabled={busy} onClick={() => setStatus("active")} className="btn-light rounded-[10px] px-3 py-2 text-sm font-semibold">Restore</button>
            ) : (
              <button disabled={busy} onClick={() => setStatus(agent.status === "paused" ? "active" : "paused")} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold">
                {agent.status === "paused" ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}
              </button>
            )}
            <button disabled={busy} onClick={() => run(async () => router.push(`${base}/team/${(await api<{ id: string }>(wsPath(`/agents/${agent.id}/clone`), { method: "POST" })).id}`))} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><Copy size={14} /> Clone</button>
            {!agent.isHead && agent.status !== "archived" && (
              <button disabled={busy} onClick={() => confirm(`Move ${agent.name} to former teammates? Their history is kept and you can restore them.`) && setStatus("archived")} className="flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-[#b42318] hover:bg-bg"><Archive size={14} /> Let go</button>
            )}
          </div>
        )}
      </section>

      <section aria-label={`Chat with ${agent.name}`} className="flex min-h-[60dvh] min-w-0 flex-1 flex-col rounded-[14px] border border-line bg-paper p-4 lg:min-h-0">
        <CompanionChat agent={agent} onEdit={() => setEditing("self")} onThinking={() => {}} onOpenGoal={(gid) => router.push(`${base}/goals/${gid}`)} onHire={(h) => { setHire(h); setEditing("new"); }} />
      </section>

      {editing && (
        <CompanionForm
          agent={editing === "self" ? agent : null}
          preset={editing === "new" ? hire : null}
          onClose={() => { setEditing(null); setHire(null); }}
          onSaved={async (id) => {
            setEditing(null);
            setHire(null);
            await reload();
            if (id !== agent.id) router.push(`${base}/team/${id}`);
          }}
        />
      )}
    </main>
  );
}
```

Make the chat fill the section: add an optional `fill?: boolean` prop to `CompanionChat` and pass it through to `ChatThread` (`fill={fill}`); pass `fill` from CompanionPage. Check `CompanionForm`'s `onSaved` signature (`grep -n "onSaved" frontend/src/components/app/CompanionForm.tsx`) and match it.

- [ ] **Step 4: Move chat.spec onto the page**

In `frontend/e2e/chat.spec.ts`, replace each `page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus(); keyboard Enter; ...Companion details... tab Chat` sequence with `await page.goto(\`/w/${co.slug}/team/${novaId}\`)` (get `novaId` from `GET /api/workspaces/${co.id}` as in team.spec) and use `const panel = page.getByRole("region", { name: "Chat with Nova" });`. The Customize step becomes `page.getByRole("region", { name: "About Nova" }).getByRole("button", { name: "Edit" })`. The final "Plan it" now navigates: assert `await expect(page).toHaveURL(/\/goals\//)` and then `page.getByRole("complementary", { name: "Company goal" }).getByText("Plan ready for your approval")`.

- [ ] **Step 5: Run checks**

Run: `cd frontend && npx tsc --noEmit && npx eslint src e2e && caffeinate -i npx playwright test e2e/team.spec.ts e2e/chat.spec.ts --reporter=line`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/w/[slug]/team frontend/src/components/app/team/CompanionPage.tsx frontend/src/components/app/CompanionChat.tsx frontend/e2e/team.spec.ts frontend/e2e/chat.spec.ts
git commit -m "feat(frontend): a full page for each companion with recent work and chat"
```

---

### Task 5: Team page with cards, Office view, Organize; old pages redirect

**Files:**
- Create: `frontend/src/app/w/[slug]/team/page.tsx`, `frontend/src/components/app/team/TeamPage.tsx`, `frontend/src/components/app/team/TeamCard.tsx`, `frontend/src/components/app/team/OrganizeDialog.tsx`
- Modify: `frontend/src/components/app/office/Office.tsx` (becomes the map view only), `frontend/src/components/app/home/TeamStrip.tsx`, `frontend/src/components/app/AppShell.tsx`
- Replace with redirect stubs: `frontend/src/app/w/[slug]/office/page.tsx`, `frontend/src/app/w/[slug]/organization/page.tsx`
- Delete: `frontend/src/components/app/office/OfficeList.tsx`, `frontend/src/components/app/CompanionPanel.tsx`
- Modify: `frontend/e2e/team.spec.ts`; delete `frontend/e2e/office.spec.ts` (its checks move into team.spec)

**Interfaces:**
- Consumes: Task 2 (`groupTeam`, `teamStatus`, `workingTasks`, `roleLabel`, `canGiveTask`, `useActiveWork`), Task 4 (`StatusPill`, route `/team/<id>`).
- Produces: route `/w/<slug>/team`; `OfficeMap({ workingIds, onOpen }: { workingIds: string[]; onOpen: (id: string) => void })` exported from `office/Office.tsx`; Give a task navigates to `/w/<slug>?ask=<encodeURIComponent("@" + name + " ")>` (Task 7 reads it).

- [ ] **Step 1: Write the failing e2e**

Append to `frontend/e2e/team.spec.ts`:

```ts
test("the Team page: cards by department, the office view, organizing, and old links", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Cards", company: "Cards Bakery", template: /Starter/ });
  await connectFakeLLM(page, co.id);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();
  const lead = page.getByRole("region", { name: "Team lead" });
  const nova = lead.getByRole("article", { name: "Nova" });
  await expect(nova.getByText("Team lead")).toBeVisible();
  await expect(nova.getByText("Free")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Needs setup" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Office", exact: true }).click();
  await expect(page.getByLabel(/^Office map\./)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^Office map\./)).toBeVisible();
  await page.getByRole("button", { name: "Cards", exact: true }).click();

  await nova.getByRole("link", { name: "Chat with Nova" }).click();
  await expect(page.getByRole("region", { name: "Chat with Nova" })).toBeVisible();
  await page.goBack();

  await page.getByRole("button", { name: "Organize" }).click();
  const org = page.getByRole("dialog", { name: "Organize your team" });
  await org.getByLabel("New department name").fill("Kitchen");
  await org.getByRole("button", { name: "Add" }).click();
  await expect(org.getByLabel("Department name").last()).toHaveValue("Kitchen");
  await org.getByRole("button", { name: "Close" }).click();

  await page.goto(`/w/${co.slug}/office`);
  await expect(page).toHaveURL(new RegExp(`/w/${co.slug}/team$`));
  await page.goto(`/w/${co.slug}/organization`);
  await expect(page).toHaveURL(new RegExp(`/w/${co.slug}/team$`));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && caffeinate -i npx playwright test e2e/team.spec.ts -g "Team page" --reporter=line`
Expected: FAIL — no link named "Team".

- [ ] **Step 3: Slim the office into a map view**

Replace `frontend/src/components/app/office/Office.tsx` with a component that keeps only the map, desk moving, and search-free view:

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { canEdit, type Snapshot } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { OfficeScene } from "./OfficeScene";

/** The animated office: the same team as the cards, at their desks. Selecting someone opens their page. */
export function OfficeMap({ workingIds, onOpen }: { workingIds: string[]; onOpen: (id: string) => void }) {
  const { snapshot, setSnapshot, reload, wsPath } = useWorkspace();
  const [error, setError] = useState("");

  // Send only the moved desk; the server merges it, so a stale view can't erase anyone else's changes.
  async function moveDesk(agentId: string, pos: { x: number; y: number }) {
    const next: Snapshot = { ...snapshot, layout: { ...snapshot.layout, desks: { ...snapshot.layout.desks, [agentId]: pos } } };
    setSnapshot(next);
    try {
      await api(wsPath("/layout"), { method: "PUT", body: { desks: { [agentId]: pos } } });
      setError("");
    } catch (e) {
      setError(`Couldn't save the new desk position. ${(e as Error).message}`);
      await reload();
    }
  }

  return (
    <div className="flex min-h-[60dvh] flex-1 flex-col">
      {error && <p role="alert" className="bg-[#fde8e6] px-4 py-2 text-sm text-[#7a1b12]">{error}</p>}
      <div className="min-h-0 flex-1">
        <OfficeScene snapshot={snapshot} selectedId={null} highlightId={null} thinkingIds={workingIds} deptFilter={null} editable={canEdit(snapshot.role)} onSelect={onOpen} onMoveDesk={moveDesk} />
      </div>
    </div>
  );
}
```

Check `OfficeScene`'s props (`sed -n 25,50p frontend/src/components/app/office/OfficeScene.tsx`): if `ref` is required, drop it as shown; if any prop above is named differently, match it. Delete `OfficeList.tsx` and `CompanionPanel.tsx` (`git rm`), then `grep -rn "OfficeList\|CompanionPanel\|GoalsList" frontend/src` — `GoalsList` loses its only user here; delete `goals/GoalsList.tsx` too if nothing else imports it.

- [ ] **Step 4: Team page, cards, Organize**

Create `frontend/src/app/w/[slug]/team/page.tsx`:

```tsx
import { TeamPage } from "@/components/app/team/TeamPage";

export default function Page() {
  return <TeamPage />;
}
```

Create `frontend/src/components/app/team/TeamCard.tsx`:

```tsx
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
        <CompanionAvatar look={agent.appearance} size={48} />
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
```

Create `frontend/src/components/app/team/OrganizeDialog.tsx` by moving the body of `frontend/src/app/w/[slug]/organization/page.tsx` into it:
- Keep `Tree` and all department logic unchanged.
- Rename the default export to `export function OrganizeDialog({ onClose }: { onClose: () => void })`.
- Wrap the existing `<main className="grid gap-8 ...">` content in:

```tsx
    <div role="dialog" aria-modal="true" aria-labelledby="organize-title" className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4">
      <div className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-[16px] bg-paper p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="organize-title" className="text-xl font-semibold">Organize your team</h2>
          <button onClick={onClose} className="rounded-[8px] px-3 py-1.5 text-sm font-semibold hover:bg-bg">Close</button>
        </div>
        {/* the former <main> grid, now a <div> with the same classes minus the padding */}
      </div>
    </div>
```

- Change the two section headings from `h1`/`h2` to `h3`, and change "Change who someone reports to from their Customize form in the office." to "Change who someone reports to with Edit on their page.". Add `useEffect` that closes on Escape: `useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);`.

Replace `frontend/src/app/w/[slug]/organization/page.tsx` and `frontend/src/app/w/[slug]/office/page.tsx` each with:

```tsx
import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/w/${slug}/team`);
}
```

Create `frontend/src/components/app/team/TeamPage.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Plus } from "@phosphor-icons/react";
import { groupTeam, teamStatus, workingTasks } from "@/lib/team";
import { canAdmin, canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionForm } from "../CompanionForm";
import { OfficeMap } from "../office/Office";
import { OrganizeDialog } from "./OrganizeDialog";
import { TeamCard } from "./TeamCard";
import { useActiveWork } from "./useActiveWork";

const VIEW_KEY = "team-view";
const subscribeStorage = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};
const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
};

/** Everyone on the team as friendly cards, with the animated office one click away. */
export function TeamPage() {
  const { snapshot, reload } = useWorkspace();
  const router = useRouter();
  const base = `/w/${snapshot.workspace.slug}`;
  const goal = useActiveWork();
  const working = workingTasks(goal);
  // The chosen view is remembered on this device; the server render and private windows start on cards.
  const stored = useSyncExternalStore(subscribeStorage, readView, () => null);
  const [picked, setPicked] = useState<"cards" | "office" | null>(null);
  const view = picked ?? (stored === "office" ? "office" : "cards");
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [showFormer, setShowFormer] = useState(false);
  const { groups, former } = groupTeam(snapshot.agents, snapshot.departments);
  const people = groups.reduce((n, g) => n + g.agents.length, 0);

  function choose(v: "cards" | "office") {
    setPicked(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Your team</h1>
          <p className="text-sm text-muted">{people} {people === 1 ? "person" : "people"} · {working.size} working now</p>
        </div>
        <div role="group" aria-label="View" className="flex rounded-[10px] border border-line p-0.5">
          {(["cards", "office"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => choose(v)} className={`rounded-[8px] px-3 py-1.5 text-sm ${view === v ? "bg-ink text-paper" : ""}`}>
              {v === "cards" ? "Cards" : "Office"}
            </button>
          ))}
        </div>
        {canAdmin(snapshot.role) && <button onClick={() => setOrganizing(true)} className="btn-light rounded-[10px] px-3 py-2 text-sm font-semibold">Organize</button>}
        {canEdit(snapshot.role) && (
          <button onClick={() => setEditing("new")} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><Plus size={14} weight="bold" /> Add a teammate</button>
        )}
      </header>

      {view === "office" ? (
        <OfficeMap workingIds={[...working.keys()]} onOpen={(id) => router.push(`${base}/team/${id}`)} />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.id} aria-label={g.name}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{g.name}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.agents.map((a) => (
                  <TeamCard key={a.id} agent={a} status={teamStatus(a, snapshot.connections, working)} base={base} role={snapshot.role} onSetUp={() => setEditing(a.id)} />
                ))}
              </div>
            </section>
          ))}
          {former.length > 0 && (
            <section aria-label="Former teammates">
              <button onClick={() => setShowFormer((s) => !s)} aria-expanded={showFormer} className="text-sm font-semibold text-muted">Former teammates ({former.length})</button>
              {showFormer && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {former.map((a) => (
                    <TeamCard key={a.id} agent={a} status={{ kind: "former" }} base={base} role={snapshot.role} onSetUp={() => setEditing(a.id)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {editing && (
        <CompanionForm
          agent={editing === "new" ? null : (snapshot.agents.find((a) => a.id === editing) ?? null)}
          preset={null}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
      {organizing && <OrganizeDialog onClose={() => setOrganizing(false)} />}
    </main>
  );
}
```


- [ ] **Step 5: Navigation and team strip**

In `AppShell.tsx` replace the `Office map` and `Organization` entries with one entry `{ href: \`${base}/team\`, label: "Team", icon: UsersThree }` placed second, and update the icon import (`UsersThree` instead of `Buildings`, `TreeStructure`). In `TeamStrip.tsx` change the link to `${snapshot.workspace.slug}/team` with text "See whole team", and wrap each person in `<Link href={\`/w/${slug}/team/${a.id}\`}>` instead of the plain `<span>` (keep `role="listitem"` on an outer span).

- [ ] **Step 6: Remove office.spec; run checks**

`git rm frontend/e2e/office.spec.ts` (its sign-up, customize, refresh and keyboard checks are covered by team.spec's companion page and Office view). In `home.spec.ts` and any spec still clicking `"Office map"`, switch to `page.getByRole("link", { name: "Team", exact: true })`.

Run: `cd frontend && npx tsc --noEmit && npx eslint src e2e && npm run test:unit && caffeinate -i npx playwright test e2e/team.spec.ts e2e/home.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src frontend/e2e
git commit -m "feat(frontend): Team page with cards, office view and Organize; old office and organization links redirect"
```

---

### Task 6: Settings tabs with AI services; providers redirect; four-item sidebar

**Files:**
- Create: `frontend/src/components/app/settings/AIServices.tsx` (moved providers content), `frontend/src/components/app/settings/CompanySettings.tsx` (moved settings content)
- Modify: `frontend/src/app/w/[slug]/settings/page.tsx`, `frontend/src/components/app/AppShell.tsx`
- Replace with redirect stub: `frontend/src/app/w/[slug]/providers/page.tsx`
- Modify: `frontend/e2e/chat.spec.ts`, `frontend/e2e/team.spec.ts`

**Interfaces:**
- Consumes: ChatGPT return URL from Task 1.
- Produces: `/w/<slug>/settings?tab=company|ai` (default `company`); `AIServices()` component; `CompanySettings()` component; sidebar = Home, Team, Projects, Settings.

- [ ] **Step 1: Write the failing e2e**

Append to `frontend/e2e/team.spec.ts`:

```ts
test("Settings has Company and AI services tabs; the old providers link keeps its message", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Tabs", company: "Tabs Bakery", template: /Just the head agent/ });
  const nav = page.getByRole("navigation", { name: "App" });
  await expect(nav.getByRole("link")).toHaveText(["Home", "Team", "Projects", "Settings"]);
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("tab", { name: "Company", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "AI services" }).click();
  await expect(page).toHaveURL(/tab=ai/);
  await expect(page.getByRole("heading", { name: "AI services" })).toBeVisible();
  await page.goto(`/w/${co.slug}/providers?chatgpt_error=${encodeURIComponent("Sign-in expired")}`);
  await expect(page).toHaveURL(/\/settings\?/);
  await expect(page.getByText("Sign-in expired")).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && caffeinate -i npx playwright test e2e/team.spec.ts -g "Settings has" --reporter=line`
Expected: FAIL — nav links don't match.

- [ ] **Step 3: Move the content**

- `git mv "frontend/src/app/w/[slug]/providers/page.tsx" frontend/src/components/app/settings/AIServices.tsx`. In it: rename `ProvidersInner` to `AIServicesInner`, rename the default export `ProvidersPage` to a named `export function AIServices()` (keep its Suspense wrapper, fallback text "Loading AI services..."), change the `<h1>` "AI providers" to `<h2 className="text-xl font-semibold">AI services</h2>`, and change `router.replace(\`/w/${snapshot.workspace.slug}/providers\`)` to `router.replace(\`/w/${snapshot.workspace.slug}/settings?tab=ai\`)`. Change `<main ...>` to `<div ...>` (the settings page owns `<main>`).
- Create `frontend/src/components/app/settings/CompanySettings.tsx` from the current settings page body: `export function CompanySettings()` returning the content without the outer `<main>`/`<h1>` (start at the message paragraph). Rename visible words: section "Workspace" → "Company", "Workspace name" → "Company name", "Workspace renamed." → "Company renamed.".
- New `frontend/src/app/w/[slug]/settings/page.tsx`:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AIServices } from "@/components/app/settings/AIServices";
import { CompanySettings } from "@/components/app/settings/CompanySettings";

const TABS = [
  { id: "company", label: "Company" },
  { id: "ai", label: "AI services" },
] as const;

function SettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") === "ai" ? "ai" : "company";
  return (
    <main className="max-w-3xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => router.replace(`${pathname}?tab=${t.id}`)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? "border-ink" : "border-transparent text-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === "ai" ? <AIServices /> : <CompanySettings />}</div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted">Loading settings...</div>}>
      <SettingsInner />
    </Suspense>
  );
}
```

- Redirect stub `frontend/src/app/w/[slug]/providers/page.tsx` (keeps the ChatGPT messages):

```tsx
import { redirect } from "next/navigation";

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const query = new URLSearchParams({ tab: "ai" });
  for (const [k, v] of Object.entries(await searchParams)) for (const x of [v].flat()) if (x !== undefined && k !== "tab") query.append(k, x);
  redirect(`/w/${slug}/settings?${query}`);
}
```

- In `AppShell.tsx` remove the `AI providers` entry and the `Plugs` import.
- `grep -rn "/providers\|/office\|/organization" frontend/src` and point every remaining in-app link to the new URL (`/settings?tab=ai`, `/team`).

- [ ] **Step 4: Phone bottom bar**

In `AppShell.tsx`, keep one nav and pin it to the bottom below `sm`. Replace the nav's className with `"fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-paper px-2 py-1.5 sm:static sm:justify-start sm:gap-1 sm:border-0 sm:bg-transparent sm:p-0 lg:mt-4 lg:flex-col"`, each link's className gains `flex-col text-[11px] sm:flex-row sm:text-sm`, and the label span becomes always visible (`<span>{label}</span>`, drop `hidden sm:inline`). Add `pb-16 sm:pb-0` to the page content wrapper `<div className="flex min-h-0 flex-1 flex-col lg:overflow-y-auto">` so the bar never covers content.

- [ ] **Step 5: Update specs that used the providers page**

In `chat.spec.ts` change `page.getByRole("link", { name: "AI providers", exact: true })` to `page.goto(\`/w/${co.slug}/settings?tab=ai\`)` and the heading check to `"AI services"`.

- [ ] **Step 6: Run checks**

Run: `cd frontend && npx tsc --noEmit && npx eslint src e2e && caffeinate -i npx playwright test e2e/team.spec.ts e2e/chat.spec.ts --reporter=line`
Expected: all pass. Then take a 390px screenshot of home (`npx playwright` codegen is not needed: add `await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: "/tmp/4b-phone.png" })` temporarily to the Settings test, look at it, remove it) and confirm the bottom bar shows four labelled items without covering the chat input.

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src frontend/e2e
git commit -m "feat(frontend): Settings with Company and AI services tabs; four-item sidebar with a phone bottom bar"
```

---

### Task 7: First-run setup card; Give a task fills the home input

**Files:**
- Create: `frontend/src/components/app/home/SetupCard.tsx`
- Modify: `frontend/src/lib/team.ts`, `frontend/src/lib/team.test.ts` (setup steps logic), `frontend/src/components/app/home/ChatHome.tsx`, `frontend/src/components/app/chat/ChatThread.tsx`, `frontend/src/app/w/[slug]/page.tsx`, `frontend/src/components/app/settings/AIServices.tsx`
- Modify: `frontend/e2e/team.spec.ts`

**Interfaces:**
- Produces: `setupSteps(agents: Agent[], connections: ConnectionSummary[]): { service: boolean; model: boolean; done: boolean }` in `lib/team.ts`; `ChatThread` prop `initialDraft?: string`; ChatHome reads `?ask=`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/team.test.ts` (add `setupSteps` to the import):

```ts
test("setup steps: a connected service, then the head's model on it", () => {
  const head = agent({ isHead: true, model: null, connectionId: null });
  assert.deepEqual(setupSteps([head], []), { service: false, model: false, done: false });
  assert.deepEqual(setupSteps([head], conns), { service: true, model: false, done: false });
  assert.deepEqual(setupSteps([{ ...head, model: "m", connectionId: "c1" }], conns), { service: true, model: true, done: true });
  assert.deepEqual(setupSteps([{ ...head, model: "m", connectionId: "c1" }], [{ ...conns[0], status: "error" }]), { service: false, model: false, done: false });
});
```

Append to `frontend/e2e/team.spec.ts`:

```ts
test("first-run setup card, then Give a task fills the home input", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Setup", company: "Setup Bakery", template: /Starter/ });
  const setup = page.getByRole("region", { name: "Finish setting up" });
  await expect(setup.getByText("Connect an AI service")).toBeVisible();
  await setup.getByRole("link", { name: "Connect an AI service" }).click();
  await expect(page).toHaveURL(/\/settings\?tab=ai/);
  await page.getByRole("button", { name: "Add a service" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("AI service").selectOption("other");
  await dialog.getByLabel("Service address").fill("http://127.0.0.1:4199/v1");
  await dialog.getByLabel("Name").fill("Fake LLM");
  await dialog.getByRole("button", { name: "Test and save" }).click();
  await page.getByRole("link", { name: "Back to home" }).click();

  await expect(setup.getByText("✓ Connect an AI service")).toBeVisible();
  await setup.getByRole("button", { name: "Choose Nova's AI model" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("AI service").selectOption({ label: "Fake LLM (127.0.0.1:4199)" });
  await form.getByLabel("AI model").fill("fake-model");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(setup).toHaveCount(0);

  await page.getByRole("link", { name: "Team", exact: true }).click();
  const snap = await (await page.request.get(`/api/workspaces/${co.id}`)).json();
  const other = snap.agents.find((a: { isHead: boolean }) => !a.isHead);
  await page.request.patch(`/api/workspaces/${co.id}/agents/${other.id}`, { headers: { origin: "http://localhost:3100" }, data: { name: "Mira & Co", connectionId: snap.agents.find((a: { isHead: boolean }) => a.isHead).connectionId, model: "fake-model" } });
  await page.reload();
  await page.getByRole("article", { name: "Mira & Co" }).getByRole("link", { name: "Give a task" }).click();
  await expect(page.getByLabel("Message Nova")).toHaveValue("@Mira & Co ");
});
```

These labels ("Add a service", "AI service", "Service address", "AI model") are the plain words Task 8 introduces; this task introduces exactly those labels it needs in `AIServices.tsx` and `CompanionForm.tsx` (button "Add endpoint" → "Add a service"; select label "Provider" → "AI service"; "Base URL" → "Service address"; companion form "Model" → "AI model", "Provider" → "AI service"), and updates every spec that used the old labels (`grep -rn '"Provider"\|"Base URL"\|"Model"\|Add endpoint' frontend/e2e`).

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit` → FAIL (`setupSteps` missing). `caffeinate -i npx playwright test e2e/team.spec.ts -g "first-run" --reporter=line` → FAIL (no "Finish setting up" region).

- [ ] **Step 3: Implement**

Add to `frontend/src/lib/team.ts`:

```ts
export function setupSteps(agents: Agent[], connections: ConnectionSummary[]) {
  const service = connections.some((c) => c.status === "connected");
  const head = agents.find((a) => a.isHead);
  const model = !!head && head.kind === "ai" && isReady(head, connections);
  return { service, model, done: service && model };
}
```

Create `frontend/src/components/app/home/SetupCard.tsx`:

```tsx
"use client";

import Link from "next/link";
import { setupSteps } from "@/lib/team";
import { canAdmin } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

/** Two steps before Nova can help; hidden once both are done. */
export function SetupCard({ onChooseModel }: { onChooseModel: () => void }) {
  const { snapshot } = useWorkspace();
  const steps = setupSteps(snapshot.agents, snapshot.connections);
  if (steps.done) return null;
  const head = snapshot.agents.find((a) => a.isHead);
  const name = head?.name ?? "Nova";
  const admin = canAdmin(snapshot.role);
  const row = "flex items-center gap-2 rounded-[10px] bg-bg px-3 py-2 text-sm";
  return (
    <section aria-label="Finish setting up" className="mb-3 rounded-[14px] border border-line bg-paper p-4">
      <p className="font-semibold">Two quick steps before {name} can help</p>
      {!admin ? (
        <p className="mt-2 text-sm text-muted">Ask the company owner to finish setup.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          <li className={row}>
            {steps.service ? <span>✓ Connect an AI service</span> : <><span className="flex-1">1. Your team needs an AI service to think with.</span><Link href={`/w/${snapshot.workspace.slug}/settings?tab=ai`} className="btn-dark rounded-[8px] px-3 py-1.5 text-xs font-semibold">Connect an AI service</Link></>}
          </li>
          <li className={row}>
            {steps.model ? <span>✓ Choose {name}&apos;s AI model</span> : <><span className="flex-1">2. Pick which AI model {name} uses.</span><button disabled={!steps.service || !head} onClick={onChooseModel} className="btn-dark rounded-[8px] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Choose {name}&apos;s AI model</button></>}
          </li>
        </ol>
      )}
    </section>
  );
}
```

Note the ✓ text for step 1 must read exactly `✓ Connect an AI service` (the e2e checks it).

In `ChatHome.tsx`:
- Replace the `{!headReady && <p ...>Nova needs an AI model...</p>}` line with `<SetupCard onChooseModel={() => head && setEditingHead(true)} />` and add `const [editingHead, setEditingHead] = useState(false);` plus, next to the hire form, `{editingHead && head && <CompanionForm agent={head} preset={null} onClose={() => setEditingHead(false)} onSaved={async () => { setEditingHead(false); await reload(); }} />}`.
- Read the prefill: `const ask = useSearchParams().get("ask") ?? "";` (import from `next/navigation`) and pass `initialDraft={ask}` to `ChatThread`.

In `frontend/src/app/w/[slug]/page.tsx` wrap `<ChatHome />` in `<Suspense fallback={null}>` (import `Suspense` from react) so `useSearchParams` builds.

In `ChatThread.tsx` add the prop `initialDraft?: string` to the props type and destructuring, and change `useState("")` for `draft` to `useState(initialDraft ?? "")`.

In `AIServices.tsx`, after a successful save (`onSaved` of `AddForm` and the ChatGPT `connected` notice), when Nova isn't ready yet show next to the notice: `<Link href={\`/w/${snapshot.workspace.slug}\`} className="underline">Back to home</Link>` with the text "Next: choose Nova's AI model." Compute readiness with `setupSteps(snapshot.agents, snapshot.connections).model` after `reload()`.

Update `frontend/e2e/home.spec.ts`: its old check `page.getByText("Nova needs an AI model")` becomes `page.getByRole("region", { name: "Finish setting up" })` before `connectFakeLLM`, or delete the check if the helper already ran.

- [ ] **Step 4: Run checks**

Run: `cd frontend && npm run test:unit && npx tsc --noEmit && npx eslint src e2e && caffeinate -i npx playwright test e2e/team.spec.ts e2e/home.spec.ts e2e/chat.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src frontend/e2e
git commit -m "feat(frontend): first-run setup card on home; Give a task opens home with the teammate named"
```

---

### Task 8: Plain-language pass, screens, full suites

**Files:**
- Modify: `frontend/src/lib/types.ts` (`statusLabel`), `frontend/src/components/app/office/OfficeScene.tsx`, `frontend/src/components/app/goals/GoalPanel.tsx`, `frontend/src/components/app/CompanionForm.tsx`, `frontend/src/components/app/CompanionChat.tsx`, `frontend/src/components/app/settings/AIServices.tsx`, any other app file found by the grep below
- Modify: `frontend/e2e/*.spec.ts` (new wording)

**Interfaces:**
- Consumes: `roleLabel` (Task 2).

- [ ] **Step 1: Find every remaining technical word on app screens**

Run from repo root:

```bash
grep -rn --include=*.tsx -E '"[^"]*\b(Head agent|Idle|reauth|Reauth|AI providers|Provider|provider|Custom endpoint|Base URL|Workspace|workspace|Company goal|Goal for the team|Close goal|Archived|archived|Customize|endpoint)\b[^"]*"|>[^<{]*\b(Head agent|Idle|AI providers|Provider|Custom endpoint|Base URL|Workspace|Company goal|Archived|Customize|endpoint)\b[^<]*<' frontend/src/components/app frontend/src/app/w frontend/src/app/onboarding
```

Ignore matches that are code (prop names, API paths, `status === "archived"`, type names). Change visible text per the spec table:

| Today | Becomes |
|---|---|
| Head agent (displayed role) | `roleLabel(agent)` |
| Idle | Free |
| Needs reauth / reauth / Sign in again (keep) | Sign in again |
| AI providers, Provider | AI services, AI service |
| Custom endpoint, Base URL, Add endpoint | Other service, Service address, Add a service |
| Workspace | Company |
| Company goal, Goal for the team, Close goal | Team task, Task for the team, Close |
| Archived | Former teammate |
| Model (form labels) | AI model |
| Customize | Edit |

Concretely:
- `types.ts:41`: `statusLabel` → `(a: Agent, thinking = false) => (thinking ? "Working" : { active: "Free", paused: "Paused", archived: "Former teammate" }[a.status])`.
- `OfficeScene.tsx:225`: label uses `roleLabel(a)` instead of `a.role` (import from `@/lib/team`).
- `GoalPanel.tsx:64,67`: `aria-label="Team task"`, `aria-label="Close"`.
- `CompanionChat.tsx`: "Choose an AI model for {name} first" stays; "Pick a provider and model in the Customize form." → "Pick an AI service and model with Edit.".
- `CompanionForm.tsx`: field labels "Provider" → "AI service", "Model" → "AI model" (already done in Task 7 if touched there).
- `AIServices.tsx`: card title "Custom endpoint" → "Other service", "AI providers" text anywhere → "AI services", "Choose a provider first" → "Choose an AI service first".
- Token counts: in `GoalPanel.tsx` and `TaskCard.tsx`, token numbers stay (the full goal page is the "Details" view the spec allows); in `CompanionChat` set `hideMeta` on `ChatThread` so the companion page shows no model/token line.

- [ ] **Step 2: Update specs for the new words**

`grep -rn 'Company goal\|Close goal\|Head agent\|Idle\|Customize\|"Model"\|"Provider"\|Base URL\|Add endpoint\|tokens' frontend/e2e` and change each to the new wording (`"Team task"`, `"Team lead"`, `"Free"`, `"Edit"`, `"AI model"`, `"AI service"`, `"Service address"`, `"Add a service"`). The chat.spec check `fake-model · 56 tokens` is removed (the meta line is hidden now); replace it with `await expect(panel.getByText(/tokens/)).toHaveCount(0);`.

- [ ] **Step 3: Run the frontend checks and build**

Run: `cd frontend && npx tsc --noEmit && npx eslint src e2e && npm run test:unit && NEXT_DIST_DIR=.next-check npx next build`
Expected: clean; build succeeds.

- [ ] **Step 4: Full suites, one after the other**

Run: `cd backend && caffeinate -i npx vitest run 2>&1 | tail -5` then `cd ../frontend && caffeinate -i npx playwright test --reporter=line 2>&1 | tail -8`
Expected: backend all files pass; e2e: build, chat, goals, home, projects, team pass. Report any failure with its output; never mark done with a failure.

- [ ] **Step 5: Screens**

Add a temporary Playwright script in the scratchpad (not committed) that signs up with the helper, connects the fake LLM for all companions, and screenshots at 1440×900 and 390×844 in light and dark (`page.emulateMedia({ colorScheme: "dark" })`): home with setup card (before connecting), home after setup, Team cards, Team office view, a companion page, Settings › AI services. Look at each image: no horizontal scroll, no overlapping text, bottom bar not covering inputs, pills readable in dark mode. Fix what's wrong, rerun the affected spec.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src frontend/e2e
git commit -m "feat(frontend): plain words on every app screen"
```
