# Milestone 1: Foundation, Workspaces, and the Live Office Shell

Date: 2026-10-02
Status: Draft for owner review

## 1. Goal

A person can sign up, create a company (workspace), choose a starting team, and land in the Live Office. The office shows their AI companions at desks inside department areas. They can open any companion, customize it, create, clone, pause, resume, and archive companions, edit departments and reporting lines, and change their view preferences. Everything persists across refresh, and no workspace can read another workspace's data.

### Success criteria

1. Sign up with email and password, sign out, sign back in. Sessions survive a browser restart.
2. "Continue with Google" works when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; when they are not, the button is disabled and says why.
3. Onboarding creates a workspace, departments, companions, and an office layout from the chosen template in one transaction.
4. The Live Office renders every non-archived companion at a desk in its department area, with pan, zoom, fit-to-team, search, department filter, keyboard selection, and a synchronized list view.
5. Customizing a companion (name, role, department, manager, working style, appearance) shows a live preview, saves, and survives refresh.
6. Dragging a companion changes only its desk position, which persists. It never changes department, manager, or any permission.
7. Setting a manager that would create a reporting cycle is rejected by the server with a clear message.
8. A user can never read or change another workspace's records through any API route. Automated tests prove this.
9. Every companion shows the status "Idle" (or "Paused" / "Archived"). Nothing in the UI implies work is happening.
10. Lint, type checks, backend tests, the browser test, and production builds pass. Key screens are checked at 1440px and 390px wide.

### Out of scope (later milestones)

AI provider connections, model calls, tasks, runs, meetings, live event streaming, project import, voice, approvals, usage and budgets, invitations of other members. The data model must not block these, but none of their tables are created now.

## 2. Architecture

```
Browser ──► Next.js (frontend, :3000)
              pages: landing, sign-in, sign-up, onboarding, office, organization, settings
              next.config rewrites /api/*  ──►  Fastify (backend, :4000)
                                                 ├─ Better Auth handler at /api/auth/*
                                                 ├─ JSON API at /api/*  (Zod-validated, session + membership checked)
                                                 └─ Prisma Client ──► Neon Postgres
```

- **Same-origin cookies.** The browser only talks to `localhost:3000`. Next.js rewrites `/api/*` to the backend, so Better Auth's session cookie is first-party. The existing waitlist endpoint moves to `/api/waitlist`.
- **Backend owns all data and rules.** The frontend never talks to the database. Every rule (membership, roles, cycle prevention, workspace scoping) is enforced in backend code.
- **Libraries.** Better Auth 1.7 (email/password plus Google social provider, Prisma adapter), Prisma 7 with the Neon adapter, Zod 4 for request validation, Vitest for backend tests, Playwright for one end-to-end test. Versions are pinned in lockfiles.
- **Configuration.** `backend/.env`: `DATABASE_URL` (Neon, pooled), `DIRECT_URL` (Neon, direct, used by migrations), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`, optional `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. `TEST_DATABASE_URL` points at a second database (named `test`) in the same Neon project. Test scripts refuse to run if it is missing or equals `DATABASE_URL`. The `.env.example` lists every variable without values. Secrets are never logged or sent to the browser.

## 3. Data model

Better Auth owns `user`, `session`, `account`, `verification` (generated through its Prisma adapter). Application tables:

