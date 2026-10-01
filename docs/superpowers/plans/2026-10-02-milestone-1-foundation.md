# Milestone 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign up, create a company from a team template, and land in a working Live Office where companions can be inspected, customized, created, cloned, paused, archived, and rearranged, with departments, reporting lines, and view preferences, all persisted per workspace.

**Architecture:** Next.js (frontend, :3000) rewrites `/api/*` to Fastify (backend, :4000) so cookies are first-party. Fastify hosts Better Auth (email/password plus optional Google), Zod-validated JSON routes that always check workspace membership, and Prisma 7 talking to Neon Postgres through the `pg` driver adapter. The office is a single SVG client component drawn from one workspace snapshot.

**Tech Stack:** Fastify 5, Better Auth 1.7, Prisma 7.10 (`prisma-client` generator, `@prisma/adapter-pg`), Zod 4, Vitest 5, Next.js 16, React 19, Tailwind 4, Phosphor icons, Playwright (system Chrome).

**Spec:** `docs/superpowers/specs/2026-10-02-milestone-1-foundation-design.md`

## Global Constraints

- Backend relative imports end in `.js` (TypeScript `NodeNext`). Generated Prisma client imports from `src/generated/prisma/client.js`.
- The backend runs with `tsx` in all modes; `tsc --noEmit` is the type check (the generated Prisma client uses `.ts` import extensions, so we do not emit JS).
- Never run `prisma init` (it writes unrelated AI-assistant files); write config by hand as shown.
- Every workspace route loads membership first and answers 404 for non-members, 403 for insufficient role, 401 when signed out.
- Error body shape is always `{ "error": { "code": string, "message": string } }`.
- Names 1-60 chars, `workingStyle` max 500, colors `#rrggbb`.
- Head agent: exactly one per workspace, cannot be archived, cannot have a manager.
- Office layout is visual only; dragging never changes department, manager, or permissions.
- Every companion status label is `Idle`, `Paused`, or `Archived`. Nothing implies work is happening.
- No em-dashes in user-facing copy. Landing page visual language (grey paper, ink, lime as fill only, Urbanist + Space Grotesk) carries into the app.
- Secrets live only in `backend/.env`; never logged, never returned to the browser, never pasted into chat.
- Test scripts must refuse to run unless `TEST_DATABASE_URL` is set and differs from `DATABASE_URL` and `DIRECT_URL`.

## Review Focus

1. **Stale or foreign IDs in bodies** (a `managerId` or `departmentId` from another workspace, an archived manager): expect 400, never a cross-workspace link. Test added in Task 5.
2. **Two people editing at once / deleting a department that agents belong to**: agents must become unassigned and still render in an "Unassigned" zone, not vanish. Test added in Task 6.
3. **Layout payload with junk keys** (desks for agents in another workspace, huge arrays): must be filtered or rejected, never stored. Test added in Task 6.
4. **Signed-in user with zero workspaces, or a slug they do not own**: must land on onboarding or their own workspace, not a blank screen. Covered in Task 7 `WorkspaceProvider` redirect logic and the Task 10 E2E flow.
5. **Missing Google keys**: the button must be disabled with a reason, and `/api/auth-config` must report it. Test added in Task 3.

---

## File Map

```
backend/
  package.json                    scripts, deps
  prisma.config.ts                Prisma CLI config (picks main or test DB)
  prisma/schema.prisma            auth + app models
  prisma/migrations/...           generated
  vitest.config.ts
  src/env.ts                      loads .env, switches to test DB
  src/db.ts                       Prisma client
  src/http.ts                     HttpError, error handler, requireUser, requireMember, audit
  src/auth.ts                     Better Auth instance
  src/layout.ts                   autoLayout (pure)
  src/org.ts                      createsCycle (pure)
  src/templates.ts                team templates + createWorkspaceFromTemplate + relayout
  src/snapshot.ts                 snapshot() + toAgentDTO()
  src/app.ts                      buildApp()
  src/server.ts                   listen
  src/routes/auth.ts              /api/auth/*, /api/auth-config, /api/me
  src/routes/workspaces.ts        workspace create/get/rename, departments, layout, preferences
  src/routes/agents.ts            agent create/update/clone
  src/routes/waitlist.ts          /api/waitlist
  test/global-setup.ts, test/helpers.ts
  test/layout.test.ts, test/org.test.ts, test/auth.test.ts,
  test/workspaces.test.ts, test/agents.test.ts, test/settings.test.ts
frontend/
  next.config.ts                  rewrites, distDir override
  playwright.config.ts, e2e/global-setup.ts, e2e/office.spec.ts
  src/app/globals.css             + app theme tokens, bob animation
  src/lib/types.ts, src/lib/api.ts, src/lib/auth-client.ts, src/lib/workspace.tsx
  src/app/sign-in/page.tsx, src/app/sign-up/page.tsx, src/app/app/page.tsx, src/app/onboarding/page.tsx
  src/app/w/[slug]/layout.tsx, page.tsx, organization/page.tsx, settings/page.tsx
  src/components/app/AuthForm.tsx, AppShell.tsx, CompanionAvatar.tsx,
  src/components/app/CompanionForm.tsx, CompanionPanel.tsx
  src/components/app/office/Office.tsx, OfficeScene.tsx, OfficeList.tsx
  src/components/landing/EarlyAccessForm.tsx, Header.tsx   (small edits)
```

---

### Task 1: Backend foundation, database, and test harness

**Files:**
- Modify: `backend/package.json`, `backend/tsconfig.json`, `.gitignore`, `.env.example`
- Create: `backend/prisma.config.ts`, `backend/prisma/schema.prisma`, `backend/src/env.ts`, `backend/src/db.ts`, `backend/src/http.ts`, `backend/src/app.ts`, `backend/src/routes/waitlist.ts`, `backend/vitest.config.ts`, `backend/test/global-setup.ts`, `backend/test/helpers.ts`, `backend/test/health.test.ts`
- Replace: `backend/src/server.ts`

**Interfaces:**
- Produces: `prisma` (PrismaClient), `Db` type, `HttpError(status, code, message)`, `errorHandler`, `buildApp(): Promise<FastifyInstance>`, test helper `makeApp()`.

- [ ] **Step 1: Install dependencies**

```bash
cd backend
npm uninstall @fastify/cors
npm i better-auth@1.7 @prisma/client@7.10 @prisma/adapter-pg@7.10 zod@4
npm i -D prisma@7.10 vitest@5
```

- [ ] **Step 2: Set scripts in `backend/package.json`**

Replace the `scripts` block with:

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "start": "tsx src/server.ts",
  "dev:test": "USE_TEST_DB=1 PORT=4100 BETTER_AUTH_URL=http://localhost:3100 FRONTEND_URL=http://localhost:3100 tsx src/server.ts",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "db:generate": "prisma generate",
  "db:migrate": "prisma migrate dev",
  "db:deploy": "prisma migrate deploy",
  "db:reset:test": "USE_TEST_DB=1 prisma migrate reset --force",
  "postinstall": "prisma generate"
}
```

Remove the old `build` script (we type-check instead of emitting).

- [ ] **Step 3: Write `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "test", "prisma.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Write `backend/prisma.config.ts`**

```ts
import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

const useTest = Boolean(process.env.USE_TEST_DB);
const testUrl = process.env.TEST_DATABASE_URL;
if (useTest && (!testUrl || testUrl === process.env.DATABASE_URL || testUrl === process.env.DIRECT_URL)) {
  throw new Error("Set TEST_DATABASE_URL in backend/.env to a separate database before running tests.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: useTest ? testUrl : (process.env.DIRECT_URL ?? process.env.DATABASE_URL) },
});
```

- [ ] **Step 5: Write `backend/prisma/schema.prisma`**

The four auth models are exactly what `npx auth@latest generate` produces for Better Auth 1.7, plus back-relations to our models.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id            String           @id
  name          String
  email         String
  emailVerified Boolean          @default(false)
  image         String?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  sessions      Session[]
  accounts      Account[]
  memberships   Membership[]
  preferences   UserPreference[]

  @@unique([email])
  @@map("user")
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([token])
  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([identifier])
  @@map("verification")
}

enum Role {
  owner
  admin
  member
  viewer
}

enum AgentKind {
  ai
  human
}

enum AgentStatus {
  active
  paused
  archived
}

enum CompanionStyle {
  robot
  orb
}

enum Theme {
  system
  light
  dark
}

model Workspace {
  id          String           @id @default(cuid())
  name        String
  slug        String           @unique
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  memberships Membership[]
  departments Department[]
  agents      Agent[]
  layout      OfficeLayout?
  preferences UserPreference[]
  auditLogs   AuditLog[]
}

model Membership {
  id          String    @id @default(cuid())
  workspaceId String
  userId      String
  role        Role
  createdAt   DateTime  @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
}

