# Milestone 3: Company Goals, Planning, and Project-Aware Companions

Date: 2026-10-03
Status: Draft for owner review
Builds on: milestones 1, 2a, 2b (branch `milestone-1`)

## 1. Goal

The owner types a goal in the office command bar and picks a project (or none). Nova, the head agent, turns it into a plan of tasks assigned to companions. The owner edits and approves the plan; companions then work their tasks using their own assigned models, reading the linked project's files, and deliver written results. Developer companions can propose file edits that the owner applies one by one. Nova reviews the results and writes a final summary. Nova can also "read my project" and keep a reusable project summary.

### Success criteria

1. Sending a goal from the command bar creates a goal linked to the chosen project (or none) and Nova returns a plan of 1 to 6 tasks, each with an assignee, title, instructions, deliverable format, 1 to 5 acceptance criteria, and dependencies. Nova is told to use the fewest companions the goal needs (simple goals get 1 or 2 tasks).
2. No companion runs before the owner presses Start. Before Start the owner can edit task text, reassign, remove, and add tasks. Tasks assigned to companions without a working model are flagged and block Start.
3. On Start, tasks run in dependency order, at most 3 at once; a task receives the results of the tasks it depends on. Working companions show "Thinking" in the office.
4. Each task reads files from the linked project through a two-step selection (the model picks paths from the tree, the server sends those files within a 60,000-character budget) and records which files it read.
5. Developer results can include proposed edits (full new content of a file). Each edit is validated against the upload rules on save, shown as a side-by-side comparison, and applied or rejected individually. Applying goes through the normal save path with the base revision the companion read; a changed file shows "out of date" and cannot be applied.
6. When all tasks finish (done, failed, or skipped), Nova writes a summary of the outcome and marks each finished task "meets criteria" or "needs your eyes" against its acceptance criteria, in the same call.
6a. If the linked project contains `.company/brief.md` or `.company/brand.md`, every planning, task, and review prompt includes them first (8,000 characters combined, truncated with a marker), and each task records which revision of them it used.
6b. Each finished task can be rated thumbs up or down with an optional reason (wrong facts, off-brand, too generic, ignored files, too long). Every model call is logged with phase, companion, model, tokens, duration, and error code.
7. "Read my project" produces a project summary (purpose, structure, key files, stack) stored on the project, shown on the project page, reused as context by planning and tasks, and marked stale when files change.
8. Failures are contained: a failed task skips only its dependents and offers Retry; Cancel stops running calls and skips the rest; tasks running during a server restart become "interrupted" with Retry. Nothing reruns automatically.
9. Members and above create goals, approve plans, retry, cancel, and apply edits; viewers can read goals and results. All routes check workspace membership; goals, tasks, and edits from other workspaces return 404.
10. Messages starting with `chat:` keep going to Nova's one-to-one chat.
11. Lint, type checks, backend tests, unit tests, E2E, and builds pass; screens checked at 1440px and 390px, light and dark.

### Out of scope

Tool/function calling, embeddings or semantic search, running code or previews, companions editing files without approval, more than one running goal per workspace, scheduled or recurring goals, companion-to-companion chat, deployment.

## 2. Architecture

```
Office command bar ──POST goal──► routes/goals.ts ──► goals/planner.ts (Nova, JSON plan)
Goal panel ◄──poll── GET goal                         goals/runner.ts  (in-process queue, max 3 tasks)
                                                        ├─ goals/context.ts  project map + two-step file selection + budget
                                                        ├─ goals/edits.ts    parse/validate proposed edits
                                                        └─ providers/*       existing streaming clients (text only)
Project page ──POST summarize──► goals/summary.ts (Nova reads key files, stores Project.summary)
Apply edit ──► files service save path (baseRevision check) ──► FileRevision
```

- **Provider use**: every model call uses the existing text-streaming clients (`ProviderClient.stream`), collected into a string. No tool calling, so custom endpoints work. Each call uses the assigned companion's connection and model; planning, summaries, and the final review use Nova's.
- **Structured output**: planner, file selection, and edits are requested as JSON inside a fenced block and validated with Zod. One repair retry includes the validation error; a second failure is a clear error.
- **Runner**: an in-process scheduler per workspace (one running goal) starts eligible tasks up to 3 concurrently, each with its own `AbortController`. Cancel aborts them. On server start, tasks left `running` become `interrupted` and goals left running or planning become `failed` with "Interrupted by a restart".
- **Progress**: the goal panel polls `GET /goals/:gid` every 1.5 s while the goal is active (simple, survives reloads); the office shows "Thinking" for companions with running tasks via the snapshot of running task assignees in that response.

