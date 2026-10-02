# Milestone 2a: AI Provider Connections and Companion Chat

Date: 2026-10-02
Status: Draft for owner review
Builds on: `2026-10-02-milestone-1-foundation-design.md` (branch `milestone-1`)

## 1. Goal

An owner connects one or more AI providers to their company: a ChatGPT account, or API keys for OpenAI, Anthropic, or Google Gemini, or any OpenAI-compatible endpoint (OpenRouter, xAI, DeepSeek, Ollama, other). Each companion is assigned a provider connection and a model. Members chat with any companion; replies stream in from a real model call, history is saved per companion, and token usage reported by the provider is recorded.

### Success criteria

1. An owner or admin can add, test, replace, and remove API-key connections for OpenAI, Anthropic, Gemini, and custom OpenAI-compatible endpoints. A saved secret is never returned to the browser; the UI shows only a hint such as `sk-…a9F2`.
2. On a local or self-hosted install, "Continue with ChatGPT" completes OpenAI's official Sign in with ChatGPT flow and shows the connection as Connected with the account email. On a deployment where local login is not enabled, the card explains why and links to OpenAI's interest form.
3. The Claude account card explains that Anthropic does not permit third-party Claude logins and offers the Anthropic API key route.
4. "Test" on a connection makes one real call (a model-list request) and reports success with the model count, or a plain-language error.
5. The Customize form lets a member pick a connection and a model for a companion. Models come from the provider's live list; a manual model ID is also accepted. Switching models keeps the companion's identity and history.
6. The companion panel has a Chat tab. Sending a message streams the reply token by token, then saves both messages. The reply shows the model and token counts. Stop cancels the request; Clear chat deletes that companion's history for the current user.
7. While a reply is pending, that companion shows "Thinking" in the requester's office view. Otherwise statuses stay Idle, Paused, or Archived.
8. Provider failures appear as clear messages (key rejected, sign in again, rate limited, ChatGPT usage limit with a link to ChatGPT Settings → Usage, model not available, request declined, provider unavailable) and are saved on the failed message.
9. Custom endpoint URLs cannot reach private, loopback, link-local, or cloud-metadata addresses unless the install explicitly sets `ALLOW_LOCAL_ENDPOINTS=true`. Redirects are not followed.
10. Workspace isolation, roles, and secret redaction are proven by automated tests. Provider behavior is proven against deterministic fake provider servers. An opt-in smoke test can hit a real provider with a real key.
11. Lint, type checks, backend tests, the E2E test, and production builds pass; screens are checked at 1440px and 390px, light and dark.

### Out of scope (later milestones)

Goals from the command bar, tasks, multi-agent runs, meetings, tools, file or project access, memory beyond chat history, budgets in money, cross-provider fallback, Claude Code subscription runtime (needs sandboxes, milestone 3+), hosted Sign in with ChatGPT (needs OpenAI partner approval), live office events across browsers.

## 2. Provider rules this design follows

Verified 2026-10-02 against official documentation:

- **Anthropic** (`code.claude.com/docs/en/legal-and-compliance`): "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users." Developers use API keys. The only subscription path is the unmodified Claude Code binary, signed in through Anthropic's own flow, in a hosted sandbox under the Commercial Terms. Not in this milestone.
- **OpenAI Sign in with ChatGPT, plan usage** (`developers.openai.com/siwc/token-sharing-open-source`): open-source and locally hosted apps may use dynamic registration (`client_id=dynamic_agent_client`), loopback redirect on `127.0.0.1`, PKCE, scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`. Inference only via `POST https://api.openai.com/v1/responses` with `store:false`, `stream:true`. Paid or remotely hosted apps must apply via the interest form. The plan may be used only for this app's own features.
- **Google Gemini** is reached through Google's official OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/`.

## 3. Architecture