model Department {
  id          String    @id @default(cuid())
  workspaceId String
  name        String
  sortOrder   Int
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agents      Agent[]

  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model Agent {
  id           String           @id @default(cuid())
  workspaceId  String
  departmentId String?
  managerId    String?
  name         String
  role         String
  kind         AgentKind        @default(ai)
  workingStyle String           @default("")
  status       AgentStatus      @default(active)
  isHead       Boolean          @default(false)
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  workspace    Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  department   Department?      @relation(fields: [departmentId], references: [id], onDelete: SetNull)
  manager      Agent?           @relation("Reports", fields: [managerId], references: [id], onDelete: SetNull)
  reports      Agent[]          @relation("Reports")
  appearance   AgentAppearance?

  @@index([workspaceId])
  @@index([departmentId])
}

model AgentAppearance {
  id        String         @id @default(cuid())
  agentId   String         @unique
  style     CompanionStyle @default(robot)
  color     String
  head      String
  eyes      String
  accessory String
  agent     Agent          @relation(fields: [agentId], references: [id], onDelete: Cascade)
}

model OfficeLayout {
  id          String    @id @default(cuid())
  workspaceId String    @unique
  layout      Json
  updatedAt   DateTime  @updatedAt
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

model UserPreference {
  id            String    @id @default(cuid())
  userId        String
  workspaceId   String
  theme         Theme     @default(system)
  reducedMotion Boolean   @default(false)
  calmMode      Boolean   @default(false)
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
}

model AuditLog {
  id          String    @id @default(cuid())
  workspaceId String
  actorUserId String
  action      String
  targetType  String
  targetId    String
  data        Json?
  createdAt   DateTime  @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
}
```

- [ ] **Step 6: Generate the client and validate**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma/schema.prisma is valid` and `Generated Prisma Client (7.10.0) to ./src/generated/prisma`.

- [ ] **Step 7: Write `backend/src/env.ts`**

```ts
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // No .env file: rely on the real environment. Values already set in the shell win.
}

if (process.env.USE_TEST_DB) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || url === process.env.DATABASE_URL || url === process.env.DIRECT_URL) {
    throw new Error("Set TEST_DATABASE_URL in backend/.env to a separate database before running tests.");
  }
  process.env.DATABASE_URL = url;
}
```

- [ ] **Step 8: Write `backend/src/db.ts`**

```ts
import "./env.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "./generated/prisma/client.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Copy .env.example to backend/.env and fill it in.");

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

/** Either the root client or an interactive-transaction client. */
export type Db = typeof prisma | Prisma.TransactionClient;
```

- [ ] **Step 9: Write `backend/src/http.ts`** (auth helpers are added in Task 3)

```ts
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  const send = (status: number, code: string, message: string) => reply.status(status).send({ error: { code, message } });
  if (err instanceof HttpError) return send(err.status, err.code, err.message);
  if (err instanceof ZodError) {
    return send(400, "invalid", err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  if ((err as { code?: string }).code === "P2002") return send(409, "conflict", "That name is already taken");
  const status = (err as FastifyError).statusCode ?? 500;
  if (status === 429) return send(429, "rate_limited", "Too many requests. Wait a minute and try again.");
  if (status < 500) return send(status, "bad_request", err.message);
  req.log.error(err);
  return send(500, "server_error", "Something went wrong");
}
```

- [ ] **Step 10: Move the waitlist to `backend/src/routes/waitlist.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// ponytail: JSON file store, single process only. Move to Postgres when the waitlist needs an admin view.
const DATA_DIR = new URL("../../data/", import.meta.url);
const WAITLIST = new URL("waitlist.json", DATA_DIR);

export async function waitlistRoutes(app: FastifyInstance) {
  app.post<{ Body: { email: string; name?: string; goal?: string } }>(
    "/api/waitlist",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            name: { type: "string", maxLength: 120 },
            goal: { type: "string", maxLength: 1000 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const email = req.body.email.trim().toLowerCase();
      await mkdir(DATA_DIR, { recursive: true });
      const list: { email: string; name?: string; goal?: string; at: string }[] = JSON.parse(
        await readFile(WAITLIST, "utf8").catch(() => "[]"),
      );
      if (!list.some((e) => e.email === email)) {
        list.push({ email, name: req.body.name?.trim() || undefined, goal: req.body.goal?.trim() || undefined, at: new Date().toISOString() });
        await writeFile(WAITLIST, JSON.stringify(list, null, 2));
      }
      // Same response for new and existing emails, so the endpoint can't be used to check who signed up.
      return reply.code(201).send({ ok: true });
    },
  );
}
```

- [ ] **Step 11: Write `backend/src/app.ts` and replace `backend/src/server.ts`**

`backend/src/app.ts`:

```ts
import "./env.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { errorHandler } from "./http.js";
import { waitlistRoutes } from "./routes/waitlist.js";

export async function buildApp() {
  const app = Fastify({ logger: !process.env.VITEST, trustProxy: true });
  await app.register(rateLimit, { global: false });
  app.setErrorHandler(errorHandler);
  app.get("/health", async () => ({ ok: true }));
  await app.register(waitlistRoutes);
  return app;
}
```

`backend/src/server.ts`:

```ts
import { buildApp } from "./app.js";

const app = await buildApp();
// Only the Next.js proxy talks to us, so listen on loopback.
await app.listen({ port: Number(process.env.PORT ?? 4000), host: "127.0.0.1" });
```

- [ ] **Step 12: Write the test harness**

`backend/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { USE_TEST_DB: "1" },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
```

`backend/test/global-setup.ts`:

```ts
import { execSync } from "node:child_process";

export default function setup() {
  execSync("npx prisma migrate reset --force", { stdio: "inherit", env: { ...process.env, USE_TEST_DB: "1" } });
}
```

`backend/test/helpers.ts` (grows in Task 3):

```ts
import { buildApp } from "../src/app.js";

export async function makeApp() {
  const app = await buildApp();
  await app.ready();
  return app;
}
```

`backend/test/health.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { makeApp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

test("health answers ok", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  expect(res.json()).toEqual({ ok: true });
});

test("unknown route returns the standard error shape", async () => {
  const res = await app.inject({ method: "GET", url: "/api/nope" });
  expect(res.statusCode).toBe(404);
});
```

- [ ] **Step 13: Env example and ignores**

Replace root `.env.example`:

```
# backend/.env  (copy this file there and fill in values; never commit or paste real values)
DATABASE_URL=            # Neon pooled connection string (host contains -pooler)
DIRECT_URL=              # Neon direct connection string, used for migrations
TEST_DATABASE_URL=       # Neon direct connection string to a second database named "test"
BETTER_AUTH_SECRET=      # run: openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000
GOOGLE_CLIENT_ID=        # optional
GOOGLE_CLIENT_SECRET=    # optional
PORT=4000

# frontend (optional)
BACKEND_URL=http://127.0.0.1:4000
```

Append to `.gitignore`:

```
backend/src/generated
frontend/.next-e2e
frontend/test-results
frontend/playwright-report
```

- [ ] **Step 14: OWNER GATE: database credentials**

Stop and ask the owner to:
1. Create a free Neon project at https://neon.tech.
2. In the Neon console, create a second database named `test` in the same branch.
3. Copy `.env.example` to `backend/.env` and fill `DATABASE_URL` (pooled), `DIRECT_URL` (direct), `TEST_DATABASE_URL` (direct, database `test`), and `BETTER_AUTH_SECRET` (`openssl rand -base64 32`).

Do not ask for or accept the values in chat. Continue when the owner confirms the file is saved.

- [ ] **Step 15: Create the first migration**

Run: `cd backend && npx prisma migrate dev --name init`
Expected: `Your database is now in sync with your schema.` and a new folder `prisma/migrations/<timestamp>_init/`.

- [ ] **Step 16: Run tests and type check**

Run: `cd backend && npm test && npm run typecheck`
Expected: global setup resets the `test` database, `health.test.ts` 2 passed, typecheck exits 0.

- [ ] **Step 17: Commit**

```bash
git add backend .gitignore .env.example
git commit -m "feat(backend): prisma schema, app factory, error shape, test harness"
```

---

### Task 2: Office layout and reporting-line logic (pure functions)

**Files:**
- Create: `backend/src/layout.ts`, `backend/src/org.ts`
- Test: `backend/test/layout.test.ts`, `backend/test/org.test.ts`

**Interfaces:**
- Produces:
  - `type Zone = { departmentId: string; x: number; y: number; w: number; h: number }`
  - `type Layout = { zones: Zone[]; desks: Record<string, { x: number; y: number }> }`
  - `const UNASSIGNED = "unassigned"`
  - `autoLayout(departmentIds: string[], agents: { id: string; departmentId: string | null }[], prev?: Layout): Layout`
  - `createsCycle(agentId: string, managerId: string, managerOf: Map<string, string | null>): boolean`

- [ ] **Step 1: Write the failing tests**

`backend/test/layout.test.ts`:

```ts
import { expect, test } from "vitest";
import { autoLayout, UNASSIGNED, type Layout } from "../src/layout.js";

const inside = (l: Layout, agentId: string, deptId: string) => {
  const z = l.zones.find((z) => z.departmentId === deptId)!;
  const d = l.desks[agentId];
  return d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h;
};

test("every agent gets a desk inside its department zone", () => {
  const agents = [
    { id: "a", departmentId: "d1" },
    { id: "b", departmentId: "d1" },
    { id: "c", departmentId: "d2" },
    { id: "d", departmentId: "d1" },
    { id: "e", departmentId: "d1" },
  ];
  const l = autoLayout(["d1", "d2"], agents);
  expect(l.zones.map((z) => z.departmentId)).toEqual(["d1", "d2"]);
  for (const a of agents) expect(inside(l, a.id, a.departmentId)).toBe(true);
});

test("agents without a known department go to an Unassigned zone", () => {
  const l = autoLayout(["d1"], [{ id: "a", departmentId: null }, { id: "b", departmentId: "gone" }]);
  expect(l.zones.at(-1)!.departmentId).toBe(UNASSIGNED);
  expect(inside(l, "a", UNASSIGNED) && inside(l, "b", UNASSIGNED)).toBe(true);
});

test("a dragged desk is kept when its zone did not move", () => {
  const first = autoLayout(["d1"], [{ id: "a", departmentId: "d1" }]);
  const z = first.zones[0];
  const dragged: Layout = { ...first, desks: { a: { x: z.x + 300, y: z.y + 100 } } };
  const next = autoLayout(["d1"], [{ id: "a", departmentId: "d1" }, { id: "b", departmentId: "d1" }], dragged);
  expect(next.desks.a).toEqual({ x: z.x + 300, y: z.y + 100 });
  expect(next.desks.b).toBeDefined();
});

test("zones wrap after three per row without overlapping", () => {
  const l = autoLayout(["1", "2", "3", "4"], []);
  expect(l.zones[3].y).toBeGreaterThan(l.zones[0].y + l.zones[0].h);
});
```

`backend/test/org.test.ts`:

```ts
import { expect, test } from "vitest";
import { createsCycle } from "../src/org.js";

const chain = new Map<string, string | null>([
  ["head", null],
  ["em", "head"],
  ["dev", "em"],
]);

test("making yourself your own manager is a cycle", () => {
  expect(createsCycle("dev", "dev", chain)).toBe(true);
});

test("making a manager report to their own report is a cycle", () => {
  expect(createsCycle("em", "dev", chain)).toBe(true);
  expect(createsCycle("head", "dev", chain)).toBe(true);
});

test("normal reassignments are fine", () => {
  expect(createsCycle("dev", "head", chain)).toBe(false);
});

test("a pre-existing loop in data does not hang", () => {
  const broken = new Map<string, string | null>([["x", "y"], ["y", "x"], ["z", null]]);
  expect(createsCycle("z", "x", broken)).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/layout.test.ts test/org.test.ts`
Expected: FAIL with "Cannot find module '../src/layout.js'".

- [ ] **Step 3: Write `backend/src/layout.ts`**

```ts
export type Zone = { departmentId: string; x: number; y: number; w: number; h: number };
export type Layout = { zones: Zone[]; desks: Record<string, { x: number; y: number }> };

export const UNASSIGNED = "unassigned";

const COLS = 3;
const ZONE_W = 460;
const GAP = 48;
const PER_ROW = 3;
const DESK_X = 140;
const DESK_Y = 130;
const TOP = 80;

const contains = (z: Zone, p: { x: number; y: number }) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

/**
 * Departments in a 3-column grid, desks in a 3-per-row grid inside each zone.
 * A previous desk position is kept when its zone did not move and the desk was inside it,
 * so user drags survive adding companions.
 */
export function autoLayout(
  departmentIds: string[],
  agents: { id: string; departmentId: string | null }[],
  prev?: Layout,
): Layout {
  const ids = [...departmentIds];
  const groups = new Map(ids.map((id) => [id, [] as string[]]));
  const lobby: string[] = [];
  for (const a of agents) (a.departmentId && groups.has(a.departmentId) ? groups.get(a.departmentId)! : lobby).push(a.id);
  if (lobby.length) {
    ids.push(UNASSIGNED);
    groups.set(UNASSIGNED, lobby);
  }

  const zones: Zone[] = [];
  const desks: Layout["desks"] = {};
  let y = 0;
  for (let row = 0; row < ids.length; row += COLS) {
    const rowIds = ids.slice(row, row + COLS);
    const rows = Math.max(1, ...rowIds.map((id) => Math.ceil(groups.get(id)!.length / PER_ROW)));
    const h = TOP + rows * DESK_Y;
    rowIds.forEach((id, col) => {
      const zone: Zone = { departmentId: id, x: col * (ZONE_W + GAP), y, w: ZONE_W, h };
      zones.push(zone);
      const prevZone = prev?.zones.find((z) => z.departmentId === id);
      groups.get(id)!.forEach((agentId, i) => {
        const old = prev?.desks[agentId];
        const keep = old && prevZone && prevZone.x === zone.x && prevZone.y === zone.y && contains(prevZone, old);
        desks[agentId] = keep
          ? old
          : { x: zone.x + 90 + (i % PER_ROW) * DESK_X, y: zone.y + TOP + 40 + Math.floor(i / PER_ROW) * DESK_Y };
      });
    });
    y += h + GAP;
  }
  return { zones, desks };
}
```

- [ ] **Step 4: Write `backend/src/org.ts`**

```ts
/** True when giving `agentId` the manager `managerId` would create a reporting loop. */
export function createsCycle(agentId: string, managerId: string, managerOf: Map<string, string | null>): boolean {
  const seen = new Set<string>();
  for (let cur: string | null | undefined = managerId; cur; cur = managerOf.get(cur)) {
    if (cur === agentId || seen.has(cur)) return true;
    seen.add(cur);
  }
  return false;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/layout.test.ts test/org.test.ts`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/src/layout.ts backend/src/org.ts backend/test/layout.test.ts backend/test/org.test.ts
git commit -m "feat(backend): office auto-layout and reporting-cycle check"
```

---

### Task 3: Authentication

**Files:**
- Create: `backend/src/auth.ts`, `backend/src/routes/auth.ts`, `backend/test/auth.test.ts`
- Modify: `backend/src/http.ts` (add `requireUser`, `requireMember`, `audit`), `backend/src/app.ts`, `backend/test/helpers.ts`

**Interfaces:**
- Consumes: `prisma`, `HttpError`.
- Produces: `auth`, `googleEnabled: boolean`, `requireUser(req) => Promise<{ id; name; email }>`, `requireMember(req, workspaceId, min?: Role) => Promise<{ user; role: Role }>`, `audit(db, workspaceId, actorUserId, action, targetType, targetId, data?)`; routes `GET /api/auth-config` -> `{ google: boolean }`, `GET /api/me` -> `{ user: { id, name, email }, workspaces: { id, name, slug, role }[] }`; test helpers `signUp(app)` -> `{ cookie, email }` and `client(app, cookie)`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/helpers.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { FastifyInstance, InjectOptions } from "fastify";

export const ORIGIN = "http://localhost:3000";

export async function signUp(app: FastifyInstance, email = `u-${randomUUID()}@test.dev`) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { email, password: "correct-horse-1", name: "Test User" },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`);
  const cookie = [res.headers["set-cookie"]].flat().map((c) => String(c).split(";")[0]).join("; ");
  return { cookie, email };
}

/** Request helper bound to one signed-in user. */
export function client(app: FastifyInstance, cookie: string) {
  return (method: InjectOptions["method"], url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as InjectOptions["payload"], headers: { cookie, origin: ORIGIN } });
}
```

`backend/test/auth.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

test("sign up gives a session that /api/me recognises", async () => {
  const { cookie, email } = await signUp(app);
  const res = await client(app, cookie)("GET", "/api/me");
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ user: { email, name: "Test User" }, workspaces: [] });
  expect(res.body).not.toContain("password");
});

test("signed-out requests get 401 in the standard shape", async () => {
  const res = await app.inject({ method: "GET", url: "/api/me" });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in first" } });
});

test("sign in with the right password works and the wrong one does not", async () => {
  const { email } = await signUp(app);
  const ok = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: ORIGIN }, payload: { email, password: "correct-horse-1" } });
  expect(ok.statusCode).toBe(200);
  const bad = await app.inject({ method: "POST", url: "/api/auth/sign-in/email", headers: { origin: ORIGIN }, payload: { email, password: "wrong-password-9" } });
  expect(bad.statusCode).toBe(401);
});