| Model | Fields (beyond `id`, `createdAt`, `updatedAt`) | Notes |
|---|---|---|
| `Workspace` | `name`, `slug` (unique) | Slug derived from name, de-duplicated with a suffix. |
| `Membership` | `workspaceId`, `userId`, `role` (`owner`, `admin`, `member`, `viewer`) | Unique on (`workspaceId`, `userId`). Milestone 1 only creates owners; role checks run on every write anyway. |
| `Department` | `workspaceId`, `name`, `sortOrder` | Unique on (`workspaceId`, `name`). |
| `Agent` | `workspaceId`, `departmentId` (nullable), `managerId` (nullable, self-reference), `name`, `role`, `kind` (`ai`, `human`), `workingStyle` (text, max 500), `status` (`active`, `paused`, `archived`), `isHead` (boolean) | Persistent companion identity. Exactly one active head agent per workspace. Archiving keeps the row. |
| `AgentAppearance` | `agentId` (unique), `style` (`robot`, `orb`), `color` (hex), `head` (`square`, `round`, `tall`), `eyes` (`dots`, `visor`, `wide`), `accessory` (`none`, `antenna`, `headset`, `cap`) | Visual only, one-to-one with `Agent`. |
| `OfficeLayout` | `workspaceId` (unique), `layout` (JSON: department zones `{departmentId, x, y, w, h}` and desks as a map `{ [agentId]: {x, y} }`) | Visual only. Grants no access. |
| `UserPreference` | `userId`, `workspaceId`, `theme` (`system`, `light`, `dark`), `reducedMotion` (boolean), `calmMode` (boolean) | Unique on (`userId`, `workspaceId`). |
| `AuditLog` | `workspaceId`, `actorUserId`, `action`, `targetType`, `targetId`, `data` (JSON) | Written for workspace create, agent create/update/archive/pause/resume, department create/rename/delete, manager change. |

Indexes on every `workspaceId` foreign key. Deleting a department sets its agents' `departmentId` to null; it does not delete agents.

### Server-enforced rules

- **Workspace scoping.** Every route under `/api/workspaces/:workspaceId/...` loads the caller's membership first and returns 404 when there is none (404, not 403, so workspace IDs cannot be probed). All queries include `workspaceId`.
- **Roles.** `viewer` can read only. `member` can edit companions and layout. `owner` and `admin` can also edit departments and workspace settings.
- **No reporting cycles.** On manager change, walk up from the proposed manager; if the walk reaches the agent, reject with 409 "That would make a reporting loop". A manager must be an active agent in the same workspace.
- **Head agent.** The head agent cannot be archived or given a manager. Exactly one exists per workspace.
- **Validation.** Zod schemas on every body and param. Names 1-60 characters, colors must be `#rrggbb`, enum fields checked.

## 4. API (backend)

All routes return JSON. Errors use `{ error: { code, message } }`.

| Method and path | Purpose |
|---|---|
| `GET/POST /api/auth/*` | Better Auth (sign up, sign in, sign out, Google callback, session) |
| `GET /api/auth-config` | Which sign-in methods are enabled (Google on or off) |
| `GET /api/me` | Current user and their workspaces |
| `POST /api/workspaces` | Create workspace from a template: `{ name, template: "starter" \| "studio" \| "head-only" }` |
| `GET /api/workspaces/:id` | Workspace, departments, agents with appearance, layout, caller's role and preferences, in one snapshot |
| `PATCH /api/workspaces/:id` | Rename workspace |
| `POST /api/workspaces/:id/departments` / `PATCH .../:deptId` / `DELETE .../:deptId` | Department management |
| `POST /api/workspaces/:id/agents` | Create companion (with appearance and a desk) |
| `PATCH /api/workspaces/:id/agents/:agentId` | Update profile, manager, department, appearance, or status |
| `POST /api/workspaces/:id/agents/:agentId/clone` | Clone a companion (new identity, copied profile and appearance, name suffixed "copy") |
| `PUT /api/workspaces/:id/layout` | Save desk and zone positions |
| `PUT /api/workspaces/:id/preferences` | Save the caller's view preferences |
| `POST /api/waitlist` | Existing waitlist endpoint, moved under `/api` |

Rate limits: auth routes and waitlist are rate limited per IP; other routes per session.

## 5. Templates

- **Head only:** Leadership department, head agent.
- **Starter (5):** head agent, product manager, full-stack developer, UI/UX designer, content writer across Leadership, Product, Engineering, Design, Content.
- **Studio (13):** the spec's seed company: head agent, product manager, engineering manager, two developers, QA engineer, design manager, UI/UX designer, content/social manager, two scriptwriters, editor, marketing strategist, across Leadership, Product, Engineering, Design, Content, Marketing. Managers are wired: specialists report to their department manager, managers report to the head agent.

Each template assigns distinct appearances (varied head, eyes, accessory, color) and an initial office layout. Templates are plain data in one backend file.

## 6. Frontend

### Routing

