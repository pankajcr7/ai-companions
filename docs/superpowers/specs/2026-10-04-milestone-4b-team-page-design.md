# Milestone 4b: Team Page, Simpler Navigation, Plain Language

Date: 2026-10-04
Status: Draft for owner review
Builds on: milestone 4a (chat home)

## 1. Goal

A non-technical owner understands their team at a glance and never gets lost. One Team page of friendly cards replaces the office map page and the Organization page (the map stays as an optional view). Each companion has a full page with their profile, recent work, and a chat. The sidebar shrinks to four items, first-run setup becomes a guided two-step card, and on-screen wording drops technical terms.

### Success criteria

1. **Team page** `/w/[slug]/team`:
   - Header: "Your team", "N people · M working now", a **Cards | Office** switch (cards by default; the choice is remembered per device in localStorage, wrapped in try/catch), and **+ Add a teammate** (opens the existing companion form; members and admins only).
   - Cards grouped by department in department order, Nova first as "Team lead", companions without a department under "No department".
   - Each card: avatar, name, role, and a status pill: yellow "Working on: <task title>" (the title of the running task they're on, from the active goal), green "Free", grey "Needs setup" with a **Set up** button that opens their edit form.
   - Card actions: **Chat** (opens their page) and **Give a task** (goes to home with "@<Name> " typed into the message input). Clicking the card opens their page.
   - Archived companions are in a collapsed "Former teammates" section at the bottom.
   - **Office** view: the existing animated map without the command bar; clicking a companion opens their page.
   - **Organize** menu (admins): opens a dialog with the existing department tools (add, rename, reorder, delete) and reporting lines, moved from the Organization page.
2. **Companion page** `/w/[slug]/team/[id]`:
   - Left: big avatar, name, role, "Now working on" (task title linking to its goal: the chat goal card when the goal has a conversation, else the full goal page), "Recent work" (last 5 finished tasks: title, date, link to the goal), **Edit** (existing companion form), **Set up** when they have no AI model.
   - Right: full-height one-to-one chat (the existing companion chat).
   - Under 1024px: profile on top, chat below. **Back to team** link at the top.
   - Unknown id shows "This teammate wasn't found" with a link back to the Team page.
3. **Sidebar**: Home, Team, Projects, Settings, then Sign out. Under 640px it is a bottom bar of four labelled icons.
4. **Settings** `/w/[slug]/settings` has tabs **Company** (today's settings content) and **AI services** (today's providers page content), selected by `?tab=company|ai`.
5. **Redirects**: `/w/[slug]/office` and `/w/[slug]/organization` go to `/w/[slug]/team`; `/w/[slug]/providers` goes to `/w/[slug]/settings?tab=ai`. Every link inside the app points to the new URLs.
6. **First-run setup card** on home, shown until Nova can answer:
   - Step 1 "Connect an AI service": opens the existing add-service dialog in place. ✓ when the company has a connected service.
   - Step 2 "Choose Nova's AI model": opens Nova's edit form. ✓ when Nova has a model on a connected service.
   - Viewers see "Ask the company owner to finish setup" instead of buttons. The card replaces today's "Nova needs an AI model" notice.
7. **Plain language** on app screens (not the landing page; code, API, and database names unchanged):

   | Today | Becomes |
   |---|---|
   | Head agent | Team lead |
   | Idle | Free |
   | Needs reauth / reauth | Sign in again |
   | AI providers, Provider | AI services, AI service |
   | Custom endpoint, Base URL | Other service, Service address |
   | Workspace | Company |
   | Company goal, Goal for the team, Close goal | Team task, Task for the team, Close |
   | Archived | Former teammate |
   | Model (form labels) | AI model |

   Token counts and cost details appear only behind "Details" links (goal page, chat meta already hidden on home).
8. **Backend**: `GET /api/workspaces/:id/agents/:aid/tasks?limit=5` (limit 1–20, default 5) returns the agent's finished (`done`) tasks newest first: `{ tasks: [{ id, title, finishedAt, goalId, goalText, conversationId }] }`. Members of the workspace only; another workspace's agent returns 404.
9. Lint, type checks, backend tests, unit tests, E2E, and builds pass; screens checked at 1440px and 390px, light and dark.

### Out of scope

New team features (hiring templates, playbooks), renaming code/API identifiers, changes to the landing page.

## 2. Architecture

- **Frontend only**, plus one read route.
- New: `app/w/[slug]/team/page.tsx` (TeamPage), `app/w/[slug]/team/[id]/page.tsx` (CompanionPage), `components/app/team/TeamCard.tsx`, `components/app/team/OrganizeDialog.tsx` (moved from the Organization page), `components/app/home/SetupCard.tsx`.
- `office/Office.tsx` loses its command bar, goals list button, and side panels; it becomes the map view used inside TeamPage (selecting a companion navigates to their page). `OfficeList.tsx` is replaced by the cards.
- `CompanionPanel` is replaced by CompanionPage; `CompanionChat` is reused as is.
- Old pages `office`, `organization`, `providers` become `redirect()` stubs; the providers content moves into a component rendered by the Settings AI services tab.
- "Working on": the Team and companion pages fetch `GET /goals`, and if one has status planning, running, or reviewing, fetch `GET /goals/:gid` and poll it every 3 seconds while it stays active; its `running` tasks give each companion's current task title. No backend change.
- Home input prefill: Team's Give a task navigates to `/w/[slug]?ask=@Name%20`; ChatHome reads `ask` once and fills the input.

## 3. Testing

- **Backend**: recent-tasks route returns done tasks newest first, honours limit, excludes other statuses, 404 for another workspace's agent, viewer allowed.
- **E2E** (new `team.spec.ts`): sign up, follow the setup card (connect service, choose Nova's model, card disappears), open Team (cards, "Team lead", "Free"), switch to Office and back, open Nova's page and chat, Give a task lands on home with "@Nova " in the input, Organize: add a department, old `/office`, `/organization`, `/providers` URLs redirect. Existing specs updated for the new navigation and wording.
- **Unit**: status-pill logic (working / free / needs setup) and card grouping.