test("auth-config reports whether Google is configured", async () => {
  const res = await app.inject({ method: "GET", url: "/api/auth-config" });
  expect(res.json()).toEqual({ google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/auth.test.ts`
Expected: FAIL, `sign-up failed: 404`.

- [ ] **Step 3: Write `backend/src/auth.ts`**

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db.js";

export const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  // The browser reaches us through the Next.js proxy, so the public URL is the frontend's.
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins: [process.env.FRONTEND_URL ?? "http://localhost:3000"],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  socialProviders: googleEnabled
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! } }
    : {},
});
```

- [ ] **Step 4: Add session and membership helpers to `backend/src/http.ts`**

Append:

```ts
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.js";
import { prisma, type Db } from "./db.js";
import type { Prisma, Role } from "./generated/prisma/client.js";

export async function requireUser(req: FastifyRequest) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new HttpError(401, "unauthenticated", "Sign in first");
  return session.user;
}

const rank: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export async function requireMember(req: FastifyRequest, workspaceId: string, min: Role = "viewer") {
  const user = await requireUser(req);
  const membership = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
  // 404, not 403, so workspace ids can't be probed.
  if (!membership) throw new HttpError(404, "not_found", "Workspace not found");
  if (rank[membership.role] < rank[min]) throw new HttpError(403, "forbidden", "Your role can't do that");
  return { user, role: membership.role };
}

export function audit(
  db: Db,
  workspaceId: string,
  actorUserId: string,
  action: string,
  targetType: string,
  targetId: string,
  data?: Prisma.InputJsonValue,
) {
  return db.auditLog.create({ data: { workspaceId, actorUserId, action, targetType, targetId, data } });
}
```

(Move the new `import` lines to the top of the file with the existing imports.)

- [ ] **Step 5: Write `backend/src/routes/auth.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth, googleEnabled } from "../auth.js";
import { prisma } from "../db.js";
import { requireUser } from "../http.js";

export async function authRoutes(app: FastifyInstance) {
  // Better Auth speaks Fetch Request/Response; translate from Fastify.
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    config: { rateLimit: { max: 100, timeWindow: "1 minute" } },
    async handler(req, reply) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers: fromNodeHeaders(req.headers),
          ...(req.body ? { body: JSON.stringify(req.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.get("/api/auth-config", async () => ({ google: googleEnabled }));

  app.get("/api/me", async (req) => {
    const user = await requireUser(req);
    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: { workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "asc" },
    });
    return {
      user: { id: user.id, name: user.name, email: user.email },
      workspaces: memberships.map((m) => ({ ...m.workspace, role: m.role })),
    };
  });
}
```

- [ ] **Step 6: Register in `backend/src/app.ts`**

Add `import { authRoutes } from "./routes/auth.js";` and `await app.register(authRoutes);` before the waitlist registration.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/auth.test.ts && npm run typecheck`
Expected: 4 passed, typecheck exits 0. If sign-in sets multiple cookies and only one arrives, check that `reply.header("set-cookie", ...)` appends (Fastify does for `set-cookie`).

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): better-auth sign-up/sign-in, session and membership guards"
```

---

### Task 4: Workspaces, templates, and the snapshot

**Files:**
- Create: `backend/src/templates.ts`, `backend/src/snapshot.ts`, `backend/src/routes/workspaces.ts`, `backend/test/workspaces.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `autoLayout`, `Layout`, `requireUser`, `requireMember`, `audit`, `prisma`, `Db`.
- Produces:
  - `type TemplateKey = "starter" | "studio" | "head-only"`
  - `createWorkspaceFromTemplate(userId: string, name: string, template: TemplateKey): Promise<{ id: string; slug: string }>`
  - `relayout(db: Db, workspaceId: string): Promise<void>`
  - `DEFAULT_LOOK`, `type Look`
  - `snapshot(workspaceId, userId, role)` returning `Snapshot` (shape below, mirrored in frontend `src/lib/types.ts`)
  - `POST /api/workspaces` `{ name, template }` -> 201 `{ id, slug }`; `GET /api/workspaces/:id` -> `Snapshot`

`Snapshot` JSON shape:

```ts
{
  workspace: { id: string; name: string; slug: string };
  role: "owner" | "admin" | "member" | "viewer";
  departments: { id: string; name: string; sortOrder: number }[];
  agents: {
    id: string; name: string; role: string; kind: "ai" | "human"; workingStyle: string;
    status: "active" | "paused" | "archived"; isHead: boolean;
    departmentId: string | null; managerId: string | null;
    appearance: { style: "robot" | "orb"; color: string; head: "square" | "round" | "tall"; eyes: "dots" | "visor" | "wide"; accessory: "none" | "antenna" | "headset" | "cap" };
  }[];
  layout: { zones: { departmentId: string; x: number; y: number; w: number; h: number }[]; desks: Record<string, { x: number; y: number }> };
  preferences: { theme: "system" | "light" | "dark"; reducedMotion: boolean; calmMode: boolean };
}
```

- [ ] **Step 1: Write the failing tests**

`backend/test/workspaces.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function owner(template = "starter") {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const res = await req("POST", "/api/workspaces", { name: "Asha Bakery", template });
  expect(res.statusCode).toBe(201);
  return { req, id: res.json().id as string, slug: res.json().slug as string };
}

test("starter template creates 5 companions, one head, desks inside zones", async () => {
  const { req, id, slug } = await owner();
  expect(slug).toMatch(/^asha-bakery/);
  const s = (await req("GET", `/api/workspaces/${id}`)).json();
  expect(s.role).toBe("owner");
  expect(s.agents).toHaveLength(5);
  expect(s.departments.map((d: { name: string }) => d.name)).toEqual(["Leadership", "Product", "Engineering", "Design", "Content"]);
  expect(s.agents.filter((a: { isHead: boolean }) => a.isHead)).toHaveLength(1);
  for (const a of s.agents) {
    const z = s.layout.zones.find((z: { departmentId: string }) => z.departmentId === a.departmentId);
    const d = s.layout.desks[a.id];
    expect(d.x >= z.x && d.x <= z.x + z.w && d.y >= z.y && d.y <= z.y + z.h).toBe(true);
    expect(a.status).toBe("active");
  }
  expect(s.preferences).toEqual({ theme: "system", reducedMotion: false, calmMode: false });
});

test("studio template wires every specialist up to the head agent", async () => {
  const { req, id } = await owner("studio");
  const { agents } = (await req("GET", `/api/workspaces/${id}`)).json();
  expect(agents).toHaveLength(13);
  const byId = new Map(agents.map((a: { id: string }) => [a.id, a]));
  for (const a of agents) {
    let cur = a;
    for (let i = 0; i < 5 && !cur.isHead; i++) cur = byId.get(cur.managerId);
    expect(cur.isHead).toBe(true);
  }
});

test("head-only template creates just the head agent", async () => {
  const { req, id } = await owner("head-only");
  expect((await req("GET", `/api/workspaces/${id}`)).json().agents).toHaveLength(1);
});

test("same company name gets a different slug", async () => {
  const a = await owner();
  const b = await owner();
  expect(a.slug).not.toBe(b.slug);
});

test("bad input is rejected with 400", async () => {
  const { cookie } = await signUp(app);
  const res = await client(app, cookie)("POST", "/api/workspaces", { name: "", template: "huge" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.code).toBe("invalid");
});

test("another user cannot see the workspace: 404", async () => {
  const { id } = await owner();
  const { cookie } = await signUp(app);
  const res = await client(app, cookie)("GET", `/api/workspaces/${id}`);
  expect(res.statusCode).toBe(404);
});

test("signed-out create is 401", async () => {
  const res = await app.inject({ method: "POST", url: "/api/workspaces", payload: { name: "X", template: "starter" } });
  expect(res.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/workspaces.test.ts`
Expected: FAIL, first test gets 404 instead of 201.

- [ ] **Step 3: Write `backend/src/templates.ts`**

```ts
import { randomBytes } from "node:crypto";
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
    orderBy: { createdAt: "asc" },
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
  return prisma.$transaction(
    async (tx) => {
      const ws = await tx.workspace.create({ data: { name, slug, memberships: { create: { userId, role: "owner" } } } });
      const deptIds = new Map<string, string>();
      for (const [i, deptName] of t.departments.entries()) {
        deptIds.set(deptName, (await tx.department.create({ data: { workspaceId: ws.id, name: deptName, sortOrder: i } })).id);
      }
      const agentIds = new Map<string, string>();
      for (const a of t.agents) {
        const created = await tx.agent.create({
          data: {
            workspaceId: ws.id,
            name: a.name,
            role: a.role,
            workingStyle: a.style,
            isHead: a.key === "head",
            departmentId: deptIds.get(a.dept)!,
            managerId: a.manager ? agentIds.get(a.manager)! : null,
            appearance: { create: a.look },
          },
        });
        agentIds.set(a.key, created.id);
      }
      await relayout(tx, ws.id);
      await tx.auditLog.create({
        data: { workspaceId: ws.id, actorUserId: userId, action: "workspace.create", targetType: "workspace", targetId: ws.id, data: { template } },
      });
      return { id: ws.id, slug: ws.slug };
    },
    { timeout: 20_000 },
  );
}
```

- [ ] **Step 4: Write `backend/src/snapshot.ts`**

```ts
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
    appearance: look,
  };
}

export async function snapshot(workspaceId: string, userId: string, role: Role) {
  const [workspace, departments, agents, layout, pref] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { id: true, name: true, slug: true } }),
    prisma.department.findMany({ where: { workspaceId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, sortOrder: true } }),
    prisma.agent.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, include: { appearance: true } }),
    prisma.officeLayout.findUnique({ where: { workspaceId } }),
    prisma.userPreference.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } }),
  ]);
  return {
    workspace,
    role,
    departments,
    agents: agents.map(toAgentDTO),
    layout: (layout?.layout as Layout | undefined) ?? { zones: [], desks: {} },
    preferences: { theme: pref?.theme ?? "system", reducedMotion: pref?.reducedMotion ?? false, calmMode: pref?.calmMode ?? false },
  };
}
```

- [ ] **Step 5: Write `backend/src/routes/workspaces.ts`** (more routes join in Task 6)

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireMember, requireUser } from "../http.js";
import { snapshot } from "../snapshot.js";
import { createWorkspaceFromTemplate } from "../templates.js";

export const WsParams = z.object({ id: z.string().min(1).max(64) });
export const Name = z.string().trim().min(1).max(60);

const CreateWorkspace = z.object({ name: Name, template: z.enum(["starter", "studio", "head-only"]) });

export async function workspaceRoutes(app: FastifyInstance) {
  app.post("/api/workspaces", async (req, reply) => {
    const user = await requireUser(req);
    const body = CreateWorkspace.parse(req.body);
    return reply.code(201).send(await createWorkspaceFromTemplate(user.id, body.name, body.template));
  });

  app.get("/api/workspaces/:id", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user, role } = await requireMember(req, id);
    return snapshot(id, user.id, role);
  });
}
```

- [ ] **Step 6: Register in `backend/src/app.ts`**

Add `import { workspaceRoutes } from "./routes/workspaces.js";` and `await app.register(workspaceRoutes);` after `authRoutes`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/workspaces.test.ts && npm run typecheck`
Expected: 7 passed, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): workspaces from team templates and the office snapshot"
```

---

### Task 5: Companion (agent) API

**Files:**
- Create: `backend/src/routes/agents.ts`, `backend/test/agents.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `requireMember`, `audit`, `relayout`, `createsCycle`, `HttpError`, `WsParams`, `Name`, `prisma`.
- Produces: `POST /api/workspaces/:id/agents` -> 201 `{ id }`; `PATCH /api/workspaces/:id/agents/:agentId` -> `{ id }`; `POST /api/workspaces/:id/agents/:agentId/clone` -> 201 `{ id }`. Request body fields: `name, role, kind, workingStyle, departmentId, managerId, appearance` (and `status` on PATCH).

- [ ] **Step 1: Write the failing tests**

`backend/test/agents.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

const LOOK = { style: "robot", color: "#ff7a00", head: "tall", eyes: "wide", accessory: "cap" };

async function setup(template = "starter") {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Test Co", template })).json().id as string;
  const snap = async () => (await req("GET", `/api/workspaces/${id}`)).json();
  const s = await snap();
  const head = s.agents.find((a: { isHead: boolean }) => a.isHead);
  return { req, id, snap, s, head };
}

test("create a companion: it appears with a desk", async () => {
  const { req, id, snap, s, head } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents`, {
    name: "Zed",
    role: "SEO specialist",
    departmentId: s.departments[0].id,
    managerId: head.id,
    appearance: LOOK,
  });
  expect(res.statusCode).toBe(201);
  const after = await snap();
  const zed = after.agents.find((a: { id: string }) => a.id === res.json().id);
  expect(zed).toMatchObject({ name: "Zed", kind: "ai", status: "active", isHead: false, appearance: LOOK });
  expect(after.layout.desks[zed.id]).toBeDefined();
});

test("invalid color is 400", async () => {
  const { req, id } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents`, { name: "Bad", role: "X", appearance: { ...LOOK, color: "orange" } });
  expect(res.statusCode).toBe(400);
});

test("reporting loops are rejected with 409", async () => {
  const { req, id, s, head } = await setup();
  const pm = s.agents.find((a: { role: string }) => a.role === "Product manager");
  const self = await req("PATCH", `/api/workspaces/${id}/agents/${pm.id}`, { managerId: pm.id });
  expect(self.statusCode).toBe(409);
  const dev = s.agents.find((a: { role: string }) => a.role === "Full-stack developer");
  await req("PATCH", `/api/workspaces/${id}/agents/${dev.id}`, { managerId: pm.id });
  const loop = await req("PATCH", `/api/workspaces/${id}/agents/${pm.id}`, { managerId: dev.id });
  expect(loop.statusCode).toBe(409);
  expect(loop.json().error.message).toBe("That would make a reporting loop");
  expect(head).toBeDefined();
});

test("head agent cannot be archived or given a manager", async () => {
  const { req, id, s, head } = await setup();
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${head.id}`, { status: "archived" })).statusCode).toBe(400);
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${head.id}`, { managerId: s.agents[1].id })).statusCode).toBe(400);
});

test("ids from another workspace are rejected", async () => {
  const a = await setup();
  const b = await setup();
  const target = a.s.agents[1].id;
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${target}`, { departmentId: b.s.departments[0].id })).statusCode).toBe(400);
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${target}`, { managerId: b.head.id })).statusCode).toBe(400);
  // and B cannot touch A's agent through B's own workspace path
  expect((await b.req("PATCH", `/api/workspaces/${b.id}/agents/${target}`, { name: "Hijack" })).statusCode).toBe(404);
  // nor through A's path
  expect((await b.req("PATCH", `/api/workspaces/${a.id}/agents/${target}`, { name: "Hijack" })).statusCode).toBe(404);
});

test("an archived companion cannot become a manager", async () => {
  const { req, id, s } = await setup();
  const [, x, y] = s.agents;
  await req("PATCH", `/api/workspaces/${id}/agents/${x.id}`, { status: "archived" });
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${y.id}`, { managerId: x.id })).statusCode).toBe(400);
});

test("archive hides the desk, keeps the record, writes an audit entry", async () => {
  const { req, id, snap, s } = await setup();
  const target = s.agents[2];
  expect((await req("PATCH", `/api/workspaces/${id}/agents/${target.id}`, { status: "archived" })).statusCode).toBe(200);
  const after = await snap();
  expect(after.agents.find((a: { id: string }) => a.id === target.id).status).toBe("archived");
  expect(after.layout.desks[target.id]).toBeUndefined();
  expect(await prisma.auditLog.count({ where: { workspaceId: id, action: "agent.archive", targetId: target.id } })).toBe(1);
});

test("pause and resume are saved", async () => {
  const { req, id, snap, s } = await setup();
  const t = s.agents[1];
  await req("PATCH", `/api/workspaces/${id}/agents/${t.id}`, { status: "paused" });
  expect((await snap()).agents.find((a: { id: string }) => a.id === t.id).status).toBe("paused");
  await req("PATCH", `/api/workspaces/${id}/agents/${t.id}`, { status: "active" });
  expect((await snap()).agents.find((a: { id: string }) => a.id === t.id).status).toBe("active");
});

test("clone makes a new identity with the same profile and look", async () => {
  const { req, id, snap, head } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents/${head.id}/clone`);
  expect(res.statusCode).toBe(201);
  const copy = (await snap()).agents.find((a: { id: string }) => a.id === res.json().id);
  expect(copy).toMatchObject({ name: "Nova copy", role: head.role, isHead: false, managerId: head.id, appearance: head.appearance });
});