```
Browser ──► Next.js ──/api──► Fastify (127.0.0.1:4000)
                               ├─ providers/
                               │    openai-responses.ts  OpenAI API key and ChatGPT tokens (fetch + SSE)
                               │    anthropic.ts         @anthropic-ai/sdk messages.stream + models.list
                               │    openai-chat.ts       Gemini, OpenRouter, xAI, DeepSeek, Ollama, custom (fetch + SSE)
                               │    index.ts             one interface: listModels(), stream(), normalized errors
                               ├─ chatgpt-oauth.ts      authorize URL, callback, token exchange, ID-token check, refresh, revoke
                               ├─ crypto.ts             AES-256-GCM encrypt/decrypt with CREDENTIALS_KEY
                               ├─ safe-fetch.ts         public-address check at connect time, no redirects, timeouts
                               ├─ routes/connections.ts connection CRUD, test, model list, ChatGPT start
                               ├─ routes/chatgpt-callback.ts  GET /auth/callback (browser lands here directly)
                               └─ routes/chat.ts        history, send (streams SSE), clear
```

### Provider interface

```ts
type ChatTurn = { role: "user" | "assistant"; content: string };
type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: { inputTokens: number | null; outputTokens: number | null }; model: string };
interface ProviderClient {
  listModels(signal: AbortSignal): Promise<{ id: string; label: string }[]>;
  stream(args: { model: string; instructions: string; turns: ChatTurn[]; signal: AbortSignal }): AsyncIterable<StreamEvent>;
}
class ProviderError extends Error { code: ProviderErrorCode; retryable: boolean; status?: number }
type ProviderErrorCode = "auth" | "reauth" | "rate_limited" | "usage_limit" | "not_eligible" | "model_unavailable"
  | "unsupported" | "refused" | "bad_request" | "unavailable" | "timeout" | "network";
```

### Per-provider request shapes

- **OpenAI Responses** (API key and ChatGPT): `POST {base}/responses` with `model`, `instructions`, `input` (user/assistant message items), `store:false`, `stream:true`. No `temperature`, `max_output_tokens`, or other fields ChatGPT plan usage rejects; the API-key path uses the same body for consistency. Text comes from `response.output_text.delta`; success only on `response.completed` (usage from `response.usage.input_tokens`/`output_tokens`); `response.failed`, `response.incomplete`, `error`, or a stream ending without `response.completed` are failures. Model list: API key `GET /v1/models` (`data[].id`); ChatGPT `GET /v1/models` (`models[]` filtered to `visibility == "list"`, label `display_name`, id `slug`).
- **Anthropic** (official SDK): `client.messages.stream({ model, max_tokens: 16000, system: instructions, messages })`, text from `content_block_delta`/`text_delta`, final usage from the final message. `thinking` is omitted (models apply their own defaults). `stop_reason == "refusal"` becomes a `refused` error showing `stop_details.explanation`. No server-side refusal fallback in this milestone (spec rule: fallback must be explicitly enabled). Model list via `client.models.list()`. SDK typed errors map to error codes.
- **OpenAI-compatible chat**: `POST {base}/chat/completions` with `model`, `messages` (system + turns), `stream:true`, `stream_options:{include_usage:true}`. Text from `choices[0].delta.content`; usage from the final chunk when sent (else null); ends at `data: [DONE]`. Model list `GET {base}/models` (`data[].id`). Requests go through `safe-fetch` for custom endpoints.
- **Presets** (custom kind): OpenRouter `https://openrouter.ai/api/v1`, xAI `https://api.x.ai/v1`, DeepSeek `https://api.deepseek.com/v1`, Ollama `http://127.0.0.1:11434/v1` (requires `ALLOW_LOCAL_ENDPOINTS=true`, no key), Other (any URL).

### Retries and timeouts

At most one retry, with 0.5-1.5 s jittered backoff, only for `rate_limited`, `unavailable`, `network`, or `timeout` errors that happen **before any text has streamed**. Never retry auth, reauth, not_eligible, unsupported, bad_request, refused, or usage_limit. Timeouts: 10 s to connect, 60 s without any stream data, 5 min total per reply.

## 4. Sign in with ChatGPT (local and self-hosted)