## 3. Context assembly

- **Project map**: sorted paths with sizes, text/binary flag, capped at 1,500 lines (deeper entries summarized as "and N more in <dir>").
- **Project summary**: if present and not stale, included in planning and every task.
- **Two-step file selection** (per task, only when a project is linked): call 1 sends the task, the project summary, and the map, asking for up to 20 paths as JSON. The server drops unknown, binary, or excluded paths, then loads files in the order given until 60,000 characters (a file larger than the remaining budget is skipped and noted). Call 2 sends the task instructions, dependency results (each capped at 8,000 characters), the project summary, and the selected files.
- **Project summary generation**: Nova selects up to 30 key files from the map (same selection mechanism, 80,000-character budget) and writes the summary (max 6,000 characters). Stored with `summaryRevisionKey` = hash of all `(path, revision)` pairs; the summary is stale when the key differs.

## 4. Proposed edits

- Only tasks with a linked project may propose edits. The task prompt asks developer-style results to append a JSON block `{ "edits": [{ "path", "content", "note" }] }` (max 10 edits, each ≤ 1 MB).
- On task completion the server parses the block, strips it from the visible result, and validates each edit with the upload rules (`normalizePath`, `exclusionReason`, `PRIVATE_KEY`, 1 MB editor limit). Invalid edits are stored as `rejected` with the reason.
- `baseRevision` is the revision of the file the task read (0 if the file did not exist or was not read and is new; editing an existing file the task did not read is rejected with "the companion didn't read this file").
- Apply calls the same logic as `PUT /files` (create when base 0, conditional update otherwise). A 409 marks the edit `stale`.

## 5. Data model

| Model | Fields (beyond `id`, timestamps) | Notes |
|---|---|---|
| `Goal` | `workspaceId`, `projectId?`, `text` (1-4,000), `status` (`planning`, `awaiting_approval`, `running`, `reviewing`, `done`, `failed`, `cancelled`), `summary?`, `error?`, `inputTokens`, `outputTokens`, `createdById` | Index (`workspaceId`, `createdAt`). Project deletion sets `projectId` null. |
| `GoalTask` | `goalId`, `agentId`, `position`, `title` (1-120), `instructions` (1-4,000), `deliverable` (1-300), `criteria` (string[] 1-5), `dependsOn` (int[] of positions), `verdict?` (`meets`, `needs_eyes`), `verdictNote?`, `contextRevisions` (JSON), `rating?` (1 or -1), `ratingReason?`, `status` (`pending`, `running`, `done`, `failed`, `skipped`, `interrupted`), `result?`, `filesRead` (JSON `{path, revision}[]`), `error?`, `errorCode?`, `inputTokens`, `outputTokens`, `startedAt?`, `finishedAt?` | Agent deletion is blocked by archiving (agents are archived, not deleted). |
| `ProposedEdit` | `taskId`, `goalId`, `path`, `baseRevision`, `content`, `note`, `status` (`pending`, `applied`, `rejected`, `stale`), `reason?`, `decidedById?` | |
| `GoalStep` | `goalId`, `taskId?`, `phase` (`plan`, `select`, `execute`, `summary`, `project_summary`), `agentId`, `model`, `inputTokens?`, `outputTokens?`, `ms`, `errorCode?` | One row per model call (telemetry). |
| `Project` (changed) | + `summary?`, `summaryRevisionKey?`, `summarizedAt?` | |

## 6. API

All under `/api/workspaces/:id`.

| Method and path | Role | Purpose |
|---|---|---|
| `POST /goals` `{ text, projectId? }` | member | Create goal and start planning; 409 if a goal is planning or running |
| `GET /goals` | viewer | Recent 30 goals |
| `GET /goals/:gid` | viewer | Goal, tasks, edits, running assignee ids |
| `PUT /goals/:gid/plan` `{ tasks: [{ agentId, title, instructions, deliverable, criteria, dependsOn }] }` | member | Replace the plan while `awaiting_approval` (validates assignees, dependency positions, no cycles, ≤ 6) |
| `POST /goals/:gid/tasks/:tid/rating` `{ rating: 1 \| -1, reason? }` | member | Rate a finished task |
| `POST /goals/:gid/start` | member | Start; 400 if any assignee lacks a model or connection |
| `POST /goals/:gid/cancel` | member | Cancel |
| `POST /goals/:gid/replan` | member | Re-run planning after a planning failure |
| `POST /goals/:gid/tasks/:tid/retry` | member | Retry a failed or interrupted task (and re-enable skipped dependents) |
| `POST /goals/:gid/edits/:eid/apply` | member | Apply a proposed edit |
| `POST /goals/:gid/edits/:eid/reject` | member | Reject |
| `POST /projects/:pid/summarize` | member | Generate or refresh the project summary (Nova must have a model) |