test("updating appearance and profile persists", async () => {
  const { req, id, snap, s } = await setup();
  const t = s.agents[1];
  await req("PATCH", `/api/workspaces/${id}/agents/${t.id}`, { name: "Priya Prime", kind: "human", appearance: LOOK });
  expect((await snap()).agents.find((a: { id: string }) => a.id === t.id)).toMatchObject({ name: "Priya Prime", kind: "human", appearance: LOOK });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/agents.test.ts`
Expected: FAIL, create returns 404.

- [ ] **Step 3: Write `backend/src/routes/agents.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit, HttpError, requireMember } from "../http.js";
import { createsCycle } from "../org.js";
import { relayout } from "../templates.js";
import { Name, WsParams } from "./workspaces.js";

const AgentParams = WsParams.extend({ agentId: z.string().min(1).max(64) });

const Look = z.object({
  style: z.enum(["robot", "orb"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb color"),
  head: z.enum(["square", "round", "tall"]),
  eyes: z.enum(["dots", "visor", "wide"]),
  accessory: z.enum(["none", "antenna", "headset", "cap"]),
});

const Fields = {
  name: Name,
  role: Name,
  kind: z.enum(["ai", "human"]),
  workingStyle: z.string().trim().max(500),
  departmentId: z.string().max(64).nullable(),
  managerId: z.string().max(64).nullable(),
  appearance: Look,
};

const CreateAgent = z.object({
  ...Fields,
  kind: Fields.kind.default("ai"),
  workingStyle: Fields.workingStyle.default(""),
  departmentId: Fields.departmentId.default(null),
  managerId: Fields.managerId.default(null),
});

const UpdateAgent = z.object(Fields).partial().extend({ status: z.enum(["active", "paused", "archived"]).optional() });

/** Department and manager must exist in this workspace; managers must be active and not create a loop. */
async function checkRelations(workspaceId: string, agentId: string | null, departmentId?: string | null, managerId?: string | null) {
  if (departmentId) {
    const dept = await prisma.department.findFirst({ where: { id: departmentId, workspaceId } });
    if (!dept) throw new HttpError(400, "invalid", "That department isn't in this workspace");
  }
  if (managerId) {
    const all = await prisma.agent.findMany({ where: { workspaceId }, select: { id: true, managerId: true, status: true } });
    const manager = all.find((a) => a.id === managerId);
    if (!manager || manager.status !== "active") throw new HttpError(400, "invalid", "The manager must be an active companion in this workspace");
    if (agentId && createsCycle(agentId, managerId, new Map(all.map((a) => [a.id, a.managerId])))) {
      throw new HttpError(409, "cycle", "That would make a reporting loop");
    }
  }
}

export async function agentRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/agents", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { appearance, ...body } = CreateAgent.parse(req.body);
    await checkRelations(id, null, body.departmentId, body.managerId);
    const agent = await prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({ data: { ...body, workspaceId: id, appearance: { create: appearance } } });
      await relayout(tx, id);
      await audit(tx, id, user.id, "agent.create", "agent", created.id, { name: created.name });
      return created;
    });
    return reply.code(201).send({ id: agent.id });
  });

  app.patch("/api/workspaces/:id/agents/:agentId", async (req) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { appearance, status, ...body } = UpdateAgent.parse(req.body);
    const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: id } });
    if (!agent) throw new HttpError(404, "not_found", "Companion not found");
    if (agent.isHead && status === "archived") throw new HttpError(400, "invalid", "The head agent can't be archived");
    if (agent.isHead && body.managerId) throw new HttpError(400, "invalid", "The head agent reports to you, not to another companion");
    if (agent.managerId !== body.managerId || agent.departmentId !== body.departmentId) {
      await checkRelations(id, agentId, body.departmentId, body.managerId);
    }
    const structural = (body.departmentId !== undefined && body.departmentId !== agent.departmentId) || (status !== undefined && status !== agent.status);
    const action = status && status !== agent.status ? { archived: "agent.archive", paused: "agent.pause", active: "agent.resume" }[status] : "agent.update";

    await prisma.$transaction(async (tx) => {
      await tx.agent.update({
        where: { id: agentId },
        data: {
          ...body,
          status,
          ...(appearance && { appearance: { upsert: { create: appearance, update: appearance } } }),
        },
      });
      if (structural) await relayout(tx, id);
      await audit(tx, id, user.id, action, "agent", agentId, { fields: Object.keys(req.body as object) });
    });
    return { id: agentId };
  });

  app.post("/api/workspaces/:id/agents/:agentId/clone", async (req, reply) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const src = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: id }, include: { appearance: true } });
    if (!src) throw new HttpError(404, "not_found", "Companion not found");
    const look = src.appearance ? { style: src.appearance.style, color: src.appearance.color, head: src.appearance.head, eyes: src.appearance.eyes, accessory: src.appearance.accessory } : undefined;
    const copy = await prisma.$transaction(async (tx) => {
      const created = await tx.agent.create({
        data: {
          workspaceId: id,
          name: `${src.name} copy`.slice(0, 60),
          role: src.role,
          kind: src.kind,
          workingStyle: src.workingStyle,
          departmentId: src.departmentId,
          // A copy of the head agent reports to the head agent.
          managerId: src.isHead ? src.id : src.managerId,
          ...(look && { appearance: { create: look } }),
        },
      });
      await relayout(tx, id);
      await audit(tx, id, user.id, "agent.clone", "agent", created.id, { from: src.id });
      return created;
    });
    return reply.code(201).send({ id: copy.id });
  });
}
```

- [ ] **Step 4: Register in `backend/src/app.ts`**

Add `import { agentRoutes } from "./routes/agents.js";` and `await app.register(agentRoutes);` after `workspaceRoutes`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/agents.test.ts && npm run typecheck`
Expected: 10 passed, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): companion create, update, clone with cycle and head-agent rules"
```

---

### Task 6: Departments, layout, preferences, rename, and role enforcement

**Files:**
- Modify: `backend/src/routes/workspaces.ts`
- Test: `backend/test/settings.test.ts`

**Interfaces:**
- Consumes: `requireMember`, `audit`, `relayout`, `UNASSIGNED`, `prisma`.
- Produces: `PATCH /api/workspaces/:id` `{ name }`; `POST /api/workspaces/:id/departments` `{ name }` -> 201 `{ id }`; `PATCH /api/workspaces/:id/departments/:deptId` `{ name?, sortOrder? }`; `DELETE /api/workspaces/:id/departments/:deptId` -> 204; `PUT /api/workspaces/:id/layout` `Layout` -> `{ ok: true }`; `PUT /api/workspaces/:id/preferences` `{ theme, reducedMotion, calmMode }` -> `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

`backend/test/settings.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function setup() {
  const owner = await signUp(app);
  const req = client(app, owner.cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Test Co", template: "starter" })).json().id as string;
  const snap = async () => (await req("GET", `/api/workspaces/${id}`)).json();
  return { req, id, snap, s: await snap() };
}

test("viewer can read and set own preferences but cannot edit", async () => {
  const { id, s } = await setup();
  const viewer = await signUp(app);
  const me = (await client(app, viewer.cookie)("GET", "/api/me")).json();
  await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role: "viewer" } });
  const v = client(app, viewer.cookie);
  expect((await v("GET", `/api/workspaces/${id}`)).json().role).toBe("viewer");
  expect((await v("PATCH", `/api/workspaces/${id}/agents/${s.agents[1].id}`, { name: "Nope" })).statusCode).toBe(403);
  expect((await v("PUT", `/api/workspaces/${id}/layout`, s.layout)).statusCode).toBe(403);
  expect((await v("POST", `/api/workspaces/${id}/departments`, { name: "Sales" })).statusCode).toBe(403);
  expect((await v("PUT", `/api/workspaces/${id}/preferences`, { theme: "dark", reducedMotion: true, calmMode: false })).statusCode).toBe(200);
});

test("member can edit companions but not departments or the workspace name", async () => {
  const { id, s } = await setup();
  const member = await signUp(app);
  const me = (await client(app, member.cookie)("GET", "/api/me")).json();
  await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role: "member" } });
  const m = client(app, member.cookie);
  expect((await m("PATCH", `/api/workspaces/${id}/agents/${s.agents[1].id}`, { name: "Okay" })).statusCode).toBe(200);
  expect((await m("POST", `/api/workspaces/${id}/departments`, { name: "Sales" })).statusCode).toBe(403);
  expect((await m("PATCH", `/api/workspaces/${id}`, { name: "Mine now" })).statusCode).toBe(403);
});

test("owner renames the workspace", async () => {
  const { req, id, snap } = await setup();
  expect((await req("PATCH", `/api/workspaces/${id}`, { name: "Renamed Co" })).statusCode).toBe(200);
  expect((await snap()).workspace.name).toBe("Renamed Co");
});

test("departments: add, duplicate name is 409, rename, reorder", async () => {
  const { req, id, snap } = await setup();
  const add = await req("POST", `/api/workspaces/${id}/departments`, { name: "Sales" });
  expect(add.statusCode).toBe(201);
  expect((await req("POST", `/api/workspaces/${id}/departments`, { name: "Sales" })).statusCode).toBe(409);
  const deptId = add.json().id;
  await req("PATCH", `/api/workspaces/${id}/departments/${deptId}`, { name: "Sales and support", sortOrder: -1 });
  const s = await snap();
  expect(s.departments[0]).toMatchObject({ id: deptId, name: "Sales and support" });
  expect(s.layout.zones[0].departmentId).toBe(deptId);
});

test("deleting a department leaves its companions unassigned but still in the office", async () => {
  const { req, id, snap, s } = await setup();
  const design = s.departments.find((d: { name: string }) => d.name === "Design");
  const designer = s.agents.find((a: { departmentId: string }) => a.departmentId === design.id);
  expect((await req("DELETE", `/api/workspaces/${id}/departments/${design.id}`)).statusCode).toBe(204);
  const after = await snap();
  expect(after.agents.find((a: { id: string }) => a.id === designer.id).departmentId).toBeNull();
  expect(after.layout.zones.some((z: { departmentId: string }) => z.departmentId === "unassigned")).toBe(true);
  expect(after.layout.desks[designer.id]).toBeDefined();
});

test("layout save keeps known desks and drops foreign ids", async () => {
  const { req, id, snap, s } = await setup();
  const other = await setup();
  const mine = s.agents[1].id;
  const layout = { zones: s.layout.zones, desks: { ...s.layout.desks, [mine]: { x: 999, y: 555 }, [other.s.agents[0].id]: { x: 1, y: 1 } } };
  expect((await req("PUT", `/api/workspaces/${id}/layout`, layout)).statusCode).toBe(200);
  const after = await snap();
  expect(after.layout.desks[mine]).toEqual({ x: 999, y: 555 });
  expect(after.layout.desks[other.s.agents[0].id]).toBeUndefined();
});

test("layout with absurd sizes is rejected", async () => {
  const { req, id } = await setup();
  const desks = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`a${i}`, { x: 0, y: 0 }]));
  expect((await req("PUT", `/api/workspaces/${id}/layout`, { zones: [], desks })).statusCode).toBe(400);
});

test("preferences are per user and persist", async () => {
  const { req, id, snap } = await setup();
  await req("PUT", `/api/workspaces/${id}/preferences`, { theme: "dark", reducedMotion: true, calmMode: true });
  expect((await snap()).preferences).toEqual({ theme: "dark", reducedMotion: true, calmMode: true });
});

test("non-members get 404 on every write route", async () => {
  const { id, s } = await setup();
  const stranger = client(app, (await signUp(app)).cookie);
  const routes: [string, string, unknown][] = [
    ["PATCH", `/api/workspaces/${id}`, { name: "x" }],
    ["POST", `/api/workspaces/${id}/departments`, { name: "x" }],
    ["PATCH", `/api/workspaces/${id}/departments/${s.departments[0].id}`, { name: "x" }],
    ["DELETE", `/api/workspaces/${id}/departments/${s.departments[0].id}`, undefined],
    ["PUT", `/api/workspaces/${id}/layout`, s.layout],
    ["PUT", `/api/workspaces/${id}/preferences`, { theme: "dark", reducedMotion: false, calmMode: false }],
    ["POST", `/api/workspaces/${id}/agents`, { name: "x", role: "x", appearance: { style: "robot", color: "#000000", head: "square", eyes: "dots", accessory: "none" } }],
    ["POST", `/api/workspaces/${id}/agents/${s.agents[0].id}/clone`, undefined],
  ];
  for (const [method, url, body] of routes) expect((await stranger(method as "GET", url, body)).statusCode, `${method} ${url}`).toBe(404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/settings.test.ts`
Expected: FAIL, routes return 404 for the owner too.

- [ ] **Step 3: Add routes to `backend/src/routes/workspaces.ts`**

Add imports at the top:

```ts
import { prisma } from "../db.js";
import { audit, HttpError } from "../http.js";
import { UNASSIGNED } from "../layout.js";
import { relayout } from "../templates.js";
import type { Prisma } from "../generated/prisma/client.js";
```

Add schemas below `CreateWorkspace`:

```ts
const DeptParams = WsParams.extend({ deptId: z.string().min(1).max(64) });
const Point = z.object({ x: z.number().finite(), y: z.number().finite() });
const LayoutBody = z.object({
  zones: z.array(Point.extend({ departmentId: z.string().max(64), w: z.number().positive(), h: z.number().positive() })).max(200),
  desks: z.record(z.string().max(64), Point).refine((d) => Object.keys(d).length <= 1000, "too many desks"),
});
const Preferences = z.object({ theme: z.enum(["system", "light", "dark"]), reducedMotion: z.boolean(), calmMode: z.boolean() });
```

Add inside `workspaceRoutes`, after the GET route:

```ts
  app.patch("/api/workspaces/:id", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const { name } = z.object({ name: Name }).parse(req.body);
    await prisma.workspace.update({ where: { id }, data: { name } });
    await audit(prisma, id, user.id, "workspace.rename", "workspace", id, { name });
    return { ok: true };
  });

  app.post("/api/workspaces/:id/departments", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const { name } = z.object({ name: Name }).parse(req.body);
    const dept = await prisma.$transaction(async (tx) => {
      const last = await tx.department.findFirst({ where: { workspaceId: id }, orderBy: { sortOrder: "desc" } });
      const created = await tx.department.create({ data: { workspaceId: id, name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
      await relayout(tx, id);
      await audit(tx, id, user.id, "department.create", "department", created.id, { name });
      return created;
    });
    return reply.code(201).send({ id: dept.id });
  });

  app.patch("/api/workspaces/:id/departments/:deptId", async (req) => {
    const { id, deptId } = DeptParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const body = z.object({ name: Name.optional(), sortOrder: z.number().int().min(-1000).max(1000).optional() }).parse(req.body);
    if (!(await prisma.department.findFirst({ where: { id: deptId, workspaceId: id } }))) throw new HttpError(404, "not_found", "Department not found");
    await prisma.$transaction(async (tx) => {
      await tx.department.update({ where: { id: deptId }, data: body });
      if (body.sortOrder !== undefined) await relayout(tx, id);
      await audit(tx, id, user.id, "department.update", "department", deptId, body);
    });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/departments/:deptId", async (req, reply) => {
    const { id, deptId } = DeptParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    if (!(await prisma.department.findFirst({ where: { id: deptId, workspaceId: id } }))) throw new HttpError(404, "not_found", "Department not found");
    await prisma.$transaction(async (tx) => {
      // Agents are kept: the foreign key sets their departmentId to null.
      await tx.department.delete({ where: { id: deptId } });
      await relayout(tx, id);
      await audit(tx, id, user.id, "department.delete", "department", deptId);
    });
    return reply.code(204).send();
  });

  app.put("/api/workspaces/:id/layout", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id, "member");
    const body = LayoutBody.parse(req.body);
    const agentIds = new Set((await prisma.agent.findMany({ where: { workspaceId: id }, select: { id: true } })).map((a) => a.id));
    const deptIds = new Set((await prisma.department.findMany({ where: { workspaceId: id }, select: { id: true } })).map((d) => d.id));
    const layout = {
      zones: body.zones.filter((z) => deptIds.has(z.departmentId) || z.departmentId === UNASSIGNED),
      desks: Object.fromEntries(Object.entries(body.desks).filter(([agentId]) => agentIds.has(agentId))),
    } as unknown as Prisma.InputJsonValue;
    await prisma.officeLayout.upsert({ where: { workspaceId: id }, create: { workspaceId: id, layout }, update: { layout } });
    return { ok: true };
  });

  app.put("/api/workspaces/:id/preferences", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id);
    const prefs = Preferences.parse(req.body);
    await prisma.userPreference.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: id } },
      create: { userId: user.id, workspaceId: id, ...prefs },
      update: prefs,
    });
    return { ok: true };
  });
```