- **Enabled** when `CHATGPT_LOCAL_LOGIN=true` (default in `.env.example` for local development). When false, the card is informational with the interest-form link.
- **Host ID**: generated once per install as `urn:uuid:<uuid v4>` and kept in `backend/data/chatgpt-host-id` (git-ignored). Never a user identifier.
- **Start** (`POST /api/workspaces/:id/connections/chatgpt/start`, owner/admin): server creates `state`, `nonce`, PKCE verifier (S256), stores the pending attempt in memory for 10 minutes keyed by `state` with the user, workspace, and (for reauthorization) the existing connection's issued client ID and retained ID token; returns the authorize URL. The browser navigates there (`https://auth.openai.com/api/accounts/authorize`) with `client_id` (`dynamic_agent_client` for new, issued ID for reauth), `agent_name_hint=Agent Company` (new only), `ext_agent_host_id`, `response_type=code`, `redirect_uri=http://127.0.0.1:<PORT>/auth/callback`, the scopes above, `resource=https://api.openai.com/v1`, `state`, `nonce`, `code_challenge`, `code_challenge_method=S256`, plus `id_token_hint` for reauthorization.
- **Callback** (`GET /auth/callback` on the backend; the browser lands there directly on 127.0.0.1, not through Next.js): validates `state`; on `error=access_denied` redirects to the providers page with a "ChatGPT plan use was not allowed" notice; requires an issued `client_id` for new registrations and rejects a mismatched one on reauth; exchanges the code at `https://auth.openai.com/api/accounts/oauth/token` (form-encoded `authorization_code`, issued `client_id`, `code`, `code_verifier`, same `redirect_uri`, `resource`); validates the ID token with OpenAI's JWKS (issuer `https://auth.openai.com`, audience = issued client ID, expiry, nonce) using `jose`; requires `chatgpt.tokens.use.direct` in the granted scopes; saves the connection; redirects to `http://localhost:3000/w/<slug>/providers?connected=chatgpt` (frontend URL from `FRONTEND_URL`). The pending attempt is single-use.
- **Storage**: issued client ID, subject, email, ID token, access token, refresh token, expiry, scopes, all inside the encrypted secret. Hint shows the email.
- **Refresh**: before a request, if the access token expires within 5 minutes, refresh (`grant_type=refresh_token`, issued client ID, refresh token, resource; no scope). Refreshes for the same connection are serialized in-process. Replace access token, refresh token, expiry, and scopes together. `invalid_grant` and the other terminal refresh errors mark the connection `reauth`; network and 5xx errors keep credentials.
- **Remove**: revoke the refresh token at the `revocation_endpoint` from OpenAI's OpenID configuration (form POST `token`, `token_type_hint=refresh_token`, `client_id`), then delete. If revocation cannot be confirmed, delete anyway and tell the user to disconnect the app in ChatGPT Settings.
- **ChatGPT errors**: `subscription_sharing_usage_limit_exceeded` → `usage_limit` (link to `https://chatgpt.com/settings/usage`); `subscription_sharing_user_not_eligible` → `not_eligible`; `subscription_sharing_unsupported_capability` → `unsupported`; `subscription_sharing_invalid_user` or 401 → `reauth`; 503 variants → `unavailable`.
- Tokens never appear in URLs, logs, or the browser. Authorization URLs containing `id_token_hint` are not logged.

## 5. Data model

New enums: `ProviderKind { chatgpt openai anthropic gemini custom }`, `ConnectionStatus { connected error reauth }`, `MessageRole { user assistant }`, `MessageStatus { complete error stopped }`.

| Model | Fields (beyond `id`, timestamps) | Notes |
|---|---|---|
| `ProviderConnection` | `workspaceId`, `kind`, `label` (1-60), `baseUrl` (custom only), `secret` (encrypted text, nullable for keyless local endpoints), `hint`, `status`, `lastCheckedAt`, `lastError`, `createdById` | Index on `workspaceId`. |
| `Agent` (changed) | `+ connectionId` (nullable, `onDelete: SetNull`), `+ model` (nullable, 1-200) | Removing a connection unassigns its companions. |
| `ChatMessage` | `workspaceId`, `agentId` (cascade), `userId` (cascade), `role`, `content` (max 32,000), `status`, `connectionId` (SetNull), `kind` (copied at send time), `model`, `inputTokens`, `outputTokens`, `errorCode`, `errorMessage` | Index on (`agentId`, `userId`, `createdAt`). A thread is one companion and one user. |

