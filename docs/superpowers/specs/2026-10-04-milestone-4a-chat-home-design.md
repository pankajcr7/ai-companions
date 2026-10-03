# Milestone 4a: Chat Home, Goals in the Conversation, Stop and Resume

Date: 2026-10-04
Status: Draft for owner review
Builds on: milestones 3, 3b, 3c

## 1. Goal

Make the app simple for non-technical owners. The home screen becomes a full-page conversation with Nova. Questions get answers; requests for work automatically become a plan card in the conversation that the owner starts with one button. The team's progress, a big Stop button, results, files, and previews all appear in the same conversation. Past conversations are listed like ChatGPT's. A stopped goal can be resumed.

Step 2 (milestone 4b, separate spec) replaces the office map and Organization page with a Team page of friendly cards, simplifies the sidebar, and does a plain-language pass.

### Success criteria

1. `/w/[slug]` is the chat home: a history column (conversations, New chat), the conversation, a team strip (avatar, name, dot: yellow working, green free, grey needs setup; "See whole team" links to the office map until 4b), and an input with a "Working on" chip (No project, an existing project, New project). The empty conversation shows Nova's greeting and three example requests that fill the input when clicked.
2. Conversations: each belongs to one user in one workspace, titled from the first message (60 characters), listed newest first; they can be renamed and deleted. Messages stream like companion chat (start, delta, error, done; Stop while Nova types).
3. Nova's conversation prompt includes the team roster, the suggestion rule, and the goals started in this conversation (text, status, Nova's summary, task titles, companions, statuses, results capped at 3,000 characters each, last 3 goals). The last 20 messages (24,000 characters) are sent as history.
4. When Nova's reply contains a suggestion with a goal, the server creates the goal right after saving the reply and starts planning: project from the suggestion's `newProject` or the message's chip, parent goal = the conversation's latest goal, linked to the assistant message. If another goal is active, no goal is created and the message carries `planBlocked: "busy"`; the card then offers Plan it once the other goal ends. Hire-only suggestions never create a goal.
5. Each linked goal renders as a card under its message: plan rows in plain sentences ("Lina will design the page"), Start, Change (opens the existing plan editor), and Cancel; then live rows (Waiting, Working with elapsed minutes, Done, Problem with Try again); expandable results; Nova's summary; suggested changes (Review changes, Apply, Skip); a Files card with Preview, Download ZIP, Open project; and a "Details" link for tokens, criteria, and files read.
6. While any goal in the conversation is planning or running, a bar pinned to the top shows "Team working · N of M done" with a red Stop button, and the input's Send button becomes Stop (stopping Nova's reply if it is typing, otherwise the goal).
7. Stop cancels the goal (existing behavior: running calls aborted, unfinished tasks skipped, finished results kept) and the card says "Stopped. N finished, M not started." Resume (`POST /goals/:gid/resume`) reopens every task that isn't done, sets the goal running, and continues; it follows the one-active-goal rule.
8. Old goals without a conversation open on a full-page goal view (`/w/[slug]/goals/[gid]`, the existing goal panel at full width). The office map moves to `/w/[slug]/office` until 4b.
9. Viewers can read their own conversations but not send; every route checks workspace membership; other users' conversations return 404.
10. Lint, type checks, backend tests, unit tests, E2E, and builds pass; screens checked at 1440px and 390px, light and dark.

### Out of scope

Team page, sidebar and wording changes (4b); sharing conversations between members; voice input; attachments.

## 2. Architecture

- **Data**: `Conversation { id, workspaceId, userId, title, projectId?, createdAt, updatedAt }`; `ChatMessage` gains `conversationId?`, `goalId?`, `planBlocked?`. Conversation messages use `agentId` = the head agent.
- **Routes** (under `/api/workspaces/:id`): `GET/POST /conversations`, `PATCH/DELETE /conversations/:cid`, `GET /conversations/:cid` (messages with `goalId`, `planBlocked`), `POST /conversations/:cid/messages` `{ message, project: { kind: "none" } | { kind: "existing", id } | { kind: "new" } }` (SSE via `streamReply`), `POST /goals/:gid/resume`.
- **Auto-plan**: the backend gets its own `parseSuggestion` (same rules as the frontend `splitSuggestion`); the conversation `save` callback creates the goal (the same code path as `POST /goals`, extracted to `createGoal()`), links it, and fires planning.
- **Frontend**: `ChatHome` (history, strip, conversation, input), `GoalCard` (built from the existing PlanEditor, TaskCard, summary, files and preview pieces), `TeamStrip`, `ConversationList`. Goal state polls `GET /goals/:gid` as today.

## 3. Testing

- **Backend**: conversations create, list, rename, delete, isolation; a message streams and saves; Nova's prompt contains the roster and the conversation's goal results; a suggestion creates a planned goal linked to the message with the chip's project or a new project; busy marks `planBlocked`; hire-only creates nothing; resume reopens unfinished tasks and finishes; resume blocked while another goal is active; viewers can't send.
- **Unit**: backend `parseSuggestion` mirrors the frontend cases.
- **E2E**: on the home screen, ask for work, see the plan card appear, Start, press Stop while a task is working, see "Stopped", Resume, see Done and the summary, ask a follow-up question and get an answer that uses the results. Existing office, chat, goals, and build tests are updated to the new home.