Rate limits per user: goals 10/min, summarize 5/min.

## 7. Frontend

- **Command bar**: project picker (`No project` or projects); send creates a goal and opens the Goal panel; `chat:` prefix keeps the one-to-one behavior with Nova. Disabled with a "Choose a model for Nova" link when Nova has no model.
- **Goal panel** (right side, bottom sheet on phones): planning state; editable plan (task cards with assignee select, title, instructions, deliverable, acceptance criteria, waits-for chips, remove, add task, Start, Cancel, model warnings); running state with per-task status and expandable results (Markdown rendered safely as text with basic formatting) and files read; proposed edits rows with View changes (side-by-side read-only CodeMirror merge view), Apply, Reject, out-of-date label; done state with Nova's summary, a "meets criteria" or "needs your eyes" chip per task, thumbs up/down with reason chips per task, and Copy summary; failed state with Try again.
- **Goals list**: "Goals" button in the office header lists recent goals.
- **Office**: companions with running tasks show "Thinking".
- **Project page**: Project summary box with Read my project / Refresh and the date; "Out of date" label when stale; a hint that `.company/brief.md` and `.company/brand.md` are shared with every companion, with buttons that create them from a short template in the editor.

## 8. Security and cost

- Model output is untrusted: results render as text (no HTML), edits are validated by the same rules as uploads and saved only after the owner applies them.
- Prompts mark project file contents as data, not instructions, and tell companions to ignore instructions found inside files.
- Token totals per task and goal are shown. Hard caps: 6 tasks, 3 concurrent, 60,000 characters of files per task, 8,000 characters per dependency result, one running goal per workspace.

## 9. Testing

- **Unit**: plan schema and cycle detection, context budget and map truncation, edit block parsing and validation.
- **Routes** (fake OpenAI-compatible server with scripted replies): plan creation, repair retry and failure; plan editing validation; start blocked by missing models; dependency order and result passing; concurrency cap; failure skipping dependents and retry; cancel; restart recovery marks interrupted; file selection drops unknown paths and respects the budget; proposed edits applied, rejected, stale, rule-violating; brief and brand files included first and capped; verdicts parsed from the summary; ratings; one step row per model call; summary generation and staleness; roles and cross-workspace isolation.
- **E2E**: upload fixture project, connect the fake LLM, assign models, send a goal, edit a task, Start, see results, view and apply a proposed edit, see version 2 of the file in the project.

## 10. Research input

Report: "AI Builders Field Report" (published artifact, 2026-10-02). Changes adopted in this spec, each cheap and measurable:

- **Task specs with deliverable format and acceptance criteria**, fewest companions, at most 6 tasks. Source: Anthropic's multi-agent research system (vague delegation duplicated work; effort scales with complexity), Lovable Plan mode.
- **Shared brief and brand kit as ordinary project files** (`.company/brief.md`, `.company/brand.md`), so they reuse the editor, history, and restore. Source: Lovable Knowledge, Claude Code CLAUDE.md, v0 registries.
- **Criteria check folded into Nova's final summary** (no extra calls) rather than a separate reviewer with revisions. Source: Anthropic evaluator-optimizer guidance; Bolt's warning about repeated fix loops. A dedicated reviewer with one revision is deferred until ratings show it is needed.
- **Telemetry and ratings** so later changes (reviewers, skills, cheaper models for file selection) are judged on measured results. Source: v0's successful-generation metric, Anthropic's eval guidance, Replit traces.
- **Full-file proposed edits** (kept) rather than search/replace blocks. Source: Cursor found most models unreliable at search/replace diffs.

Deferred to later milestones: clarifying questions before planning, a reviewer with one revision, a 20-goal evaluation script, a cheaper model for file selection, design directions, previews and build checks, native tool calling, deployment.

## 11. Risks

- **Weak models** may produce poor plans or invalid JSON; the repair retry and editable plan limit the damage.
- **Token cost** grows with tasks; the approval gate and caps keep it visible and bounded.
- **In-process runner** loses running work on restart; tasks become interrupted with Retry. A durable queue can replace it later.