Secrets: `crypto.ts` encrypts with AES-256-GCM using a 32-byte key from `CREDENTIALS_KEY` (base64), stored as `v1:<iv>:<tag>:<ciphertext>` (base64 parts). Tampered or wrong-key values fail to decrypt and surface as "This connection's saved secret can't be read; replace it". Key rotation is out of scope.

## 6. API

| Method and path | Role | Purpose |
|---|---|---|
| `GET /api/workspaces/:id/connections` | viewer | List connections (no secrets), per-connection token totals, `chatgptLocalLogin` flag |
| `POST /api/workspaces/:id/connections` | admin | Add API-key or custom connection `{ kind, label, apiKey?, baseUrl? }`; tested before saving; 400 with the provider's reason if the test fails |
| `PATCH /api/workspaces/:id/connections/:cid` | admin | Rename or replace key (`{ label?, apiKey? }`); replacement is tested first |
| `DELETE /api/workspaces/:id/connections/:cid` | admin | Remove (revokes ChatGPT session first) |
| `POST /api/workspaces/:id/connections/:cid/test` | admin | Model-list call; updates status, `lastCheckedAt`, `lastError` |
| `GET /api/workspaces/:id/connections/:cid/models` | member | Live model list |
| `POST /api/workspaces/:id/connections/chatgpt/start` | admin | Returns `{ url }`; 400 with an explanation when local login is disabled |
| `GET /auth/callback` | (state-bound) | ChatGPT callback |
| `PATCH /api/workspaces/:id/agents/:agentId` (changed) | member | Accepts `connectionId` (must be in workspace) and `model` |
| `GET /api/workspaces/:id/agents/:agentId/chat` | member | Last 50 messages for this user and companion |
| `POST /api/workspaces/:id/agents/:agentId/chat` | member | `{ message }` (1-8,000 chars); responds `text/event-stream` |
| `DELETE /api/workspaces/:id/agents/:agentId/chat` | member | Clear this user's history with the companion |

The snapshot (`GET /api/workspaces/:id`) gains `connectionId` and `model` on each agent and a `connections` array (`id`, `kind`, `label`, `hint`, `status`).

Chat stream events: `start` `{ userMessageId }`, `delta` `{ text }`, `done` `{ messageId, model, inputTokens, outputTokens }`, `error` `{ messageId, code, message }`. The user message is saved before the call. The assistant message is saved when the stream ends: `complete`, `error` (partial text kept), or `stopped` (client disconnected; partial text kept). Archived or paused companions, or companions without a connection and model, return 409 with a clear message before any call.

Rate limits: chat send 20/min per user; connection add/test 10/min per user; ChatGPT start 5/min.

### Companion instructions

Built per request, never stored: name, role, department, working style, company name, plus: "You are an AI companion in this company's workspace. You can talk and help think things through. You cannot take actions, browse, or open files yet; if asked, say so plainly." Context: the last 20 `complete` messages of the thread, trimmed oldest-first to 24,000 characters, plus the new message.

## 7. Security

- Secrets: encrypted at rest, never returned, never logged (Fastify log redaction for `authorization`, `x-api-key`, and request bodies on connection routes), never placed in prompts.
- `safe-fetch` for custom base URLs: `https:` required (plus `http:` only with `ALLOW_LOCAL_ENDPOINTS`); every resolved address checked at connect time through an `undici` `Agent` with a custom `lookup` (blocks loopback, private, link-local, CGNAT, multicast, unspecified, IPv6 ULA and mapped forms, and `169.254.169.254`), defeating DNS rebinding; `redirect: "error"`; URL credentials rejected.
- Roles: viewer can see the connection list but cannot chat or read chats; member assigns models and chats (each member sees only their own threads); owner/admin manage connections.
- Every route scoped by workspace and membership as in milestone 1. A connection ID from another workspace is rejected with 400.

