# Milestone 3b: Goal Chat, Follow-up Goals, and Rich Messages

Date: 2026-10-03
Status: Draft for owner review
Builds on: milestone 3 (company goals)

## 1. Goal

After a goal's plan is approved, the owner can keep talking to Nova about that goal in the Goal panel, continue the work as a new goal that remembers the previous one, and read every AI message with proper formatting: code blocks become code cards with syntax colors and a Copy button, and messages, results, and summaries can be copied in one click.

### Success criteria

1. The Goal panel shows a chat with Nova for goals in `running`, `reviewing`, `done`, `failed`, or `cancelled` (not while planning or awaiting approval). Replies stream, can be stopped, are saved per goal and per user, and survive reload. Clear chat works.
2. Nova's goal-chat prompt includes the shared brief and brand, the goal text, Nova's summary, each task's title, companion, status, verdict, and result (each capped at 6,000 characters), the proposed edits (path, status, note), and the fresh project summary when a project is linked. The last 20 messages (24,000 characters) are sent as history.
3. "Continue with a new goal" creates a goal with `parentGoalId` set and the same project; its planning prompt includes a PREVIOUS GOAL section with the earlier goal's text, summary, and task results (each capped at 3,000 characters). The Goal panel shows "Continues: <earlier goal>" and opens the earlier goal on click.
4. Companion chat, goal chat, task results, and Nova's summary render Markdown (headings, lists, tables, emphasis, links, inline code, fenced code). Raw HTML is never rendered. Links open in a new tab with `rel="noreferrer"`.
5. Fenced code renders as a code card: language or file label, syntax colors for JS/TS/JSX/JSON/HTML/CSS/Markdown/Python, horizontal scroll, and a Copy button with "Copied" feedback and a clear fallback message when the clipboard is unavailable.
6. Copy actions: Copy message on every assistant message (companion and goal chat), Copy result per task, Copy all results per goal (summary plus each task as Markdown), Copy new file in the change review.
7. Viewers can read goal chat history but not send; other workspaces get 404. Goal chat uses the chat rate limit (20 per minute per user).
8. Lint, type checks, backend tests, unit tests, E2E, and builds pass; screens checked at 1440px and 390px, light and dark.

### Out of scope

Choosing a companion other than Nova for goal chat, attaching files to chat messages, editing or regenerating a single message, sharing chats publicly.

## 2. Architecture

- **Shared streaming**: the SSE reply logic in `routes/chat.ts` moves into `chat-stream.ts` (`streamReply`) used by both companion chat and goal chat. Events stay `start`, `delta`, `error`, `done`.
- **Goal chat**: `GoalMessage` rows (like `ChatMessage`, keyed by goal and user). Routes `GET/POST/DELETE /api/workspaces/:id/goals/:gid/chat`. Instructions and context come from `goals/prompts.ts` (`goalChatInstructions`, `goalChatContext`).
- **Follow-up goals**: `Goal.parentGoalId` (nullable, set null when the parent is deleted). `POST /goals` accepts `parentGoalId` (same workspace, parent must not be active). The planner adds the PREVIOUS GOAL section.
- **Frontend**: `ChatThread` (shared message list, composer, stop, clear) used by `CompanionChat` and `GoalChat`; `RichText` (react-markdown + remark-gfm, no raw HTML) with `CodeCard` (syntax colors via `@lezer/highlight` `highlightCode` with the existing CodeMirror language parsers) and `CopyButton`.

## 3. Data model

| Model | Fields (beyond `id`, timestamps) | Notes |
|---|---|---|
| `GoalMessage` | `goalId`, `workspaceId`, `userId`, `role` (`user`/`assistant`), `content`, `status` (existing `MessageStatus`), `model?`, `inputTokens?`, `outputTokens?`, `errorCode?`, `errorMessage?` | Index (`goalId`, `userId`, `createdAt`); cascade on goal delete. |
| `Goal` (changed) | + `parentGoalId?` | Self relation, `onDelete: SetNull`. |

Goal-chat model calls are logged as `GoalStep` rows with a new phase `chat`.

## 4. Security

Same as companion chat: membership on every route, rate limit, Nova readiness checks, model output rendered without HTML, file and result contents marked as reference material in the prompt.

## 5. Testing

- **Backend**: goal chat streams and saves both messages; context contains task results, edits, and summary; history is sent; blocked while planning/awaiting approval; viewer cannot post; cross-workspace 404; clear; follow-up goal stores `parentGoalId` and its planning prompt contains the earlier results; companion chat tests still pass after the streaming refactor.
- **Unit**: `toPlainMarkdown(goal)` for Copy all results; code language detection from fence info (`ts`, `tsx title=app.tsx`).
- **E2E**: finish a goal, ask Nova a question, see a code card in the reply, press Copy, continue with a new goal and see "Continues:".