- [ ] **Step 4: Run the whole backend suite**

Run: `cd backend && npm test && npm run typecheck`
Expected: all test files pass (health 2, layout 4, org 4, auth 4, workspaces 7, agents 10, settings 9), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): departments, layout, preferences, rename, role enforcement"
```

---

### Task 7: Frontend foundation: proxy, auth pages, onboarding, workspace shell

**Files:**
- Modify: `frontend/next.config.ts`, `frontend/src/app/globals.css`, `frontend/src/components/landing/EarlyAccessForm.tsx`, `frontend/src/components/landing/Header.tsx`
- Create: `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/auth-client.ts`, `frontend/src/lib/workspace.tsx`, `frontend/src/components/app/AuthForm.tsx`, `frontend/src/components/app/AppShell.tsx`, `frontend/src/app/sign-in/page.tsx`, `frontend/src/app/sign-up/page.tsx`, `frontend/src/app/app/page.tsx`, `frontend/src/app/onboarding/page.tsx`, `frontend/src/app/w/[slug]/layout.tsx`, `frontend/src/app/w/[slug]/page.tsx` (placeholder replaced in Task 8)

**Interfaces:**
- Consumes: backend routes from Tasks 3-6.
- Produces: `api<T>(path, { method?, body? })`, `ApiError(status, message)`, `authClient`, types `Role, Appearance, Agent, Department, Zone, Layout, Preferences, Snapshot, Me`, helpers `canEdit(role)`, `canAdmin(role)`, `statusLabel(agent)`, `useWorkspace() => { snapshot, reload, setSnapshot, wsPath(path) }`.

- [ ] **Step 1: Install the auth client**

Run: `cd frontend && npm i better-auth@1.7`

- [ ] **Step 2: Write `frontend/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The E2E run builds into its own folder so it never clobbers the normal build.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.BACKEND_URL ?? "http://127.0.0.1:4000"}/api/:path*` }];
  },
};

export default nextConfig;
```

- [ ] **Step 3: Write `frontend/src/lib/types.ts`**

```ts
export type Role = "owner" | "admin" | "member" | "viewer";
export type Appearance = {
  style: "robot" | "orb";
  color: string;
  head: "square" | "round" | "tall";
  eyes: "dots" | "visor" | "wide";
  accessory: "none" | "antenna" | "headset" | "cap";
};
export type Agent = {
  id: string;
  name: string;
  role: string;
  kind: "ai" | "human";
  workingStyle: string;
  status: "active" | "paused" | "archived";
  isHead: boolean;
  departmentId: string | null;
  managerId: string | null;
  appearance: Appearance;
};
export type Department = { id: string; name: string; sortOrder: number };
export type Zone = { departmentId: string; x: number; y: number; w: number; h: number };
export type Layout = { zones: Zone[]; desks: Record<string, { x: number; y: number }> };
export type Preferences = { theme: "system" | "light" | "dark"; reducedMotion: boolean; calmMode: boolean };
export type Snapshot = {
  workspace: { id: string; name: string; slug: string };
  role: Role;
  departments: Department[];
  agents: Agent[];
  layout: Layout;
  preferences: Preferences;
};
export type Me = { user: { id: string; name: string; email: string }; workspaces: { id: string; name: string; slug: string; role: Role }[] };

export const UNASSIGNED = "unassigned";
export const canEdit = (r: Role) => r !== "viewer";
export const canAdmin = (r: Role) => r === "owner" || r === "admin";
export const statusLabel = (a: Agent) => ({ active: "Idle", paused: "Paused", archived: "Archived" })[a.status];
```

- [ ] **Step 4: Write `frontend/src/lib/api.ts` and `frontend/src/lib/auth-client.ts`**

`api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: hasBody ? { "content-type": "application/json" } : undefined,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? "Something went wrong. Try again.");
  return data as T;
}
```

`auth-client.ts`:

```ts
import { createAuthClient } from "better-auth/react";

// Same origin: Next.js proxies /api/auth/* to the backend.
export const authClient = createAuthClient();
```

- [ ] **Step 5: App theme tokens and companion animation in `frontend/src/app/globals.css`**

Append:

```css
/* App theme. The landing page stays light; the app follows the user's preference. */
.app {
  background: var(--bg);
  color: var(--ink);
}
.app[data-theme="dark"] {
  --bg: #0e1013;
  --paper: #16191d;
  --ink: #eef0f3;
  --muted: #9aa1ad;
  --line: #2a2e35;
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  .app[data-theme="system"] {
    --bg: #0e1013;
    --paper: #16191d;
    --ink: #eef0f3;
    --muted: #9aa1ad;
    --line: #2a2e35;
    color-scheme: dark;
  }
}

.bob {
  transform-box: fill-box;
  transform-origin: center;
}
@media (prefers-reduced-motion: no-preference) {
  .app:not([data-still="true"]) .bob {
    animation: bob 3.2s ease-in-out infinite;
  }
}
@keyframes bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
```

- [ ] **Step 6: Write `frontend/src/components/app/AuthForm.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GoogleLogo } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/landing/ui";

const input = "mt-2 w-full rounded-[10px] border border-line bg-paper px-4 py-3 text-ink focus:border-ink focus:outline-none";

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<boolean | null>(null);

  useEffect(() => {
    authClient.getSession().then(({ data }) => data && router.replace("/app"));
    api<{ google: boolean }>("/api/auth-config").then((c) => setGoogle(c.google), () => setGoogle(false));
  }, [router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const { error } =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: f.name, email: f.email, password: f.password })
        : await authClient.signIn.email({ email: f.email, password: f.password });
    setBusy(false);
    if (error) return setError(error.message ?? "That didn't work. Check your details and try again.");
    router.push("/app");
  }

  const title = mode === "sign-up" ? "Create your account" : "Welcome back";
  return (
    <main className="app grid-paper grid min-h-[100dvh] place-items-center px-4 py-12" data-theme="light">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-paper p-8 shadow-sm">
        <Link href="/" aria-label="Agent Company home"><Logo /></Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">{title}</h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "sign-up" && (
            <label className="block text-sm font-medium">
              Name
              <input name="name" required maxLength={60} autoComplete="name" className={input} />
            </label>
          )}
          <label className="block text-sm font-medium">
            Email
            <input name="email" type="email" required autoComplete="email" className={input} />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input name="password" type="password" required minLength={8} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} className={input} />
          </label>
          {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
          <button type="submit" disabled={busy} className="btn-dark w-full rounded-[12px] py-3 text-sm font-semibold text-paper disabled:opacity-70">
            {busy ? "One moment..." : mode === "sign-up" ? "Create account" : "Sign in"}
          </button>
        </form>
        <div className="mt-4">
          <button
            type="button"
            disabled={!google}
            onClick={() => authClient.signIn.social({ provider: "google", callbackURL: "/app" })}
            className="btn-light flex w-full items-center justify-center gap-2 rounded-[12px] py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            <GoogleLogo size={18} weight="bold" /> Continue with Google
          </button>
          {google === false && <p className="mt-2 text-xs text-muted">Google sign-in isn&apos;t set up on this server yet.</p>}
        </div>
        <p className="mt-8 text-sm text-muted">
          {mode === "sign-up" ? "Already have an account? " : "New here? "}
          <Link href={mode === "sign-up" ? "/sign-in" : "/sign-up"} className="font-medium text-ink underline">
            {mode === "sign-up" ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Sign-in, sign-up, and the `/app` entry**

`frontend/src/app/sign-in/page.tsx`:

```tsx
import { AuthForm } from "@/components/app/AuthForm";

export const metadata = { title: "Sign in | Agent Company" };
export default function SignIn() {
  return <AuthForm mode="sign-in" />;
}
```

`frontend/src/app/sign-up/page.tsx`:

```tsx
import { AuthForm } from "@/components/app/AuthForm";

export const metadata = { title: "Create account | Agent Company" };
export default function SignUp() {
  return <AuthForm mode="sign-up" />;
}
```

`frontend/src/app/app/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

/** Sends a signed-in user to their first workspace, or to onboarding, or to sign-in. */
export default function AppEntry() {
  const router = useRouter();
  useEffect(() => {
    api<Me>("/api/me").then(
      (me) => router.replace(me.workspaces[0] ? `/w/${me.workspaces[0].slug}` : "/onboarding"),
      (e) => router.replace(e instanceof ApiError && e.status === 401 ? "/sign-in" : "/sign-in?error=1"),
    );
  }, [router]);
  return <p className="p-8 text-muted">Opening your office...</p>;
}
```

- [ ] **Step 8: Write `frontend/src/app/onboarding/page.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Logo } from "@/components/landing/ui";

const templates = [
  { key: "starter", title: "Starter", text: "5 companions: head agent, product, engineering, design, content." },
  { key: "studio", title: "Full studio", text: "13 companions across six departments, with managers." },
  { key: "head-only", title: "Just the head agent", text: "Start with one and hire as you go." },
] as const;