## 8. Frontend

- **Sidebar**: Office, Organization, **AI providers**, Settings.
- **AI providers page** (`/w/[slug]/providers`): add-cards for ChatGPT account, Claude account (explanation + "Add Anthropic key"), OpenAI key, Google Gemini key, Custom endpoint (preset select + URL + optional key). Connected list with kind, label, hint, status, last checked, token totals, Test / Replace / Rename / Remove. ChatGPT connections link to ChatGPT Settings → Usage and show "Sign in again" when status is `reauth`. Non-admins see the list read-only. "Continue with ChatGPT" follows OpenAI's Sign in with ChatGPT UI guidelines (checked during implementation).
- **Customize form**: "AI model" section with connection select ("Not connected" option) and a model combobox fed by `/models`, with free text allowed.
- **Companion panel**: Profile and Chat tabs. Chat shows history, streaming reply with a caret, model and token footer, error bubbles with the plain-language message, Stop while streaming, Clear chat with confirm, and an empty state "Choose an AI model for Nova first" linking to Customize when unassigned. Enter sends, Shift+Enter makes a new line. Viewers see a read-only note.
- **Office**: the companion whose reply is pending in this browser shows "Thinking" (label and a calm visual cue; no motion under reduced motion or calm mode).
- Light and dark, keyboard and screen-reader friendly (live region for streamed text, labeled controls), 390px layouts.

## 9. Testing and verification

- **Unit**: crypto round trip, tamper and wrong-key failure; `safe-fetch` rejects private, loopback, metadata, mapped IPv6, `http:` without the flag, URL credentials, and redirects; error mapping tables for all three adapters.
- **Adapters against fake servers** (a small Node HTTP server in tests emitting each provider's SSE format): text deltas, usage, completion, mid-stream failure, stream cut without completion, 401, 429, 5xx retry-before-first-token only. The Anthropic adapter points the SDK at the fake server through an internal `baseURL` option used only by tests.
- **ChatGPT OAuth** against a fake authorization server with a test JWKS (`jose`-generated key): authorize URL parameters, state validation, `access_denied`, missing or mismatched client ID, bad nonce, missing plan scope, refresh success, terminal refresh error → `reauth`, revocation on delete. OpenAI auth and API base URLs are overridable only in test mode.
- **Routes**: role enforcement, isolation (other workspace's connection IDs and chats → 404/400), secrets absent from every response, agent assignment validation, chat SSE end to end with a fake provider (deltas, saved messages, tokens, error saved, abort saved as `stopped`), history limit, clear.
- **E2E** (Playwright): a fake OpenAI-compatible server starts in global setup; the test adds a Custom endpoint pointing at it (`ALLOW_LOCAL_ENDPOINTS=true` in the test backend), assigns it to Nova, sends a message, sees the streamed reply, refreshes, and sees the saved history.
- **Live smoke** (opt-in, not in CI): `LIVE_PROVIDER=openai LIVE_API_KEY=... npm --prefix backend run smoke` sends one short message through the real adapter. Reported separately from mock results. The ChatGPT login is verified manually on the owner's machine.

## 10. Configuration additions (`backend/.env`)

`CREDENTIALS_KEY` (base64, 32 bytes; `openssl rand -base64 32`), `CHATGPT_LOCAL_LOGIN=true`, `ALLOW_LOCAL_ENDPOINTS=false` (set true to use Ollama or other local servers).

## 11. Risks

- **Sign in with ChatGPT is a preview program**; field names or eligibility can change. Errors are surfaced, not hidden, and the flow is isolated in one module.
- **Hosted deployment** cannot use ChatGPT login until OpenAI approves the interest-form application.
- **Provider API drift** (new event types or fields): adapters ignore unknown events and fail closed on missing completion.
- **Neon latency** adds about a quarter second per database call; chat saves are few per message, so streaming is unaffected.
