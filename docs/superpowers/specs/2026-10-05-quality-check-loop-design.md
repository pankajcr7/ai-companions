# Quality: Design Brief, Design Guide, and Check-and-Revise

Date: 2026-10-05
Status: Draft for owner review
Builds on: milestones 3–4b and the companion harness (tools in a loop)

## 1. Goal

Results that match what the owner asked for and don't look like generic "AI slop". Two parts:

- **Prevent:** visual work starts from a written design brief, and every task that makes HTML, CSS, or visual content follows a built-in design guide.
- **Check and revise:** Nova reviews each finished task against the owner's request, the task's acceptance criteria, the brief, and the design guide; if it isn't right, the same companion revises with a concrete fix list, at most twice.

Out of scope: screenshot or vision review (the AI connections send text only; a later milestone), a visual design-system library, per-department playbooks.

## 2. Success criteria

1. **Design brief in the plan.** The plan JSON gains an optional `brief` (string, up to 4,000 characters). Nova's planning instructions ask for it when the goal produces something visual (a website, page, app screen, ad, social post, presentation): audience, feeling, colours, fonts, layout ideas, references, and a "don't" list, in plain words.
   - Stored on the goal (`Goal.brief String?`) when the plan is saved.
   - Shown on the plan card as "Design direction" with the text; the plan editor (Change) lets the owner edit it; `PUT /goals/:gid/plan` accepts `brief` (string or null).
   - On Start: in a goal that creates its project, `.company/brief.md` is saved at once with the brief; in an existing project without `.company/brief.md` it is saved at once; in an existing project that has one, the brief becomes a pending suggested change (`ProposedEdit` on the first task, path `.company/brief.md`) and the tasks of this goal still receive the goal's brief in their prompt.
   - Every task prompt includes the goal's brief (section "DESIGN BRIEF") when there is one, in addition to the existing shared brief/brand context.
2. **Design guide.** One constant `DESIGN_GUIDE` (backend, plain text, under 2,000 characters) added to the task instructions whenever the task has a project or its title/instructions mention a visual deliverable (website, page, landing, design, UI, screen, HTML, CSS, banner, ad, post, slide). Content:
   - Do: real content (no placeholders), one clear visual idea, a deliberate type scale and spacing, mobile-first layout that works at 390px, accessible contrast, consistent components, follow the brief and brand.
   - Don't: generic purple/blue gradients, emoji as icons, "Lorem ipsum" or fake data presented as real, the stock "centered hero + three feature cards" layout by default, buzzwords ("unlock", "elevate", "seamless", "revolutionize"), fake testimonials or logos, unused sections.
3. **Check and revise.** After a task's loop ends successfully (before it is marked done), when the company's quality checks are on:
   - Nova gets one review call: instructions say "review a teammate's finished task"; the prompt has the owner's goal text, the task (title, instructions, deliverable, criteria), the brief, the design guide (when it applied to the task), the task result, and the files this task wrote (full content, capped at 40,000 characters total; then names only).
   - Nova replies with JSON `{"approved": boolean, "fixes": ["specific, actionable fix", ...]}` (1–8 fixes when not approved; parsed with the existing JSON repair retry). A reply that still can't be parsed counts as approved (the task isn't blocked by a broken review).
   - Not approved and fewer than 2 revisions so far: the same companion continues its own loop (same turns, same tools, limit 6 more tool uses) with a user turn `NOVA'S REVIEW — please fix:\n- …` and produces a new final answer, which replaces the task result; then Nova reviews again.
   - After 2 revisions, or when approved, the task is marked done. `GoalTask.review Json` records `{ rounds: number, approved: boolean, fixes: string[][] }` (fixes per round). If the last review still wasn't approved the task's `verdict` becomes `needs_eyes` with note "Nova asked for more changes after 2 rounds."
   - Stop and the task time limit apply throughout (review and revision calls use the task's signal). Review and revision tokens count toward the task.
   - Reviews are logged as `GoalStep` phase `"review"` (new enum value) with the task id.
4. **Revisions in a goal-created project save directly.** `write_file` in a task of a goal that created its project: a path this goal already saved (an applied edit of this goal) is saved again at once using its current revision (recorded as another applied `ProposedEdit`); a path the goal didn't create follows today's rules (suggestion for existing files).
5. **Quality checks setting.** `Workspace.qualityChecks Boolean @default(true)`; Settings › Company has a switch "Check work before it's done (Nova reviews each task and asks for fixes; slower but better results)"; `PATCH /api/workspaces/:id` accepts `qualityChecks` (admins).
6. **Screens.** Task cards (goal card and goal page) show a line under the status: "✓ Checked by Nova" (approved first time), "✓ Checked by Nova · 2 fixes made" (approved after revisions), or "Nova asked for more changes" (not approved after 2 rounds); expanding lists the fixes per round. The plan card shows "Design direction" with the brief (first 4 lines, "Show all").
7. Lint, type checks, backend tests, unit tests, E2E, builds pass.

## 3. Architecture

- `backend/src/goals/quality.ts`: `DESIGN_GUIDE`, `isVisualTask(task)`, `reviewInstructions`, `reviewPrompt(...)`, `Review` schema, `reviewTask(...)` (one Nova call via `completeJson`).
- `runner.ts`: after the loop, `for (rounds = 0; ; rounds++)` review → maybe revise by calling `runLoop` again with the same `turns` (the loop already returns them) plus the review turn; collects `review` JSON; writes it with the task.
- `planner.ts` / `plan.ts`: `brief` in the plan schema; saved to `Goal.brief`. Start route saves `.company/brief.md` per §2.1.
- `prompts.ts`: planning instructions ask for `brief`; task prompt gains "DESIGN BRIEF"; task instructions gain the guide when visual.
- Data (one migration, created on the test database only; the owner runs `npm run db:deploy`): `Goal.brief String?`, `GoalTask.review Json?`, `Workspace.qualityChecks Boolean @default(true)`, `StepPhase` gains `review`.
- Frontend: `PlanEditor` and `GoalCard` plan view show/edit the brief; `TaskCard` and `GoalCard` rows show the review line; `CompanySettings` gets the switch.

## 4. Testing

- **Unit (backend)**: `isVisualTask` keywords; review prompt caps file content at 40,000 characters.
- **Backend (fake LLM)**:
  - Plan with a brief → stored on the goal → on Start of a new-project goal `.company/brief.md` exists with it; existing project with a brief → pending suggestion; task prompts contain "DESIGN BRIEF".
  - Review asks for a fix → the companion revises (its prompt contains "NOVA'S REVIEW") → second review approves → task done, result is the revised one, `review = { rounds: 1, approved: true, fixes: [[...]] }`.
  - Reviewer never approves → exactly 2 revisions → done with verdict `needs_eyes`.
  - Unparseable review → treated as approved.
  - A revision rewriting a file the goal created saves directly (revision 2, applied).
  - Quality checks off → no review call.
  - Stop during a review → task cancelled, nothing more saved.
- **E2E**: a goal whose fake reviewer asks for one fix shows "✓ Checked by Nova · 1 fix made" on the task, and the plan card shows "Design direction".