export default function Onboarding() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/me").catch((e) => e instanceof ApiError && e.status === 401 && router.replace("/sign-in"));
  }, [router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const ws = await api<{ slug: string }>("/api/workspaces", { method: "POST", body: { name: f.get("name"), template: f.get("template") } });
      router.push(`/w/${ws.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="app grid-paper grid min-h-[100dvh] place-items-center px-4 py-12" data-theme="light">
      <form onSubmit={submit} className="w-full max-w-xl rounded-[16px] border border-line bg-paper p-8 shadow-sm">
        <Logo />
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">Set up your company</h1>
        <label className="mt-6 block text-sm font-medium">
          Company name
          <input name="name" required maxLength={60} className="mt-2 w-full rounded-[10px] border border-line bg-paper px-4 py-3 focus:border-ink focus:outline-none" />
        </label>
        <fieldset className="mt-6">
          <legend className="text-sm font-medium">Starting team</legend>
          <div className="mt-2 grid gap-3">
            {templates.map((t, i) => (
              <label key={t.key} className="flex cursor-pointer gap-3 rounded-[12px] border border-line p-4 has-[:checked]:border-ink has-[:checked]:bg-bg">
                <input type="radio" name="template" value={t.key} defaultChecked={i === 0} className="mt-1 accent-[var(--ink)]" />
                <span>
                  <span className="block font-semibold">{t.title}</span>
                  <span className="block text-sm text-muted">{t.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
        <button type="submit" disabled={busy} className="btn-dark mt-6 w-full rounded-[12px] py-3 text-sm font-semibold text-paper disabled:opacity-70">
          {busy ? "Hiring your team..." : "Create company"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 9: Write `frontend/src/lib/workspace.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Me, Snapshot } from "./types";

type Ctx = {
  snapshot: Snapshot;
  reload: () => Promise<void>;
  setSnapshot: (s: Snapshot) => void;
  /** Builds `/api/workspaces/:id<path>` for the current workspace. */
  wsPath: (path?: string) => string;
};

const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const me = await api<Me>("/api/me");
      const ws = me.workspaces.find((w) => w.slug === slug);
      if (!ws) return router.replace(me.workspaces[0] ? `/w/${me.workspaces[0].slug}` : "/onboarding");
      setSnapshot(await api<Snapshot>(`/api/workspaces/${ws.id}`));
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return router.replace("/sign-in");
      setError((e as Error).message);
    }
  }, [slug, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="grid min-h-[100dvh] place-items-center p-8 text-center">
        <div>
          <p role="alert">{error}</p>
          <button onClick={load} className="btn-light mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold">Try again</button>
        </div>
      </div>
    );
  }
  if (!snapshot) return <div className="min-h-[100dvh] animate-pulse bg-bg" aria-busy="true" aria-label="Loading your office" />;

  const wsPath = (path = "") => `/api/workspaces/${snapshot.workspace.id}${path}`;
  return <WorkspaceContext value={{ snapshot, reload: load, setSnapshot, wsPath }}>{children}</WorkspaceContext>;
}
```

- [ ] **Step 10: Write `frontend/src/components/app/AppShell.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Buildings, GearSix, SignOut, TreeStructure } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import { useWorkspace } from "@/lib/workspace";
import { Logo } from "@/components/landing/ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { snapshot } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const base = `/w/${snapshot.workspace.slug}`;
  const nav = [
    { href: base, label: "Office", icon: Buildings },
    { href: `${base}/organization`, label: "Organization", icon: TreeStructure },
    { href: `${base}/settings`, label: "Settings", icon: GearSix },
  ];
  const { theme, reducedMotion, calmMode } = snapshot.preferences;

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
  }

  return (
    <div className="app flex min-h-[100dvh] flex-col lg:flex-row" data-theme={theme} data-still={reducedMotion || calmMode}>
      <aside className="flex items-center justify-between gap-4 border-b border-line bg-paper px-4 py-3 lg:w-60 lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:p-5">
        <Link href={base} aria-label="Office home"><Logo className="text-lg" /></Link>
        <p className="hidden truncate text-sm font-medium text-muted lg:mt-6 lg:block">{snapshot.workspace.name}</p>
        <nav aria-label="App" className="flex gap-1 lg:mt-4 lg:flex-col">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm font-medium ${active ? "bg-ink text-paper" : "text-ink hover:bg-bg"}`}
              >
                <Icon size={18} /> <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <button onClick={signOut} className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-sm text-muted hover:bg-bg lg:mt-auto">
          <SignOut size={18} /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </aside>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
```

- [ ] **Step 11: Workspace layout and a temporary office page**

`frontend/src/app/w/[slug]/layout.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { WorkspaceProvider } from "@/lib/workspace";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useParams<{ slug: string }>();
  return (
    <WorkspaceProvider slug={slug}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
```

`frontend/src/app/w/[slug]/page.tsx` (replaced in Task 8):

```tsx
"use client";

import { useWorkspace } from "@/lib/workspace";

export default function OfficePage() {
  const { snapshot } = useWorkspace();
  return <p className="p-8">{snapshot.agents.length} companions in {snapshot.workspace.name}</p>;
}
```

- [ ] **Step 12: Landing tweaks**

In `frontend/src/components/landing/EarlyAccessForm.tsx`, delete the `API_URL` constant and change the fetch call to `fetch("/api/waitlist", {`.

In `frontend/src/components/landing/Header.tsx`, inside the right-hand `div` before the `DarkButton` wrapper, add:

```tsx
<a href="/sign-in" className="hidden text-sm font-medium text-ink/80 hover:text-ink sm:block">Sign in</a>
```

- [ ] **Step 13: Verify in the browser**

Run backend (`npm run dev:backend`) and frontend (`npm run dev:frontend`). In a browser: open `/sign-up`, create an account, land on `/onboarding`, create "Asha Bakery" with Starter, land on `/w/asha-bakery` showing "5 companions in Asha Bakery". Sign out from the sidebar, confirm `/w/asha-bakery` sends you to `/sign-in`. Submit the landing waitlist form and confirm success.

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 14: Commit**

```bash
git add frontend
git commit -m "feat(frontend): auth pages, onboarding, workspace provider and app shell"
```

---

### Task 8: Companion character and the Live Office

**Files:**
- Create: `frontend/src/components/app/CompanionAvatar.tsx`, `frontend/src/components/app/office/OfficeScene.tsx`, `frontend/src/components/app/office/OfficeList.tsx`, `frontend/src/components/app/office/Office.tsx`
- Replace: `frontend/src/app/w/[slug]/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `Snapshot`, `Agent`, `Appearance`, `Layout`, `statusLabel`, `canEdit`, `UNASSIGNED`, `api`.
- Produces: `CompanionFigure({ look })` (SVG `<g>` centered on 0,0), `CompanionAvatar({ look, size?, label? })`, `OfficeScene` with handle `{ centerOn(id: string): void }`, `OfficeList`, `Office`. Office renders the panel and form slots that Task 9 fills: it imports `CompanionPanel` and `CompanionForm`, so in this task create minimal versions that Task 9 replaces:

`frontend/src/components/app/CompanionPanel.tsx` (temporary):

```tsx
"use client";
import type { Agent } from "@/lib/types";
export function CompanionPanel({ agent, onClose }: { agent: Agent; onClose: () => void; onEdit: () => void; onSelect: (id: string) => void }) {
  return (
    <aside aria-label="Companion details" className="border-l border-line bg-paper p-5">
      <p className="font-semibold">{agent.name}</p>
      <button onClick={onClose}>Close</button>
    </aside>
  );
}
```

`frontend/src/components/app/CompanionForm.tsx` (temporary):

```tsx
"use client";
import type { Agent } from "@/lib/types";
export function CompanionForm({ onClose }: { agent: Agent | null; onClose: () => void; onSaved: (id: string) => void }) {
  return <button onClick={onClose}>Close</button>;
}
```

- [ ] **Step 1: Write `frontend/src/components/app/CompanionAvatar.tsx`**

```tsx
import type { Appearance } from "@/lib/types";

const INK = "#0b0d10";
const GLOW = "#a6ff00";
const EDGE = "rgb(11 13 16 / 0.2)";
const TOP = { square: -22, round: -24, tall: -26 } as const;

function Eyes({ eyes }: { eyes: Appearance["eyes"] }) {
  if (eyes === "visor") return <rect x={-11} y={-4} width={22} height={4} rx={2} fill={GLOW} />;
  if (eyes === "wide") {
    return (
      <g>
        <circle cx={-7} cy={-2} r={4.5} fill="#fff" />
        <circle cx={7} cy={-2} r={4.5} fill="#fff" />
        <circle cx={-6} cy={-2} r={2} fill={INK} />
        <circle cx={8} cy={-2} r={2} fill={INK} />
      </g>
    );
  }
  return (
    <g>
      <circle cx={-7} cy={-2} r={2.6} fill={GLOW} />
      <circle cx={7} cy={-2} r={2.6} fill={GLOW} />
    </g>
  );
}

function Accessory({ kind, top }: { kind: Appearance["accessory"]; top: number }) {
  if (kind === "antenna") {
    return (
      <g>
        <line x1={0} y1={top} x2={0} y2={top - 9} stroke={INK} strokeWidth={2} />
        <circle cy={top - 12} r={3.5} fill={GLOW} stroke={INK} strokeWidth={1.5} />
      </g>
    );
  }
  if (kind === "headset") {
    return (
      <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round">
        <path d={`M -25 -2 A 25 25 0 0 1 25 -2`} />
        <rect x={-29} y={-8} width={6} height={13} rx={2} fill={INK} />
        <rect x={23} y={-8} width={6} height={13} rx={2} fill={INK} />
        <path d="M -26 5 Q -24 15 -11 15" strokeWidth={2} />
      </g>
    );
  }
  if (kind === "cap") {
    return (
      <g fill={INK}>
        <path d={`M -20 ${top + 7} Q 0 ${top - 13} 20 ${top + 7} Z`} />
        <rect x={0} y={top + 3} width={28} height={5} rx={2} />
      </g>
    );
  }
  return null;
}

/** Original companion character, drawn around (0, 0) in roughly a 64-unit box. Pure SVG. */
export function CompanionFigure({ look }: { look: Appearance }) {
  const shape = { fill: look.color, stroke: EDGE, strokeWidth: 1.5 };
  if (look.style === "orb") {
    return (
      <g>
        <circle r={24} {...shape} />
        <rect x={-16} y={-9} width={32} height={14} rx={7} fill={INK} />
        <Eyes eyes={look.eyes} />
      </g>
    );
  }
  return (
    <g>
      <rect x={-13} y={18} width={26} height={12} rx={5} {...shape} />
      {look.head === "round" ? (
        <circle r={24} {...shape} />
      ) : look.head === "tall" ? (
        <rect x={-20} y={-26} width={40} height={46} rx={14} {...shape} />
      ) : (
        <rect x={-24} y={-22} width={48} height={40} rx={10} {...shape} />
      )}
      <rect x={-16} y={-9} width={32} height={14} rx={7} fill={INK} />
      <Eyes eyes={look.eyes} />
      <Accessory kind={look.accessory} top={TOP[look.head]} />
    </g>
  );
}

export function CompanionAvatar({ look, size = 64, label }: { look: Appearance; size?: number; label?: string }) {
  return (
    <svg viewBox="-36 -42 72 78" width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <CompanionFigure look={look} />
    </svg>
  );
}
```

- [ ] **Step 2: Write `frontend/src/components/app/office/OfficeScene.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { ArrowsOut, Minus, Plus } from "@phosphor-icons/react";
import { statusLabel, UNASSIGNED, type Agent, type Snapshot } from "@/lib/types";
import { CompanionFigure } from "../CompanionAvatar";

export type SceneHandle = { centerOn: (agentId: string) => void };
type View = { x: number; y: number; k: number };
type Gesture =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "pinch"; dist: number; view: View; cx: number; cy: number }
  | { kind: "drag"; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean }
  | { kind: "tap"; id: string };

const TABLE_W = 300;
const TABLE_H = 240;
const clamp = (k: number) => Math.min(2.5, Math.max(0.3, k));
const zoomAt = (v: View, k: number, cx: number, cy: number): View => {
  const nk = clamp(k);
  return { k: nk, x: cx - (cx - v.x) * (nk / v.k), y: cy - (cy - v.y) * (nk / v.k) };
};