- `/` landing (unchanged), `/sign-in`, `/sign-up`.
- `/onboarding` when signed in with no workspace.
- `/w/[slug]` Live Office (default), `/w/[slug]/organization`, `/w/[slug]/settings`.
- Signed-out visits to app routes go to `/sign-in`. A signed-in visit to `/sign-in` goes to the first workspace.

### App shell

Left sidebar (Office, Organization, Settings, workspace name, user menu with sign out), main area, and a collapsible right panel for the selected companion. On screens below 1024px the sidebar becomes a top bar and the companion panel becomes a bottom sheet. Light and dark themes follow the preference (`system` by default). Visual language matches the landing page: grey paper, ink, one lime accent used as a fill, Urbanist and Space Grotesk.

### Live Office

- **Renderer:** one SVG scene in a React client component. No canvas or 3D engine. The scene is drawn from the workspace snapshot; it holds no business state of its own.
- **Scene:** labeled department zones, a desk per companion, a head-agent corner, and one empty meeting table labeled "No meetings yet".
- **Companions:** the original robot (or orb) built from the appearance fields, with the name and role label beneath. A subtle idle bob, disabled under reduced motion or calm mode. Status text reads Idle, Paused, or Archived (archived companions are hidden from the scene and shown in the list view under a filter).
- **Navigation:** drag the background to pan, wheel or pinch to zoom, buttons for zoom in, zoom out, and fit to team. Search by name or role highlights and centers a match. Department filter dims other zones.
- **Selection:** click, tap, or keyboard (Tab moves between companions, Enter opens, Escape closes, arrow keys pan). Selecting opens the companion panel.
- **Desk drag:** dragging a companion moves its desk; release saves the layout through `PUT /layout` (debounced, one request per drop). A failed save reverts the position and shows an error.
- **List view:** a toggle swaps the scene for an accessible table of the same companions (name, role, department, manager, status) with the same selection and panel.
- **Command bar:** pinned at the bottom, disabled, with the text "Connect an AI provider to give your company goals. Coming in milestone 2."

### Companion panel

Name, role, department, manager, working style, status, "AI provider: not connected yet". Actions: Customize, Pause or Resume (saves status), Clone, Archive (with confirm; not available for the head agent). Viewers see the panel read-only.

### Customize and New companion

One form used for both: name, role, department, manager (options exclude choices that would form a cycle; the server still checks), working style, kind (AI or human collaborator, shown with a distinct badge), and appearance controls with a large live preview. Save, cancel, inline field errors from the server.

### Organization

Departments list with add, rename, reorder, delete (with a note that agents become unassigned). A reporting tree from the head agent down, with an "Unassigned" group.

### Settings

Workspace name (owner, admin). Theme, reduced motion, calm mode (per user).

### States

Every data view has loading skeletons, an empty state that says how to fill it, and inline errors with a retry. Every visible control works or is disabled with a reason.

## 7. Testing and verification

- **Backend (Vitest, against `TEST_DATABASE_URL`, database reset per run):** sign up and session; workspace creation from each template; membership 404 for another user's workspace on every route group; role enforcement for viewer; reporting-cycle rejection; head-agent protections; clone; layout save; validation errors; secrets absent from responses.
- **End-to-end (Playwright, Chromium):** sign up, onboard with Starter, see 5 companions in the office, open one, customize its name and color, refresh, confirm the change; switch to list view; keyboard-select a companion.
- **Manual checks with screenshots:** office, panel, customize, organization, settings, sign-in at 1440px and 390px, light and dark, reduced motion.
- **Gates:** `npm run lint`, type checks for both apps, backend tests, the end-to-end test, and production builds all pass before the milestone is called done.

## 8. Setup the owner does

1. Create a free Neon project and copy its pooled and direct connection strings into `backend/.env` (never into chat).
2. Optional: create a Google Cloud OAuth client with redirect URI `http://localhost:3000/api/auth/callback/google` and put its ID and secret into `backend/.env`.
3. Run `npm run db:migrate` once, then `npm run dev:backend` and `npm run dev:frontend`.

## 9. Risks

- **Neon cold starts** can add a second to the first request after idle. Acceptable for development.
- **Tests share the Neon project** through a second database. If that proves flaky, use a Neon branch for tests instead.
- **Prisma 7 driver-adapter setup** differs from older guides; follow current Prisma and Better Auth docs during implementation.