export function OfficeScene({
  ref,
  snapshot,
  selectedId,
  highlightId,
  deptFilter,
  editable,
  onSelect,
  onMoveDesk,
}: {
  ref?: Ref<SceneHandle>;
  snapshot: Snapshot;
  selectedId: string | null;
  highlightId: string | null;
  deptFilter: string | null;
  editable: boolean;
  onSelect: (id: string) => void;
  onMoveDesk: (agentId: string, pos: { x: number; y: number }) => void;
}) {
  const { layout, agents, departments } = snapshot;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fitted = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 0.7 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const bounds = useMemo(() => {
    const maxX = Math.max(0, ...layout.zones.map((z) => z.x + z.w));
    const maxY = Math.max(TABLE_H, ...layout.zones.map((z) => z.y + z.h));
    return { w: maxX + 60 + TABLE_W, h: maxY, tableX: maxX + 60 };
  }, [layout.zones]);

  const fitView = useCallback((): View => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return view;
    const k = clamp(Math.min((r.width - 48) / bounds.w, (r.height - 48) / bounds.h));
    return { k, x: (r.width - bounds.w * k) / 2, y: (r.height - bounds.h * k) / 2 };
  }, [bounds, view]);

  // Fit once when the svg first mounts (callback ref, so no setState-in-effect).
  const attach = useCallback(
    (el: SVGSVGElement | null) => {
      svgRef.current = el;
      if (el && !fitted.current) {
        fitted.current = true;
        requestAnimationFrame(() => setView(fitView()));
      }
    },
    [fitView],
  );

  useImperativeHandle(ref, () => ({
    centerOn(agentId) {
      const d = layout.desks[agentId];
      const r = svgRef.current?.getBoundingClientRect();
      if (!d || !r) return;
      setView((v) => ({ k: v.k, x: r.width / 2 - d.x * v.k, y: r.height / 2 - d.y * v.k }));
    },
  }));

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toScene = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };

  function onBackgroundDown(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = e.currentTarget.getBoundingClientRect();
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), view, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top };
    } else {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, view };
    }
  }

  function onCompanionDown(e: React.PointerEvent, a: Agent) {
    e.stopPropagation();
    if (!editable) {
      gesture.current = { kind: "tap", id: a.id };
      return;
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = toScene(e.clientX, e.clientY);
    const d = layout.desks[a.id];
    gesture.current = { kind: "drag", id: a.id, dx: p.x - d.x, dy: p.y - d.y, sx: e.clientX, sy: e.clientY, moved: false };
  }

  function onMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.kind === "pan") setView({ ...g.view, x: g.view.x + e.clientX - g.sx, y: g.view.y + e.clientY - g.sy });
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setView(zoomAt(g.view, (g.view.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist, g.cx, g.cy));
    }
    if (g.kind === "drag") {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
      if (g.moved) {
        const p = toScene(e.clientX, e.clientY);
        setDrag({ id: g.id, x: Math.round(p.x - g.dx), y: Math.round(p.y - g.dy) });
      }
    }
  }

  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "tap") onSelect(g.id);
    if (g?.kind === "drag") {
      if (g.moved && drag) onMoveDesk(g.id, { x: drag.x, y: drag.y });
      else onSelect(g.id);
      setDrag(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    const step = 60;
    const r = e.currentTarget.getBoundingClientRect();
    const moves: Record<string, () => View> = {
      ArrowLeft: () => ({ ...view, x: view.x + step }),
      ArrowRight: () => ({ ...view, x: view.x - step }),
      ArrowUp: () => ({ ...view, y: view.y + step }),
      ArrowDown: () => ({ ...view, y: view.y - step }),
      "+": () => zoomAt(view, view.k * 1.2, r.width / 2, r.height / 2),
      "=": () => zoomAt(view, view.k * 1.2, r.width / 2, r.height / 2),
      "-": () => zoomAt(view, view.k / 1.2, r.width / 2, r.height / 2),
      "0": () => fitView(),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setView(moves[e.key]());
    }
  }

  const zoomButton = (factor: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    setView((v) => zoomAt(v, v.k * factor, r.width / 2, r.height / 2));
  };

  const deptName = (id: string) => (id === UNASSIGNED ? "Unassigned" : (departments.find((d) => d.id === id)?.name ?? "Department"));
  const headDept = agents.find((a) => a.isHead)?.departmentId;
  const placed = agents.filter((a) => a.status !== "archived" && layout.desks[a.id]);

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden bg-bg">
      <svg
        ref={attach}
        tabIndex={0}
        role="application"
        aria-label="Office map. Arrow keys pan, plus and minus zoom, 0 fits the team. Tab moves between companions."
        className="h-full w-full touch-none select-none focus-visible:outline-2"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKeyDown}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.zones.map((z) => (
            <g key={z.departmentId} opacity={deptFilter && deptFilter !== z.departmentId ? 0.3 : 1}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={18} fill="var(--paper)" stroke="var(--line)" strokeWidth={2} />
              <text x={z.x + 22} y={z.y + 38} className="fill-ink" style={{ fontSize: 18, fontWeight: 600 }}>
                {deptName(z.departmentId)}
                {z.departmentId === headDept ? " (head office)" : ""}
              </text>
            </g>
          ))}

          <g transform={`translate(${bounds.tableX} 0)`}>
            <rect width={TABLE_W} height={TABLE_H} rx={18} fill="var(--paper)" stroke="var(--line)" strokeWidth={2} />
            <text x={22} y={38} className="fill-ink" style={{ fontSize: 18, fontWeight: 600 }}>Meeting table</text>
            <ellipse cx={150} cy={130} rx={90} ry={46} fill="var(--bg)" stroke="var(--line)" strokeWidth={2} />
            {[60, 120, 180, 240].map((cx) => (
              <circle key={cx} cx={cx} cy={cx % 120 === 0 ? 70 : 190} r={10} fill="var(--line)" />
            ))}
            <text x={150} y={222} textAnchor="middle" className="fill-muted" style={{ fontSize: 14 }}>No meetings yet</text>
          </g>

          {placed.map((a) => {
            const pos = drag?.id === a.id ? drag : layout.desks[a.id];
            const dimmed = deptFilter && deptFilter !== (a.departmentId ?? UNASSIGNED);
            const label = `${a.name}, ${a.role}, ${statusLabel(a)}`;
            return (
              <g
                key={a.id}
                transform={`translate(${pos.x} ${pos.y})`}
                opacity={dimmed ? 0.3 : a.status === "paused" ? 0.6 : 1}
                tabIndex={0}
                role="button"
                aria-label={label}
                aria-pressed={selectedId === a.id}
                className="cursor-pointer outline-none [&:focus-visible>circle.ring]:opacity-100"
                onPointerDown={(e) => onCompanionDown(e, a)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(a.id);
                  }
                }}
              >
                <circle
                  className="ring"
                  r={38}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={3}
                  strokeDasharray={highlightId === a.id && selectedId !== a.id ? "6 6" : undefined}
                  opacity={selectedId === a.id || highlightId === a.id ? 1 : 0}
                />
                <rect x={-46} y={26} width={92} height={14} rx={4} fill="var(--line)" />
                <g className="bob">
                  <CompanionFigure look={a.appearance} />
                </g>
                <text y={62} textAnchor="middle" className="fill-ink" style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</text>
                <text y={80} textAnchor="middle" className="fill-muted" style={{ fontSize: 12 }}>
                  {a.kind === "human" ? "Human, " : ""}
                  {statusLabel(a)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-4 right-4 flex flex-col gap-1 rounded-[12px] border border-line bg-paper p-1 shadow-sm">
        <button aria-label="Zoom in" onClick={() => zoomButton(1.2)} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><Plus size={16} /></button>
        <button aria-label="Zoom out" onClick={() => zoomButton(1 / 1.2)} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><Minus size={16} /></button>
        <button aria-label="Fit to team" onClick={() => setView(fitView())} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><ArrowsOut size={16} /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `frontend/src/components/app/office/OfficeList.tsx`**

```tsx
"use client";

import { statusLabel, type Snapshot } from "@/lib/types";
import { CompanionAvatar } from "../CompanionAvatar";

export function OfficeList({ snapshot, showArchived, selectedId, onSelect }: { snapshot: Snapshot; showArchived: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const dept = (id: string | null) => snapshot.departments.find((d) => d.id === id)?.name ?? "Unassigned";
  const name = (id: string | null) => snapshot.agents.find((a) => a.id === id)?.name ?? "No manager";
  const rows = snapshot.agents.filter((a) => showArchived || a.status !== "archived");
  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Companions</caption>
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="p-3">Name</th>
            <th className="p-3">Role</th>
            <th className="p-3">Department</th>
            <th className="p-3">Manager</th>
            <th className="p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className={`border-t border-line ${selectedId === a.id ? "bg-paper" : ""}`}>
              <td className="p-3">
                <button onClick={() => onSelect(a.id)} className="flex items-center gap-3 font-medium hover:underline">
                  <CompanionAvatar look={a.appearance} size={32} />
                  {a.name}
                  {a.kind === "human" && <span className="rounded-[4px] border border-line px-1.5 text-xs text-muted">Human</span>}
                </button>
              </td>
              <td className="p-3">{a.role}</td>
              <td className="p-3">{dept(a.departmentId)}</td>
              <td className="p-3">{a.isHead ? "You" : name(a.managerId)}</td>
              <td className="p-3">{statusLabel(a)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-6 text-center text-muted">No companions yet. Use New companion to hire one.</p>}
    </div>
  );
}
```

- [ ] **Step 4: Write `frontend/src/components/app/office/Office.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { MagnifyingGlass, PaperPlaneTilt, Plus } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { canEdit, type Snapshot } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionForm } from "../CompanionForm";
import { CompanionPanel } from "../CompanionPanel";
import { OfficeList } from "./OfficeList";
import { OfficeScene, type SceneHandle } from "./OfficeScene";

export function Office() {
  const { snapshot, setSnapshot, reload, wsPath } = useWorkspace();
  const scene = useRef<SceneHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"office" | "list">("office");
  const [query, setQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [error, setError] = useState("");

  const editable = canEdit(snapshot.role);
  const q = query.trim().toLowerCase();
  const match = q ? snapshot.agents.find((a) => a.status !== "archived" && (a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q))) : undefined;
  const selected = snapshot.agents.find((a) => a.id === selectedId) ?? null;

  async function moveDesk(agentId: string, pos: { x: number; y: number }) {
    const before = snapshot;
    const next: Snapshot = { ...snapshot, layout: { ...snapshot.layout, desks: { ...snapshot.layout.desks, [agentId]: pos } } };
    setSnapshot(next);
    try {
      await api(wsPath("/layout"), { method: "PUT", body: next.layout });
      setError("");
    } catch (e) {
      setSnapshot(before);
      setError(`Couldn't save the new desk position. ${(e as Error).message}`);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-3">
        <h1 className="mr-auto text-lg font-semibold">Live Office</h1>
        <label className="relative">
          <span className="sr-only">Search companions</span>
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && match) {
                setSelectedId(match.id);
                scene.current?.centerOn(match.id);
              }
            }}
            placeholder="Search name or role"
            className="w-48 rounded-[10px] border border-line bg-bg py-2 pl-9 pr-3 text-sm focus:border-ink focus:outline-none"
          />
        </label>
        <label>
          <span className="sr-only">Filter by department</span>
          <select value={deptFilter ?? ""} onChange={(e) => setDeptFilter(e.target.value || null)} className="rounded-[10px] border border-line bg-bg px-3 py-2 text-sm">
            <option value="">All departments</option>
            {snapshot.departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="View" className="flex rounded-[10px] border border-line p-0.5">
          {(["office", "list"] as const).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-[8px] px-3 py-1.5 text-sm capitalize ${mode === m ? "bg-ink text-paper" : ""}`}>
              {m === "office" ? "Office" : "List"}
            </button>
          ))}
        </div>
        {mode === "list" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
        )}
        {editable && (
          <button onClick={() => setEditing("new")} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold text-paper">
            <Plus size={14} weight="bold" /> New companion
          </button>
        )}
      </div>

      {error && <p role="alert" className="bg-[#fde8e6] px-4 py-2 text-sm text-[#7a1b12]">{error}</p>}
      {q && !match && <p className="px-4 py-2 text-sm text-muted">No companion matches &quot;{query}&quot;.</p>}

      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {mode === "office" ? (
            <OfficeScene
              ref={scene}
              snapshot={snapshot}
              selectedId={selectedId}
              highlightId={match?.id ?? null}
              deptFilter={deptFilter}
              editable={editable}
              onSelect={setSelectedId}
              onMoveDesk={moveDesk}
            />
          ) : (
            <OfficeList snapshot={snapshot} showArchived={showArchived} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
        {selected && (
          <div className="fixed inset-x-0 bottom-0 z-20 max-h-[70dvh] overflow-auto rounded-t-[16px] shadow-2xl lg:static lg:max-h-none lg:w-80 lg:rounded-none lg:shadow-none">
            <CompanionPanel agent={selected} onClose={() => setSelectedId(null)} onEdit={() => setEditing(selected.id)} onSelect={setSelectedId} />
          </div>
        )}
      </div>

      <div className="border-t border-line bg-paper p-3">
        <div className="flex items-center gap-3 rounded-full border border-line bg-bg py-2 pl-5 pr-2 opacity-70">
          <label htmlFor="command" className="sr-only">Tell your company what to do</label>
          <input id="command" disabled placeholder="Tell your company what to do" aria-describedby="command-help" className="min-w-0 flex-1 bg-transparent text-sm" />
          <span className="grid size-9 place-items-center rounded-full bg-ink text-lime" aria-hidden="true"><PaperPlaneTilt size={15} weight="fill" /></span>
        </div>
        <p id="command-help" className="mt-1.5 px-5 text-xs text-muted">Connect an AI provider to give your company goals. Coming in milestone 2.</p>
      </div>

      {editing && (
        <CompanionForm
          agent={editing === "new" ? null : (snapshot.agents.find((a) => a.id === editing) ?? null)}
          onClose={() => setEditing(null)}
          onSaved={async (id) => {
            setEditing(null);
            await reload();
            setSelectedId(id);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Replace `frontend/src/app/w/[slug]/page.tsx`**

```tsx
import { Office } from "@/components/app/office/Office";

export default function OfficePage() {
  return <Office />;
}
```

- [ ] **Step 6: Verify in the browser**

With both servers running, open your workspace. Check: 5 companions at desks in labeled zones plus the meeting table; wheel and buttons zoom; dragging the background pans; dragging a companion moves it and the position survives refresh; clicking a companion opens the temporary panel; Tab focuses companions and Enter opens them; search "design" outlines Lina and Enter centers her; department filter dims other zones; List view shows the same five; turning on reduced motion in the OS stops the bob.

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): original companion character and the Live Office scene and list"
```

---

### Task 9: Companion panel, customize form, organization, settings

**Files:**
- Replace: `frontend/src/components/app/CompanionPanel.tsx`, `frontend/src/components/app/CompanionForm.tsx`
- Create: `frontend/src/app/w/[slug]/organization/page.tsx`, `frontend/src/app/w/[slug]/settings/page.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `api`, `canEdit`, `canAdmin`, `statusLabel`, `CompanionAvatar`, `Agent`, `Appearance`.
- Produces: `CompanionPanel({ agent, onClose, onEdit, onSelect })`, `CompanionForm({ agent, onClose, onSaved })`.

- [ ] **Step 1: Write `frontend/src/components/app/CompanionPanel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Archive, Copy, Pause, PencilSimple, Play, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { canEdit, statusLabel, type Agent } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "./CompanionAvatar";

export function CompanionPanel({ agent, onClose, onEdit, onSelect }: { agent: Agent; onClose: () => void; onEdit: () => void; onSelect: (id: string) => void }) {
  const { snapshot, reload, wsPath } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = canEdit(snapshot.role);
  const dept = snapshot.departments.find((d) => d.id === agent.departmentId)?.name ?? "Unassigned";
  const manager = agent.isHead ? "You (the owner)" : (snapshot.agents.find((a) => a.id === agent.managerId)?.name ?? "No manager");

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
  const setStatus = (status: Agent["status"]) => run(() => api(wsPath(`/agents/${agent.id}`), { method: "PATCH", body: { status } }));

  return (
    <aside aria-label="Companion details" className="h-full border-l border-line bg-paper p-5">
      <div className="flex items-start justify-between">
        <CompanionAvatar look={agent.appearance} size={72} />
        <button aria-label="Close details" onClick={onClose} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><X size={18} /></button>
      </div>
      <h2 className="mt-3 text-xl font-semibold">{agent.name}</h2>
      <p className="text-sm text-muted">
        {agent.role}
        {agent.kind === "human" ? " (human collaborator)" : ""}
      </p>
      <dl className="mt-5 space-y-3 text-sm">
        {[
          ["Status", statusLabel(agent)],
          ["Department", dept],
          ["Reports to", manager],
          ["AI provider", "Not connected yet"],
          ["Working style", agent.workingStyle || "Not set"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-muted">{k}</dt>
            <dd className="mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
      {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
      {editable && (
        <div className="mt-6 grid gap-2">
          <button disabled={busy} onClick={onEdit} className="btn-dark flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold text-paper">
            <PencilSimple size={16} /> Customize
          </button>
          {agent.status !== "archived" && (
            <button disabled={busy} onClick={() => setStatus(agent.status === "paused" ? "active" : "paused")} className="btn-light flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold">
              {agent.status === "paused" ? <><Play size={16} /> Resume</> : <><Pause size={16} /> Pause</>}
            </button>
          )}
          {agent.status === "archived" && (
            <button disabled={busy} onClick={() => setStatus("active")} className="btn-light rounded-[10px] py-2.5 text-sm font-semibold">Restore</button>
          )}
          <button
            disabled={busy}
            onClick={() => run(async () => onSelect((await api<{ id: string }>(wsPath(`/agents/${agent.id}/clone`), { method: "POST" })).id))}
            className="btn-light flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold"
          >
            <Copy size={16} /> Clone
          </button>
          {!agent.isHead && agent.status !== "archived" && (
            <button
              disabled={busy}
              onClick={() => confirm(`Archive ${agent.name}? Their history is kept and you can restore them from the list view.`) && setStatus("archived")}
              className="flex items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-semibold text-[#b42318] hover:bg-bg"
            >
              <Archive size={16} /> Archive
            </button>
          )}
        </div>
      )}
      <p className="mt-6 text-xs text-muted">Pause and archive are saved now. They will stop real work once companions can work (milestone 3).</p>
    </aside>
  );
}
```

- [ ] **Step 2: Write `frontend/src/components/app/CompanionForm.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Agent, Appearance } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "./CompanionAvatar";

const SWATCHES = ["#a6ff00", "#e4e4e7", "#a1a1aa", "#71717a", "#3f3f46", "#ff7a00", "#5b8def", "#e5484d"];
const field = "mt-1.5 w-full rounded-[10px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";

/** Everyone who reports to `id`, directly or indirectly, plus `id` itself. */
function selfAndReports(agents: Agent[], id: string) {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of agents) if (a.managerId && out.has(a.managerId) && !out.has(a.id)) (out.add(a.id), (grew = true));
  }
  return out;
}

export function CompanionForm({ agent, onClose, onSaved }: { agent: Agent | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const head = snapshot.agents.find((a) => a.isHead);
  const [form, setForm] = useState(() => ({
    name: agent?.name ?? "",
    role: agent?.role ?? "",
    kind: agent?.kind ?? ("ai" as Agent["kind"]),
    workingStyle: agent?.workingStyle ?? "",
    departmentId: agent?.departmentId ?? snapshot.departments[0]?.id ?? "",
    managerId: agent ? (agent.managerId ?? "") : (head?.id ?? ""),
    appearance: agent?.appearance ?? ({ style: "robot", color: "#a1a1aa", head: "square", eyes: "dots", accessory: "none" } as Appearance),
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const look = <K extends keyof Appearance>(k: K, v: Appearance[K]) => setForm((f) => ({ ...f, appearance: { ...f.appearance, [k]: v } }));
  const blocked = agent ? selfAndReports(snapshot.agents, agent.id) : new Set<string>();
  const managers = snapshot.agents.filter((a) => a.status === "active" && !blocked.has(a.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = { ...form, departmentId: form.departmentId || null, managerId: agent?.isHead ? null : form.managerId || null };
    try {
      const id = agent
        ? (await api<{ id: string }>(wsPath(`/agents/${agent.id}`), { method: "PATCH", body })).id
        : (await api<{ id: string }>(wsPath("/agents"), { method: "POST", body })).id;
      onSaved(id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const choice = <K extends "style" | "head" | "eyes" | "accessory">(k: K, label: string, options: Appearance[K][]) => (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-muted">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o} className="cursor-pointer rounded-[8px] border border-line px-2.5 py-1 text-sm capitalize has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper">
            <input type="radio" name={k} value={o} checked={form.appearance[k] === o} onChange={() => look(k, o)} className="sr-only" />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="companion-form-title" className="m-auto w-[min(860px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-0 text-ink backdrop:bg-black/40">
      <form onSubmit={submit} className="grid gap-6 p-6 md:grid-cols-[240px_1fr]">
        <div className="grid place-items-center rounded-[14px] bg-bg p-6">
          <CompanionAvatar look={form.appearance} size={160} label={`Preview of ${form.name || "new companion"}`} />
          <p className="mt-3 text-center font-semibold">{form.name || "New companion"}</p>
          <p className="text-center text-sm text-muted">{form.role || "Role"}</p>
        </div>
        <div className="space-y-4">
          <h2 id="companion-form-title" className="text-xl font-semibold">{agent ? `Customize ${agent.name}` : "New companion"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Name<input required maxLength={60} value={form.name} onChange={(e) => set("name", e.target.value)} className={field} /></label>
            <label className="text-sm font-medium">Role<input required maxLength={60} value={form.role} onChange={(e) => set("role", e.target.value)} className={field} /></label>
            <label className="text-sm font-medium">
              Department
              <select value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)} className={field}>
                <option value="">Unassigned</option>
                {snapshot.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Reports to
              <select value={form.managerId} disabled={agent?.isHead} onChange={(e) => set("managerId", e.target.value)} className={field}>
                {agent?.isHead ? <option value="">You (the owner)</option> : <option value="">No manager</option>}
                {!agent?.isHead && managers.map((m) => <option key={m.id} value={m.id}>{m.name}, {m.role}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Type
              <select value={form.kind} onChange={(e) => set("kind", e.target.value as Agent["kind"])} className={field}>
                <option value="ai">AI companion</option>
                <option value="human">Human collaborator</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Color
              <input type="color" value={form.appearance.color} onChange={(e) => look("color", e.target.value)} className="mt-1.5 h-10 w-full cursor-pointer rounded-[10px] border border-line bg-paper" />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Color presets">
            {SWATCHES.map((c) => (
              <button type="button" key={c} aria-label={`Use color ${c}`} onClick={() => look("color", c)} className="size-7 rounded-full border border-line" style={{ background: c }} />
            ))}
          </div>
          <label className="block text-sm font-medium">
            Working style
            <textarea maxLength={500} rows={2} value={form.workingStyle} onChange={(e) => set("workingStyle", e.target.value)} className={`${field} resize-none`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {choice("style", "Style", ["robot", "orb"])}
            {choice("head", "Head", ["square", "round", "tall"])}
            {choice("eyes", "Eyes", ["dots", "visor", "wide"])}
            {choice("accessory", "Accessory", ["none", "antenna", "headset", "cap"])}
          </div>
          {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => dialog.current?.close()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={busy} className="btn-dark rounded-[10px] px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-70">{busy ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 3: Write `frontend/src/app/w/[slug]/organization/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { canAdmin, statusLabel, type Agent } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "@/components/app/CompanionAvatar";

function Tree({ agents, managerId }: { agents: Agent[]; managerId: string }) {
  const reports = agents.filter((a) => a.managerId === managerId && a.status !== "archived");
  if (!reports.length) return null;
  return (
    <ul className="ml-5 border-l border-line pl-4">
      {reports.map((a) => (
        <li key={a.id} className="py-1.5">
          <span className="flex items-center gap-2 text-sm">
            <CompanionAvatar look={a.appearance} size={28} /> <span className="font-medium">{a.name}</span> <span className="text-muted">{a.role}, {statusLabel(a)}</span>
          </span>
          <Tree agents={agents} managerId={a.id} />
        </li>
      ))}
    </ul>
  );
}

export default function Organization() {
  const { snapshot, reload, wsPath } = useWorkspace();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = canAdmin(snapshot.role);
  const depts = snapshot.departments;
  const head = snapshot.agents.find((a) => a.isHead);
  const loose = snapshot.agents.filter((a) => !a.isHead && !a.managerId && a.status !== "archived");

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

  // Swap sort orders with the neighbour; indexes are unique per workspace in practice.
  const move = (i: number, dir: -1 | 1) =>
    run(async () => {
      const a = depts[i];
      const b = depts[i + dir];
      await api(wsPath(`/departments/${a.id}`), { method: "PATCH", body: { sortOrder: b.sortOrder } });
      await api(wsPath(`/departments/${b.id}`), { method: "PATCH", body: { sortOrder: a.sortOrder } });
    });

  return (
    <main className="grid gap-8 p-6 lg:grid-cols-2">
      <section aria-labelledby="dept-title">
        <h1 id="dept-title" className="text-2xl font-semibold">Departments</h1>
        {!admin && <p className="mt-1 text-sm text-muted">Only owners and admins can change departments.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-[#b42318]">{error}</p>}
        <ul className="mt-4 space-y-2">
          {depts.map((d, i) => (
            <li key={d.id} className="flex items-center gap-2 rounded-[12px] border border-line bg-paper p-2">
              <form
                className="flex flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get("name");
                  run(() => api(wsPath(`/departments/${d.id}`), { method: "PATCH", body: { name } }));
                }}
              >
                <label className="sr-only" htmlFor={`dept-${d.id}`}>Department name</label>
                <input id={`dept-${d.id}`} name="name" defaultValue={d.name} disabled={!admin} maxLength={60} className="min-w-0 flex-1 rounded-[8px] bg-transparent px-2 py-1.5 focus:bg-bg focus:outline-none" />
                {admin && <button disabled={busy} className="rounded-[8px] px-2 text-sm font-medium hover:bg-bg">Save</button>}
              </form>
              {admin && (
                <>
                  <button aria-label={`Move ${d.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)} className="grid size-8 place-items-center rounded-[8px] hover:bg-bg disabled:opacity-30"><ArrowUp size={14} /></button>
                  <button aria-label={`Move ${d.name} down`} disabled={busy || i === depts.length - 1} onClick={() => move(i, 1)} className="grid size-8 place-items-center rounded-[8px] hover:bg-bg disabled:opacity-30"><ArrowDown size={14} /></button>
                  <button
                    aria-label={`Delete ${d.name}`}
                    disabled={busy}
                    onClick={() => confirm(`Delete ${d.name}? Its companions stay and become unassigned.`) && run(() => api(wsPath(`/departments/${d.id}`), { method: "DELETE" }))}
                    className="grid size-8 place-items-center rounded-[8px] text-[#b42318] hover:bg-bg"
                  >
                    <Trash size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {depts.length === 0 && <p className="mt-4 text-sm text-muted">No departments yet. Add one below.</p>}
        {admin && (
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = new FormData(form).get("name");
              run(async () => {
                await api(wsPath("/departments"), { method: "POST", body: { name } });
                form.reset();
              });
            }}
          >
            <label className="sr-only" htmlFor="new-dept">New department name</label>
            <input id="new-dept" name="name" required maxLength={60} placeholder="New department" className="flex-1 rounded-[10px] border border-line bg-paper px-3 py-2 text-sm" />
            <button disabled={busy} className="btn-dark rounded-[10px] px-4 text-sm font-semibold text-paper">Add</button>
          </form>
        )}
      </section>

      <section aria-labelledby="tree-title">
        <h2 id="tree-title" className="text-2xl font-semibold">Reporting lines</h2>
        <p className="mt-1 text-sm text-muted">Change who someone reports to from their Customize form in the office.</p>
        <div className="mt-4 rounded-[12px] border border-line bg-paper p-4">
          <p className="text-sm font-medium">You (owner)</p>
          {head && (
            <ul className="ml-5 border-l border-line pl-4">
              <li className="py-1.5">
                <span className="flex items-center gap-2 text-sm">
                  <CompanionAvatar look={head.appearance} size={28} /> <span className="font-medium">{head.name}</span> <span className="text-muted">{head.role}</span>
                </span>
                <Tree agents={snapshot.agents} managerId={head.id} />
              </li>
            </ul>
          )}
          {loose.length > 0 && (
            <>
              <p className="mt-4 text-sm font-medium">No manager yet</p>
              <ul className="ml-5 border-l border-line pl-4">
                {loose.map((a) => (
                  <li key={a.id} className="py-1.5 text-sm">
                    <span className="font-medium">{a.name}</span> <span className="text-muted">{a.role}</span>
                    <Tree agents={snapshot.agents} managerId={a.id} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Write `frontend/src/app/w/[slug]/settings/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { canAdmin, type Preferences } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

export default function Settings() {
  const { snapshot, reload, wsPath } = useWorkspace();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(fn: () => Promise<unknown>, done: string) {
    setMessage("");
    setError("");
    try {
      await fn();
      await reload();
      setMessage(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const setPref = (p: Partial<Preferences>) => save(() => api(wsPath("/preferences"), { method: "PUT", body: { ...snapshot.preferences, ...p } }), "Preferences saved.");

  return (
    <main className="max-w-2xl space-y-10 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p aria-live="polite" className="text-sm">
        {message && <span className="text-ink">{message}</span>}
        {error && <span role="alert" className="text-[#b42318]">{error}</span>}
      </p>

      <section aria-labelledby="ws-title">
        <h2 id="ws-title" className="text-lg font-semibold">Workspace</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name");
            save(() => api(wsPath(), { method: "PATCH", body: { name } }), "Workspace renamed.");
          }}
        >
          <label className="sr-only" htmlFor="ws-name">Workspace name</label>
          <input id="ws-name" name="name" defaultValue={snapshot.workspace.name} disabled={!canAdmin(snapshot.role)} maxLength={60} required className="flex-1 rounded-[10px] border border-line bg-paper px-3 py-2" />
          {canAdmin(snapshot.role) && <button className="btn-dark rounded-[10px] px-4 text-sm font-semibold text-paper">Save</button>}
        </form>
      </section>

      <section aria-labelledby="view-title">
        <h2 id="view-title" className="text-lg font-semibold">Your view</h2>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium">Theme</legend>
          <div className="mt-2 flex gap-2">
            {(["system", "light", "dark"] as const).map((t) => (
              <label key={t} className="cursor-pointer rounded-[10px] border border-line px-3 py-2 text-sm capitalize has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper">
                <input type="radio" name="theme" className="sr-only" checked={snapshot.preferences.theme === t} onChange={() => setPref({ theme: t })} />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={snapshot.preferences.reducedMotion} onChange={(e) => setPref({ reducedMotion: e.target.checked })} />
          Reduce motion (stops companion animation)
        </label>
        <label className="mt-3 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={snapshot.preferences.calmMode} onChange={(e) => setPref({ calmMode: e.target.checked })} />
          Calm mode (no ambient movement or speech bubbles)
        </label>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Verify in the browser**

Check: Customize changes name, color, head, eyes, accessory with live preview, saves, survives refresh; New companion appears at a desk; Clone selects the copy; Pause dims the companion and shows "Paused"; Archive asks to confirm, removes the companion from the office, and List with "Show archived" can Restore; head agent has no Archive button and its manager select is locked; Organization adds, renames, reorders, deletes departments (deleted department's companions show under "Unassigned" in the office); Settings dark theme switches the app, reduced motion stops the bob.

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat(frontend): companion panel and customize form, organization and settings"
```

---

### Task 10: End-to-end test, verification pass, and docs

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/global-setup.ts`, `frontend/e2e/office.spec.ts`
- Modify: `frontend/package.json` (script), `README.md`, root `package.json`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Install Playwright (uses your installed Google Chrome, no browser download)**

Run: `cd frontend && npm i -D @playwright/test@1.63`

- [ ] **Step 2: Write the E2E test**

`frontend/e2e/office.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("sign up, onboard, customize a companion, and it survives refresh", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.dev`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Asha Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("Asha Bakery");
  await page.getByRole("radio", { name: /Starter/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/\/w\/asha-bakery/);
  const companions = page.getByRole("button", { name: /, Idle$/ });
  await expect(companions).toHaveCount(5);

  // Keyboard: focus the head agent and open it with Enter.
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Companion details" });
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Customize" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Nova Prime");
  await dialog.getByLabel("Color", { exact: true }).fill("#ff7a00");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "Nova Prime, Head agent, Idle" })).toBeVisible();

  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("row", { name: /Nova Prime/ })).toBeVisible();
});
```

`frontend/e2e/global-setup.ts`:

```ts
import { execSync } from "node:child_process";

export default function setup() {
  execSync("npm --prefix ../backend run db:reset:test", { stdio: "inherit" });
}
```

`frontend/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", channel: "chrome", trace: "retain-on-failure" },
  webServer: [
    { command: "npm --prefix ../backend run dev:test", url: "http://127.0.0.1:4100/health", reuseExistingServer: false, timeout: 60_000 },
    {
      command: "npx next build && npx next start -p 3100",
      url: "http://localhost:3100",
      env: { BACKEND_URL: "http://127.0.0.1:4100", NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
```

Add to `frontend/package.json` scripts: `"e2e": "playwright test"`.

- [ ] **Step 3: Run the E2E test**

Run: `cd frontend && npm run e2e`
Expected: `1 passed`. If it fails, open the trace with `npx playwright show-trace test-results/**/trace.zip` and fix the cause before continuing.

- [ ] **Step 4: Full verification gates**

Run each, all must exit 0:

```bash
cd backend && npm test && npm run typecheck
cd ../frontend && npm run lint && npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Screenshot check**

With dev servers running and signed in, capture and inspect at 1440x900 and 390x844 (mobile emulation), light and dark theme: office, office with panel open, customize dialog, list view, organization, settings, sign-in, onboarding. Fix overflow, clipped text, unreadable contrast, or unreachable controls. Confirm no horizontal page scroll at 390px.

- [ ] **Step 6: Update `README.md`**

Replace with:

````markdown
# Agent Company

A virtual company of AI companions working in a live office.

- `frontend/` Next.js 16 (port 3000). Proxies `/api/*` to the backend.
- `backend/` Fastify + Better Auth + Prisma 7 on Neon Postgres (port 4000).

## Setup

1. Create a free Neon project and a second database named `test` in it.
2. Copy `.env.example` to `backend/.env` and fill in the values (never commit it).
3. Install and migrate:

```
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run db:migrate
```

Optional: Google sign-in needs a Google Cloud OAuth client with redirect URI
`http://localhost:3000/api/auth/callback/google`, then `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`.

## Run

```
npm run dev:backend
npm run dev:frontend   # http://localhost:3000
```

## Test

```
npm --prefix backend test        # API tests against the Neon "test" database
npm --prefix frontend run e2e    # browser test, uses your installed Google Chrome
```

## Status

Milestone 1 (accounts, workspaces, Live Office shell, companion customization) is built.
Companions do not do work yet: every status is Idle, Paused, or Archived. AI providers arrive in milestone 2.
````

Add to root `package.json` scripts: `"test": "npm --prefix backend test && npm --prefix frontend run e2e"`.

- [ ] **Step 7: Commit**

```bash
git add frontend backend README.md package.json
git commit -m "test: end-to-end office flow; docs for setup, run, and test"
```

---

## Self-Review Notes

- **Spec coverage:** success criteria 1-2 (Tasks 3, 7), 3 (Task 4), 4 (Task 8), 5 (Tasks 5, 9), 6 (Tasks 6, 8), 7 (Tasks 2, 5), 8 (Tasks 4, 5, 6), 9 (Tasks 7-9 `statusLabel`), 10 (Task 10). API table: all routes in Tasks 3-6. Templates: Task 4. Screens: Tasks 7-9. Audit log: Tasks 4-6.
- **Deviation from spec, recorded:** test isolation uses a separate Neon database (spec updated), desks stored as a map (spec updated), Studio has 13 companions (spec updated).
- **Known limits marked in code:** waitlist JSON store, slug race, desk positions reset when their zone moves.
