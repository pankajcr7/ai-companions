# Milestone 2a: Provider Connections and Companion Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect ChatGPT (local Sign in with ChatGPT), OpenAI, Anthropic, Gemini, or any OpenAI-compatible endpoint; assign a connection and model to each companion; chat with companions with streamed replies, saved history, and recorded token usage.

**Architecture:** Three provider adapters behind one `ProviderClient` interface: OpenAI Responses (fetch + SSE, used for OpenAI keys and ChatGPT tokens), Anthropic (official `@anthropic-ai/sdk`), OpenAI-compatible chat (fetch + SSE, used for Gemini and custom endpoints). Secrets are AES-256-GCM encrypted. Custom URLs go through `safe-fetch` (public-address check at connect time, no redirects). Chat replies stream to the browser as SSE from a Fastify route that saves both messages.

**Tech Stack:** Existing (Fastify 5, Better Auth, Prisma 7 on Neon, Zod 4, Vitest, Next.js 16, Playwright) plus `@anthropic-ai/sdk` 0.131, `jose` 6, `undici` 8.

**Spec:** `docs/superpowers/specs/2026-10-02-milestone-2-providers-chat-design.md`

## Global Constraints

- Work on branch `milestone-1` (continues from commit `c889053`). Backend relative imports end in `.js`.
- Secrets never leave the server: not in responses, logs, prompts, or URLs. UI shows only `hint`.
- Roles: viewer reads connection list only (no chat); member assigns models and chats; owner/admin manage connections.
- ChatGPT: `client_id=dynamic_agent_client` for first registration; scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`; resource `https://api.openai.com/v1`; redirect `http://127.0.0.1:<PORT>/auth/callback`; inference only `POST https://api.openai.com/v1/responses` with `store:false`, `stream:true`; no `temperature`/`max_output_tokens`.
- ChatGPT UI copy: button "Continue with ChatGPT" (black, ChatGPT logo); first-sign-in modal "You're using your ChatGPT plan" + "Got it"; near the composer "Using ChatGPT plan" + "Manage usage" (`https://chatgpt.com/settings/usage`); usage-limit message with "Manage usage" as primary action.
- Anthropic via the official SDK only; `thinking` omitted; `max_tokens: 16000`; refusal shown, no fallback.
- Gemini base URL `https://generativelanguage.googleapis.com/v1beta/openai`.
- Custom URLs: `https:` only unless `ALLOW_LOCAL_ENDPOINTS=true`; private/loopback/link-local/CGNAT/metadata blocked; redirects rejected.
- Retry at most once, only for rate_limited/unavailable/network/timeout before any text streamed.
- Chat: message 1-8,000 chars; context = last 20 complete messages trimmed to 24,000 chars; history page 50; rate limit 20/min.
- Statuses shown: Idle, Paused, Archived, plus "Thinking" only while this browser's request is pending.
- No em-dashes in user-facing copy.

## Review Focus

1. **ChatGPT session revoked or expired mid-chat** (401 from inference): connection becomes "Sign in again", the chat shows that message, nothing loops. Test in Task 8.
2. **Removing a connection that companions use**: companions become unassigned and their chat says to choose a model, no crash. Test in Task 6.
3. **Long conversations**: older turns are dropped so requests stay under the context budget, and the first turn sent is always a user turn. Test in Task 8.
4. **Provider sends garbage or a cut stream** (HTTP 200 but invalid JSON, or no completion event): a clear error, never a hang or a fake "complete". Tests in Tasks 3 and 4.
5. **User closes the tab mid-reply**: the partial reply is saved as "stopped". Test in Task 8.

---

## File Map

```
backend/
  prisma/schema.prisma                 + ProviderConnection, ChatMessage, Agent.connectionId/model, enums
  src/env.ts                           + testOverride()
  src/crypto.ts                        encryptSecret / decryptSecret
  src/safe-fetch.ts                    isPublicAddress, checkBaseUrl, guardedLookup, safeFetch
  src/providers/types.ts               ProviderClient, ProviderError, errorFromStatus, toProviderError
  src/providers/sse.ts                 readSse
  src/providers/openai-chat.ts         Gemini + custom
  src/providers/openai-responses.ts    OpenAI key + ChatGPT
  src/providers/anthropic.ts           Anthropic SDK
  src/providers/index.ts               clientFor, PRESETS
  src/chatgpt-oauth.ts                 Sign in with ChatGPT
  src/companion.ts                     companionInstructions, trimTurns
  src/routes/connections.ts            connection CRUD/test/models
  src/routes/chatgpt.ts                start + /auth/callback
  src/routes/chat.ts                   history / send (SSE) / clear
  src/routes/agents.ts, src/snapshot.ts (modified)
  scripts/smoke.ts                     opt-in live test
  test/fake-provider.ts                fake HTTP server + SSE helpers
  test/crypto.test.ts, safe-fetch.test.ts, provider-openai-chat.test.ts,
  test/provider-openai-responses.test.ts, provider-anthropic.test.ts,
  test/connections.test.ts, chatgpt.test.ts, chat.test.ts
frontend/
  src/lib/types.ts                     + Connection, ChatMessageDTO, Agent.connectionId/model
  src/lib/sse.ts                       client-side SSE reader
  src/components/app/AppShell.tsx      + AI providers nav
  src/app/w/[slug]/providers/page.tsx  providers page
  src/components/app/CompanionForm.tsx + AI model section
  src/components/app/CompanionPanel.tsx + Profile/Chat tabs
  src/components/app/CompanionChat.tsx chat UI
  src/components/app/office/Office.tsx, OfficeScene.tsx  + Thinking
  e2e/fake-llm.ts, e2e/chat.spec.ts, e2e/global-setup.ts, playwright.config.ts
```

---

### Task 1: Schema, secret encryption, configuration

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/src/env.ts`, `.env.example`, `backend/package.json` (deps), `backend/vitest.config.ts`
- Create: `backend/src/crypto.ts`, `backend/test/crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plain: string): string`, `decryptSecret(blob: string): string`, `class SecretError`, `testOverride(name: string): string | undefined`, Prisma models `ProviderConnection`, `ChatMessage`, enums `ProviderKind`, `ConnectionStatus`, `MessageRole`, `MessageStatus`, `Agent.connectionId`, `Agent.model`.

- [ ] **Step 1: Install backend dependencies**

```bash
cd backend && npm i @anthropic-ai/sdk@0.131 jose@6 undici@8
```

- [ ] **Step 2: Add a CREDENTIALS_KEY to backend/.env (without printing it) and config lines**

```bash
cd backend && grep -q '^CREDENTIALS_KEY=' .env || printf '\nCREDENTIALS_KEY=%s\nCHATGPT_LOCAL_LOGIN=true\nALLOW_LOCAL_ENDPOINTS=false\n' "$(openssl rand -base64 32)" >> .env
grep -c '^CREDENTIALS_KEY=.\+' .env
```

Expected: `1`.

Append to root `.env.example`:

```
# Encrypts saved provider keys and tokens. Generate with: openssl rand -base64 32
CREDENTIALS_KEY=
# true on a local or self-hosted install: enables "Continue with ChatGPT"
CHATGPT_LOCAL_LOGIN=true
# true to allow Ollama or other servers on this machine or private network
ALLOW_LOCAL_ENDPOINTS=false
```

In `backend/vitest.config.ts`, change `env: { USE_TEST_DB: "1" }` to `env: { USE_TEST_DB: "1", ALLOW_LOCAL_ENDPOINTS: "true", CHATGPT_LOCAL_LOGIN: "true" }` (fake provider servers run on 127.0.0.1).

- [ ] **Step 3: Write the failing crypto test**

`backend/test/crypto.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { decryptSecret, encryptSecret, SecretError } from "../src/crypto.js";

const original = process.env.CREDENTIALS_KEY;
afterEach(() => {
  process.env.CREDENTIALS_KEY = original;
});

test("round trip, and the stored form hides the secret", () => {
  const blob = encryptSecret("sk-live-1234567890");
  expect(blob.startsWith("v1:")).toBe(true);
  expect(blob).not.toContain("sk-live");
  expect(decryptSecret(blob)).toBe("sk-live-1234567890");
});

test("same secret encrypts differently each time", () => {
  expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
});

test("tampered ciphertext fails with SecretError", () => {
  const [v, iv, tag, ct] = encryptSecret("secret").split(":");
  const flipped = Buffer.from(ct, "base64");
  flipped[0] ^= 1;
  expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow(SecretError);
});

test("wrong key fails with SecretError", () => {
  const blob = encryptSecret("secret");
  process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
  expect(() => decryptSecret(blob)).toThrow(SecretError);
});

test("missing or short key is a clear configuration error", () => {
  process.env.CREDENTIALS_KEY = "short";
  expect(() => encryptSecret("x")).toThrow(/CREDENTIALS_KEY/);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd backend && npx vitest run test/crypto.test.ts`
Expected: FAIL, `Cannot find module '../src/crypto.js'`.

- [ ] **Step 5: Write `backend/src/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretError extends Error {
  constructor() {
    super("This connection's saved secret can't be read; replace it");
  }
}

function key() {
  const k = Buffer.from(process.env.CREDENTIALS_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
  return k;
}

/** AES-256-GCM. Stored as v1:<iv>:<tag>:<ciphertext>, each part base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new SecretError();
  const k = key();
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new SecretError();
  }
}
```

- [ ] **Step 6: Run the crypto test**

Run: `cd backend && npx vitest run test/crypto.test.ts`
Expected: 5 passed.

- [ ] **Step 7: Add `testOverride` to `backend/src/env.ts`**

Append:

```ts
/** Lets tests point fixed provider hosts at fake servers. Ignored outside test mode. */
export function testOverride(name: string): string | undefined {
  return process.env.VITEST || process.env.USE_TEST_DB ? process.env[name] : undefined;
}
```

- [ ] **Step 8: Extend the Prisma schema**

Add enums:

```prisma
enum ProviderKind {
  chatgpt
  openai
  anthropic
  gemini
  custom
}

enum ConnectionStatus {
  connected
  error
  reauth
}

enum MessageRole {
  user
  assistant
}

enum MessageStatus {
  complete
  error
  stopped
}
```

Add models:

```prisma
model ProviderConnection {
  id            String           @id @default(cuid())
  workspaceId   String
  kind          ProviderKind
  label         String
  baseUrl       String?
  secret        String?
  hint          String           @default("")
  status        ConnectionStatus @default(connected)
  lastCheckedAt DateTime?
  lastError     String?
  createdById   String
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  workspace     Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agents        Agent[]
  messages      ChatMessage[]

  @@index([workspaceId])
}

model ChatMessage {
  id           String              @id @default(cuid())
  workspaceId  String
  agentId      String
  userId       String
  role         MessageRole
  content      String
  status       MessageStatus       @default(complete)
  connectionId String?
  kind         ProviderKind?
  model        String?
  inputTokens  Int?
  outputTokens Int?
  errorCode    String?
  errorMessage String?
  createdAt    DateTime            @default(now())
  workspace    Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  agent        Agent               @relation(fields: [agentId], references: [id], onDelete: Cascade)
  user         User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  connection   ProviderConnection? @relation(fields: [connectionId], references: [id], onDelete: SetNull)

  @@index([agentId, userId, createdAt])
  @@index([workspaceId])
}
```

Add to `Agent`:

```prisma
  connectionId String?
  model        String?
  connection   ProviderConnection? @relation(fields: [connectionId], references: [id], onDelete: SetNull)
  chatMessages ChatMessage[]
```

Add `connections ProviderConnection[]` and `chatMessages ChatMessage[]` to `Workspace`, and `chatMessages ChatMessage[]` to `User`.

- [ ] **Step 9: Migrate and type-check**

Run: `cd backend && npx prisma migrate dev --name providers_chat 2>&1 | grep -v "postgresql://" | tail -3 && npx tsc --noEmit && echo TSC_OK`
Expected: `Your database is now in sync with your schema.` and `TSC_OK`.

- [ ] **Step 10: Run the whole suite, then commit**

Run: `cd backend && npm test 2>&1 | grep -E "Tests |Test Files"`
Expected: all pass (43 previous + 5 new).

```bash
git add backend .env.example
git commit -m "feat(backend): provider and chat schema, encrypted secrets"
```

---

### Task 2: Safe fetch for user-supplied URLs

**Files:**
- Create: `backend/src/safe-fetch.ts`, `backend/test/safe-fetch.test.ts`

**Interfaces:**
- Produces: `isPublicAddress(address: string): boolean`, `checkBaseUrl(raw: string): string`, `guardedLookup` (net lookup function), `safeFetch(url: string, init?: SafeInit): Promise<Response>` (undici `Response`), `class UnsafeUrlError`, `allowLocal(): boolean`, `type SafeInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }`.

- [ ] **Step 1: Write the failing tests**

`backend/test/safe-fetch.test.ts`:

```ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, test } from "vitest";
import { checkBaseUrl, guardedLookup, isPublicAddress, safeFetch, UnsafeUrlError } from "../src/safe-fetch.js";

beforeEach(() => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
});
afterEach(() => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
});

test.each([
  ["8.8.8.8", true],
  ["1.1.1.1", true],
  ["2606:4700:4700::1111", true],
  ["127.0.0.1", false],
  ["10.1.2.3", false],
  ["172.16.5.5", false],
  ["192.168.1.1", false],
  ["169.254.169.254", false],
  ["100.64.0.1", false],
  ["0.0.0.0", false],
  ["::1", false],
  ["fd00::1", false],
  ["fe80::1", false],
  ["::ffff:127.0.0.1", false],
  ["::ffff:7f00:1", false],
  ["not-an-ip", false],
])("isPublicAddress(%s) = %s", (ip, expected) => {
  expect(isPublicAddress(ip)).toBe(expected);
});

test("checkBaseUrl accepts public https and normalises the trailing slash", () => {
  expect(checkBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1");
});

test.each([
  ["http://example.com/v1", "https://"],
  ["https://user:pw@example.com", "username"],
  ["https://127.0.0.1/v1", "private"],
  ["https://[::1]/v1", "private"],
  ["https://169.254.169.254/latest", "private"],
  ["https://localhost:8080", "private"],
  ["not a url", "valid URL"],
])("checkBaseUrl rejects %s", (url, msg) => {
  expect(() => checkBaseUrl(url)).toThrow(UnsafeUrlError);
  expect(() => checkBaseUrl(url)).toThrow(new RegExp(msg, "i"));
});

test("ALLOW_LOCAL_ENDPOINTS=true permits http and local addresses", () => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
  expect(checkBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/v1");
});

test("the connect-time lookup refuses hostnames that resolve to private addresses", async () => {
  await expect(
    new Promise((resolve, reject) => guardedLookup("localhost", { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs)))),
  ).rejects.toThrow(UnsafeUrlError);
});

test("redirects are refused", async () => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
  const server = createServer((_req, res) => res.writeHead(302, { location: "http://169.254.169.254/" }).end());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  await expect(safeFetch(`http://127.0.0.1:${port}/models`)).rejects.toThrow();
  server.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/safe-fetch.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `backend/src/safe-fetch.ts`**

```ts
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";

export class UnsafeUrlError extends Error {}

export const allowLocal = () => process.env.ALLOW_LOCAL_ENDPOINTS === "true";

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

const PRIVATE_NAME = /^(localhost|.+\.localhost|.+\.local|.+\.internal)$/i;

/** Validates a user-supplied base URL and returns it without a trailing slash. */
export function checkBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That isn't a valid URL");
  }
  if (u.username || u.password) throw new UnsafeUrlError("Remove the username and password from the URL");
  const local = allowLocal();
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new UnsafeUrlError("Use an https:// URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!local && ((isIP(host) && !isPublicAddress(host)) || PRIVATE_NAME.test(host))) {
    throw new UnsafeUrlError("That address is on a private network. Set ALLOW_LOCAL_ENDPOINTS=true on a self-hosted install to use it.");
  }
  u.hash = "";
  u.search = "";
  return u.toString().replace(/\/+$/, "");
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup used at connect time, so a hostname can't be re-pointed at a private address after validation. */
export function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) {
  dnsLookup(hostname, { family: options.family ?? 0, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new UnsafeUrlError("That address is on a private network"), []);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

const timeouts = { headersTimeout: 60_000, bodyTimeout: 60_000, connectTimeout: 10_000 };
const publicAgent = new Agent({ ...timeouts, connect: { lookup: guardedLookup as never } });
const localAgent = new Agent(timeouts);

export type SafeInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };

export function safeFetch(url: string, init: SafeInit = {}): Promise<Response> {
  checkBaseUrl(url);
  return fetch(url, { ...init, redirect: "error", dispatcher: allowLocal() ? localAgent : publicAgent });
}
```

- [ ] **Step 4: Run tests and type check**

Run: `cd backend && npx vitest run test/safe-fetch.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: all pass, `TSC_OK`. If `connectTimeout` is not an `Agent` option in undici 8, use `connect: { timeout: 10_000, lookup }` instead (and `connect: { timeout: 10_000 }` for `localAgent`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/safe-fetch.ts backend/test/safe-fetch.test.ts
git commit -m "feat(backend): safe fetch for user-supplied provider URLs"
```

---

### Task 3: Provider core and the OpenAI-compatible chat adapter

**Files:**
- Create: `backend/src/providers/types.ts`, `backend/src/providers/sse.ts`, `backend/src/providers/openai-chat.ts`, `backend/test/fake-provider.ts`, `backend/test/provider-openai-chat.test.ts`

**Interfaces:**
- Consumes: `safeFetch`, `UnsafeUrlError`.
- Produces:
  - `type ChatTurn = { role: "user" | "assistant"; content: string }`
  - `type Usage = { inputTokens: number | null; outputTokens: number | null }`
  - `type StreamEvent = { type: "delta"; text: string } | { type: "done"; usage: Usage; model: string }`
  - `type ModelInfo = { id: string; label: string }`
  - `type StreamArgs = { model: string; instructions: string; turns: ChatTurn[]; signal: AbortSignal }`
  - `interface ProviderClient { listModels(signal: AbortSignal): Promise<ModelInfo[]>; stream(args: StreamArgs): AsyncIterable<StreamEvent> }`
  - `type ProviderErrorCode`, `class ProviderError(code, message, status?)` with `.retryable`
  - `errorFromStatus(status: number, message: string, code?: string): ProviderError`
  - `toProviderError(e: unknown, signal?: AbortSignal): unknown` (returns the original error when `signal` is aborted)
  - `call(url: string, init: SafeInit): Promise<Response>` (throws `ProviderError` on non-2xx)
  - `readSse(body): AsyncGenerator<{ event: string; data: string }>`
  - `openAiChatClient(opts: { baseUrl: string; apiKey: string | null }): ProviderClient`
  - Test helpers: `fakeServer(routes)`, `sse(res, events, opts?)`

- [ ] **Step 1: Write the fake provider helper**

`backend/test/fake-provider.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeRequest = { method: string; path: string; headers: IncomingMessage["headers"]; body: unknown; raw: string };
export type Handler = (req: FakeRequest, res: ServerResponse) => void | Promise<void>;

/** A tiny HTTP server. Routes are "METHOD /path"; every request is recorded. */
export async function fakeServer(routes: Record<string, Handler>) {
  const requests: FakeRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const type = req.headers["content-type"] ?? "";
    const body = !raw ? undefined : type.includes("json") ? JSON.parse(raw) : type.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : raw;
    const path = (req.url ?? "/").split("?")[0];
    const record = { method: req.method ?? "GET", path, headers: req.headers, body, raw };
    requests.push(record);
    const handler = routes[`${record.method} ${path}`];
    if (!handler) return void res.writeHead(404, { "content-type": "application/json" }).end('{"error":{"message":"not found"}}');
    await handler(record, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    routes,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Writes server-sent events. Strings become `data: <string>`; objects are JSON with an optional event name. */
export function sse(res: ServerResponse, events: (string | { event?: string; data: unknown })[], opts: { end?: boolean } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) {
    if (typeof e === "string") res.write(`data: ${e}\n\n`);
    else res.write(`${e.event ? `event: ${e.event}\n` : ""}data: ${JSON.stringify(e.data)}\n\n`);
  }
  if (opts.end !== false) res.end();
}

export const json = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
```

- [ ] **Step 2: Write the failing adapter tests**

`backend/test/provider-openai-chat.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { openAiChatClient } from "../src/providers/openai-chat.js";
import { ProviderError, type StreamEvent } from "../src/providers/types.js";
import { fakeServer, json, sse } from "./fake-provider.js";

const chunk = (content: string) => JSON.stringify({ model: "fake-1", choices: [{ delta: { content } }] });
const fake = await fakeServer({
  "GET /v1/models": (_q, res) => json(res, 200, { data: [{ id: "fake-1" }, { id: "fake-2" }] }),
  "POST /v1/chat/completions": (_q, res) =>
    sse(res, [chunk("Hel"), chunk("lo"), JSON.stringify({ model: "fake-1", choices: [], usage: { prompt_tokens: 12, completion_tokens: 2 } }), "[DONE]"]),
});
afterAll(() => fake.close());

const client = (path = "/v1") => openAiChatClient({ baseUrl: fake.url + path, apiKey: "sk-test" });
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};
const args = { model: "fake-1", instructions: "You are Nova.", turns: [{ role: "user" as const, content: "Hi" }], signal: AbortSignal.timeout(5000) };

test("lists models", async () => {
  expect(await client().listModels(AbortSignal.timeout(5000))).toEqual([
    { id: "fake-1", label: "fake-1" },
    { id: "fake-2", label: "fake-2" },
  ]);
  expect(fake.requests.at(-1)!.headers.authorization).toBe("Bearer sk-test");
});

test("streams text, then usage and the served model", async () => {
  const events = await collect(client().stream(args));
  expect(events).toEqual([
    { type: "delta", text: "Hel" },
    { type: "delta", text: "lo" },
    { type: "done", usage: { inputTokens: 12, outputTokens: 2 }, model: "fake-1" },
  ]);
  const body = fake.requests.at(-1)!.body as { messages: unknown[]; stream: boolean; stream_options: unknown };
  expect(body.stream).toBe(true);
  expect(body.stream_options).toEqual({ include_usage: true });
  expect(body.messages).toEqual([
    { role: "system", content: "You are Nova." },
    { role: "user", content: "Hi" },
  ]);
});

test("a stream without [DONE] is an error, not a finished reply", async () => {
  fake.routes["POST /v1/chat/completions"] = (_q, res) => sse(res, [chunk("Hel")]);
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "network" });
});

test("an unreadable chunk is an error", async () => {
  fake.routes["POST /v1/chat/completions"] = (_q, res) => sse(res, ["{not json", "[DONE]"]);
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "unavailable" });
});

test("status codes map to plain errors", async () => {
  fake.routes["POST /v1/chat/completions"] = (_q, res) => json(res, 401, { error: { message: "bad key" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "auth" });
  fake.routes["POST /v1/chat/completions"] = (_q, res) => json(res, 429, { error: { message: "slow down" } });
  const err = await collect(client().stream(args)).catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err.retryable).toBe(true);
});

test("a missing endpoint is reported as unavailable model or route", async () => {
  await expect(client("/nope").listModels(AbortSignal.timeout(5000))).rejects.toMatchObject({ code: "model_unavailable" });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx vitest run test/provider-openai-chat.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write `backend/src/providers/types.ts`**

```ts
import { safeFetch, UnsafeUrlError, type SafeInit } from "../safe-fetch.js";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type Usage = { inputTokens: number | null; outputTokens: number | null };
export type StreamEvent = { type: "delta"; text: string } | { type: "done"; usage: Usage; model: string };
export type ModelInfo = { id: string; label: string };
export type StreamArgs = { model: string; instructions: string; turns: ChatTurn[]; signal: AbortSignal };

export interface ProviderClient {
  listModels(signal: AbortSignal): Promise<ModelInfo[]>;
  stream(args: StreamArgs): AsyncIterable<StreamEvent>;
}

export type ProviderErrorCode =
  | "auth" | "reauth" | "rate_limited" | "usage_limit" | "not_eligible" | "model_unavailable"
  | "unsupported" | "refused" | "bad_request" | "unavailable" | "timeout" | "network";

const RETRYABLE: ProviderErrorCode[] = ["rate_limited", "unavailable", "network", "timeout"];

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
  get retryable() {
    return RETRYABLE.includes(this.code);
  }
}

const BY_CODE: Record<string, [ProviderErrorCode, string]> = {
  subscription_sharing_usage_limit_exceeded: ["usage_limit", "ChatGPT usage limit reached. Review it in ChatGPT settings."],
  subscription_sharing_user_not_eligible: ["not_eligible", "ChatGPT plan use isn't available for this account or workspace."],
  subscription_sharing_unsupported_capability: ["unsupported", "This request uses something ChatGPT plan usage doesn't support."],
  subscription_sharing_route_not_supported: ["unsupported", "This request isn't supported with ChatGPT plan usage."],
  subscription_sharing_invalid_user: ["reauth", "Sign in to ChatGPT again to keep using it."],
  subscription_sharing_usage_unavailable: ["unavailable", "ChatGPT usage couldn't be checked right now. Try again shortly."],
  subscription_sharing_user_unavailable: ["unavailable", "ChatGPT is temporarily unavailable. Try again shortly."],
  invalid_api_key: ["auth", "The provider rejected the key."],
  insufficient_quota: ["usage_limit", "This provider account is out of credits or over its quota."],
  rate_limit_exceeded: ["rate_limited", "Rate limited by the provider. Try again shortly."],
  model_not_found: ["model_unavailable", "That model isn't available on this connection."],
};

export function errorFromStatus(status: number, message: string, code?: string): ProviderError {
  const known = code ? BY_CODE[code] : undefined;
  if (known) return new ProviderError(known[0], known[1], status);
  if (status === 401) return new ProviderError("auth", "The provider rejected the key.", status);
  if (status === 403) return new ProviderError("auth", message || "The provider refused access.", status);
  if (status === 404) return new ProviderError("model_unavailable", "That model or endpoint isn't available on this connection.", status);
  if (status === 429) return new ProviderError("rate_limited", "Rate limited by the provider. Try again shortly.", status);
  if (status >= 500) return new ProviderError("unavailable", "The provider is having trouble right now.", status);
  return new ProviderError("bad_request", message || `The provider returned an error (${status}).`, status);
}

/** Normalises fetch/stream failures. A user abort is returned unchanged so callers can tell it apart. */
export function toProviderError(e: unknown, signal?: AbortSignal): unknown {
  if (e instanceof ProviderError) return e;
  if (signal?.aborted) return e;
  const cause = (e as { cause?: unknown })?.cause;
  if (e instanceof UnsafeUrlError || cause instanceof UnsafeUrlError) return new ProviderError("bad_request", ((cause ?? e) as Error).message);
  const code = String((cause as { code?: string })?.code ?? (e as { code?: string })?.code ?? "");
  if (/TIMEOUT/.test(code) || (e as Error)?.name === "TimeoutError") return new ProviderError("timeout", "The provider took too long to respond.");
  if (/redirect/i.test(String((cause as Error)?.message ?? ""))) return new ProviderError("bad_request", "The provider redirected the request, which isn't allowed.");
  if (e instanceof SyntaxError) return new ProviderError("unavailable", "The provider sent a reply that couldn't be read.");
  return new ProviderError("network", "Couldn't reach the provider.");
}

export async function call(url: string, init: SafeInit) {
  let res;
  try {
    res = await safeFetch(url, init);
  } catch (e) {
    throw toProviderError(e, init.signal);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } | string; message?: string } | null;
    const err = typeof body?.error === "object" ? body.error : undefined;
    throw errorFromStatus(res.status, err?.message ?? body?.message ?? "", err?.code);
  }
  return res;
}
```

- [ ] **Step 5: Write `backend/src/providers/sse.ts`**

```ts
/** Parses a server-sent-events byte stream into { event, data } records. */
export async function* readSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let sep: RegExpExecArray | null;
    while ((sep = /\r?\n\r?\n/.exec(buf))) {
      const block = buf.slice(0, sep.index);
      buf = buf.slice(sep.index + sep[0].length);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const i = line.indexOf(":");
        const field = i === -1 ? line : line.slice(0, i);
        const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}
```

- [ ] **Step 6: Write `backend/src/providers/openai-chat.ts`**

```ts
import { readSse } from "./sse.js";
import { call, ProviderError, toProviderError, type ProviderClient, type Usage } from "./types.js";

/** OpenAI-compatible /chat/completions (Gemini's OpenAI endpoint, OpenRouter, xAI, DeepSeek, Ollama, custom). */
export function openAiChatClient(opts: { baseUrl: string; apiKey: string | null }): ProviderClient {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) };
  return {
    async listModels(signal) {
      const res = await call(`${opts.baseUrl}/models`, { headers, signal });
      const body = (await res.json().catch(() => ({}))) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    },
    async *stream({ model, instructions, turns, signal }) {
      const res = await call(`${opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, messages: [{ role: "system", content: instructions }, ...turns] }),
      });
      let usage: Usage = { inputTokens: null, outputTokens: null };
      let served = model;
      let finished = false;
      try {
        for await (const { data } of readSse(res.body!)) {
          if (data === "[DONE]") {
            finished = true;
            break;
          }
          const chunk = JSON.parse(data);
          if (chunk.error) throw new ProviderError("unavailable", chunk.error.message ?? "The provider reported an error.");
          if (chunk.model) served = chunk.model;
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield { type: "delta", text };
          if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? null, outputTokens: chunk.usage.completion_tokens ?? null };
        }
      } catch (e) {
        throw toProviderError(e, signal);
      }
      if (!finished) throw new ProviderError("network", "The reply was cut off before it finished.");
      yield { type: "done", usage, model: served };
    },
  };
}
```

- [ ] **Step 7: Run the tests and type check**

Run: `cd backend && npx vitest run test/provider-openai-chat.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 6 passed, `TSC_OK`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/providers backend/test/fake-provider.ts backend/test/provider-openai-chat.test.ts
git commit -m "feat(backend): provider interface and OpenAI-compatible chat adapter"
```

---

### Task 4: OpenAI Responses adapter (API key and ChatGPT)

**Files:**
- Create: `backend/src/providers/openai-responses.ts`, `backend/test/provider-openai-responses.test.ts`

**Interfaces:**
- Consumes: `call`, `readSse`, `ProviderError`, `errorFromStatus`, `toProviderError`, `ProviderClient`.
- Produces: `openAiResponsesClient(opts: { baseUrl: string; token: () => Promise<string>; modelList: "api" | "chatgpt" }): ProviderClient`.

- [ ] **Step 1: Write the failing tests**

`backend/test/provider-openai-responses.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { openAiResponsesClient } from "../src/providers/openai-responses.js";
import type { StreamEvent } from "../src/providers/types.js";
import { fakeServer, json, sse } from "./fake-provider.js";

const ok = [
  { event: "response.created", data: { type: "response.created", response: { model: "gpt-x" } } },
  { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Hi " } },
  { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "there" } },
  { event: "response.completed", data: { type: "response.completed", response: { model: "gpt-x-2026", usage: { input_tokens: 30, output_tokens: 4 } } } },
];
const fake = await fakeServer({
  "POST /v1/responses": (_q, res) => sse(res, ok),
  "GET /v1/models": (_q, res) => json(res, 200, { data: [{ id: "gpt-x" }] }),
});
afterAll(() => fake.close());

const make = (modelList: "api" | "chatgpt" = "api") =>
  openAiResponsesClient({ baseUrl: `${fake.url}/v1`, token: async () => "tok-123", modelList });
const args = {
  model: "gpt-x",
  instructions: "You are Nova.",
  turns: [{ role: "user" as const, content: "Hello" }, { role: "assistant" as const, content: "Hi" }, { role: "user" as const, content: "Again" }],
  signal: AbortSignal.timeout(5000),
};
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

test("streams deltas and finishes only on response.completed", async () => {
  expect(await collect(make().stream(args))).toEqual([
    { type: "delta", text: "Hi " },
    { type: "delta", text: "there" },
    { type: "done", usage: { inputTokens: 30, outputTokens: 4 }, model: "gpt-x-2026" },
  ]);
});

test("request body follows ChatGPT plan-usage rules", async () => {
  await collect(make().stream(args));
  const req = fake.requests.at(-1)!;
  expect(req.headers.authorization).toBe("Bearer tok-123");
  const body = req.body as Record<string, unknown>;
  expect(body).toMatchObject({ model: "gpt-x", instructions: "You are Nova.", store: false, stream: true });
  expect(body.input).toEqual([
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Again" },
  ]);
  for (const banned of ["temperature", "max_output_tokens", "previous_response_id", "user", "metadata"]) expect(body).not.toHaveProperty(banned);
});

test("response.failed with a ChatGPT usage-limit code maps to usage_limit", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) =>
    sse(res, [ok[1], { event: "response.failed", data: { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } } }]);
  await expect(collect(make().stream(args))).rejects.toMatchObject({ code: "usage_limit" });
});

test("a stream that ends without response.completed is an error", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) => sse(res, [ok[1]]);
  await expect(collect(make().stream(args))).rejects.toMatchObject({ code: "network" });
});

test("response.incomplete is an error that says the reply stopped early", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) =>
    sse(res, [{ event: "response.incomplete", data: { type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } } }]);
  await expect(collect(make().stream(args))).rejects.toThrow(/stopped early/);
});

test("HTTP errors carry the provider's code", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) => json(res, 403, { error: { code: "subscription_sharing_user_not_eligible", message: "no" } });
  await expect(collect(make().stream(args))).rejects.toMatchObject({ code: "not_eligible" });
});

test("API-key model list reads data[].id", async () => {
  expect(await make("api").listModels(AbortSignal.timeout(5000))).toEqual([{ id: "gpt-x", label: "gpt-x" }]);
});

test("ChatGPT model list keeps only visible models with display names", async () => {
  fake.routes["GET /v1/models"] = (_q, res) =>
    json(res, 200, { models: [{ slug: "gpt-a", display_name: "GPT A", visibility: "list" }, { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" }] });
  expect(await make("chatgpt").listModels(AbortSignal.timeout(5000))).toEqual([{ id: "gpt-a", label: "GPT A" }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/provider-openai-responses.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `backend/src/providers/openai-responses.ts`**

```ts
import { readSse } from "./sse.js";
import { call, errorFromStatus, ProviderError, toProviderError, type ProviderClient, type Usage } from "./types.js";

/**
 * OpenAI Responses API. Used for OpenAI API keys and for ChatGPT plan usage (same endpoint).
 * The body sticks to fields ChatGPT plan usage accepts: store false, stream true, no sampling or output caps.
 */
export function openAiResponsesClient(opts: { baseUrl: string; token: () => Promise<string>; modelList: "api" | "chatgpt" }): ProviderClient {
  const headers = async () => ({ "content-type": "application/json", authorization: `Bearer ${await opts.token()}` });
  return {
    async listModels(signal) {
      const res = await call(`${opts.baseUrl}/models`, { headers: await headers(), signal });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { id: string }[];
        models?: { slug: string; display_name?: string; visibility?: string }[];
      };
      if (opts.modelList === "chatgpt") {
        return (body.models ?? []).filter((m) => m.visibility === "list").map((m) => ({ id: m.slug, label: m.display_name ?? m.slug }));
      }
      return (body.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    },
    async *stream({ model, instructions, turns, signal }) {
      const res = await call(`${opts.baseUrl}/responses`, {
        method: "POST",
        headers: await headers(),
        signal,
        body: JSON.stringify({ model, instructions, input: turns.map((t) => ({ role: t.role, content: t.content })), store: false, stream: true }),
      });
      let usage: Usage = { inputTokens: null, outputTokens: null };
      let served = model;
      let completed = false;
      try {
        for await (const { data } of readSse(res.body!)) {
          const ev = JSON.parse(data);
          switch (ev.type) {
            case "response.output_text.delta":
              if (ev.delta) yield { type: "delta", text: ev.delta };
              break;
            case "response.completed":
              completed = true;
              served = ev.response?.model ?? served;
              usage = { inputTokens: ev.response?.usage?.input_tokens ?? null, outputTokens: ev.response?.usage?.output_tokens ?? null };
              break;
            case "response.failed": {
              const err = ev.response?.error ?? {};
              throw errorFromStatus(err.code === "rate_limit_exceeded" ? 429 : 500, err.message ?? "", err.code);
            }
            case "response.incomplete":
              throw new ProviderError("unavailable", `The reply stopped early (${ev.response?.incomplete_details?.reason ?? "unknown reason"}).`);
            case "error":
              throw errorFromStatus(500, ev.message ?? ev.error?.message ?? "", ev.code ?? ev.error?.code);
          }
          if (completed) break;
        }
      } catch (e) {
        throw toProviderError(e, signal);
      }
      if (!completed) throw new ProviderError("network", "The reply was cut off before it finished.");
      yield { type: "done", usage, model: served };
    },
  };
}
```

- [ ] **Step 4: Run tests and type check**

Run: `cd backend && npx vitest run test/provider-openai-responses.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 8 passed, `TSC_OK`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/openai-responses.ts backend/test/provider-openai-responses.test.ts
git commit -m "feat(backend): OpenAI Responses adapter for API keys and ChatGPT plan usage"
```

---

### Task 5: Anthropic adapter (official SDK)

**Files:**
- Create: `backend/src/providers/anthropic.ts`, `backend/test/provider-anthropic.test.ts`

**Interfaces:**
- Consumes: `ProviderError`, `errorFromStatus`, `ProviderClient`.
- Produces: `anthropicClient(opts: { apiKey: string; baseURL?: string }): ProviderClient`.

- [ ] **Step 1: Write the failing tests**

`backend/test/provider-anthropic.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { anthropicClient } from "../src/providers/anthropic.js";
import type { StreamEvent } from "../src/providers/types.js";
import { fakeServer, json, sse } from "./fake-provider.js";

function messageEvents(text: string[], stop = "end_turn", extra: Record<string, unknown> = {}) {
  return [
    { event: "message_start", data: { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 21, output_tokens: 1 } } } },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
    ...text.map((t) => ({ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } })),
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, ...extra }, usage: { output_tokens: 7 } } },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
}

const fake = await fakeServer({
  "POST /v1/messages": (_q, res) => sse(res, messageEvents(["Hello", " owner"])),
  "GET /v1/models": (_q, res) => json(res, 200, { data: [{ type: "model", id: "claude-test", display_name: "Claude Test", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "claude-test", last_id: "claude-test" }),
});
afterAll(() => fake.close());

const client = () => anthropicClient({ apiKey: "sk-ant-test", baseURL: fake.url });
const args = { model: "claude-test", instructions: "You are Nova.", turns: [{ role: "user" as const, content: "Hi" }], signal: AbortSignal.timeout(5000) };
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

test("streams text and reports final usage", async () => {
  expect(await collect(client().stream(args))).toEqual([
    { type: "delta", text: "Hello" },
    { type: "delta", text: " owner" },
    { type: "done", usage: { inputTokens: 21, outputTokens: 7 }, model: "claude-test" },
  ]);
  const req = fake.requests.at(-1)!;
  expect(req.headers["x-api-key"]).toBe("sk-ant-test");
  expect(req.body).toMatchObject({ model: "claude-test", max_tokens: 16000, system: "You are Nova.", messages: [{ role: "user", content: "Hi" }] });
  expect(req.body).not.toHaveProperty("thinking");
});

test("a refusal becomes a 'refused' error", async () => {
  fake.routes["POST /v1/messages"] = (_q, res) => sse(res, messageEvents([], "refusal"));
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "refused" });
});

test("SDK errors map to provider errors", async () => {
  fake.routes["POST /v1/messages"] = (_q, res) => json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "auth" });
  fake.routes["POST /v1/messages"] = (_q, res) => json(res, 429, { type: "error", error: { type: "rate_limit_error", message: "slow" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "rate_limited" });
  fake.routes["POST /v1/messages"] = (_q, res) => json(res, 404, { type: "error", error: { type: "not_found_error", message: "model" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "model_unavailable" });
});

test("lists models with display names", async () => {
  expect(await client().listModels(AbortSignal.timeout(5000))).toEqual([{ id: "claude-test", label: "Claude Test" }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/provider-anthropic.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `backend/src/providers/anthropic.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { errorFromStatus, ProviderError, type ProviderClient } from "./types.js";

function mapError(e: unknown, signal: AbortSignal): unknown {
  if (e instanceof ProviderError) return e;
  if (signal.aborted || e instanceof Anthropic.APIUserAbortError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", "The provider took too long to respond.");
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("network", "Couldn't reach Anthropic.");
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: string } } | undefined;
    return errorFromStatus(e.status ?? 500, body?.error?.message ?? e.message);
  }
  return new ProviderError("unavailable", "Anthropic sent a reply that couldn't be read.");
}

/** Claude through the official SDK. baseURL is only set by tests. */
export function anthropicClient(opts: { apiKey: string; baseURL?: string }): ProviderClient {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0, timeout: 300_000 });
  return {
    async listModels(signal) {
      try {
        const out = [];
        for await (const m of client.models.list({}, { signal })) out.push({ id: m.id, label: m.display_name });
        return out;
      } catch (e) {
        throw mapError(e, signal);
      }
    },
    async *stream({ model, instructions, turns, signal }) {
      try {
        const stream = client.messages.stream({ model, max_tokens: 16000, system: instructions, messages: turns }, { signal });
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { type: "delta", text: ev.delta.text };
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          throw new ProviderError("refused", message.stop_details?.explanation || "Claude declined this request.");
        }
        yield { type: "done", usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }, model: message.model };
      } catch (e) {
        throw mapError(e, signal);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests and type check**

Run: `cd backend && npx vitest run test/provider-anthropic.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 4 passed, `TSC_OK`. If the SDK's error object shape differs, adjust only `mapError`'s message extraction; the codes are asserted by the test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/providers/anthropic.ts backend/test/provider-anthropic.test.ts
git commit -m "feat(backend): Anthropic adapter on the official SDK"
```

---

### Task 6: Connection routes

**Files:**
- Create: `backend/src/providers/index.ts`, `backend/src/routes/connections.ts`, `backend/test/connections.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: adapters, `encryptSecret`, `decryptSecret`, `SecretError`, `checkBaseUrl`, `UnsafeUrlError`, `testOverride`, `requireMember`, `audit`, `HttpError`, `WsParams`, `Name`.
- Produces:
  - `type ConnectionLike = { id: string; kind: ProviderKind; baseUrl: string | null; secret: string | null }`
  - `clientFor(conn: ConnectionLike): ProviderClient` (the `chatgpt` case is completed in Task 7; until then it throws `ProviderError("unsupported", ...)`)
  - `PRESETS`
  - Routes: `GET/POST /api/workspaces/:id/connections`, `PATCH/DELETE /api/workspaces/:id/connections/:cid`, `POST .../:cid/test`, `GET .../:cid/models`
  - `connectionDTO(c, totals?)` exported for Task 7.
  - DELETE responds `200 { revoked: boolean | null }` (`null` for non-ChatGPT).

- [ ] **Step 1: Write the failing tests**

`backend/test/connections.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";
import { fakeServer, json } from "./fake-provider.js";

const app = await makeApp();
const fake = await fakeServer({
  "GET /v1/models": (q, res) => (q.headers.authorization === "Bearer sk-good-1234" || !q.headers.authorization ? json(res, 200, { data: [{ id: "m-1" }, { id: "m-2" }] }) : json(res, 401, { error: { message: "bad key" } })),
});
afterAll(async () => {
  await fake.close();
  await app.close();
});
beforeEach(() => {
  process.env.TEST_OPENAI_BASE_URL = `${fake.url}/v1`;
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
});

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Conn Co", template: "starter" })).json().id as string;
  return { req, id };
}

test("owner adds an OpenAI key: tested, saved encrypted, never returned", async () => {
  const { req, id } = await owner();
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "My OpenAI", apiKey: "sk-good-1234" });
  expect(res.statusCode).toBe(201);
  const list = await req("GET", `/api/workspaces/${id}/connections`);
  expect(list.body).not.toContain("sk-good-1234");
  expect(list.json().connections[0]).toMatchObject({ kind: "openai", label: "My OpenAI", hint: "sk-…1234", status: "connected" });
  const row = await prisma.providerConnection.findFirstOrThrow({ where: { workspaceId: id } });
  expect(row.secret!.startsWith("v1:")).toBe(true);
  expect(row.secret).not.toContain("sk-good");
});

test("a rejected key is not saved and the reason is shown", async () => {
  const { req, id } = await owner();
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "Bad", apiKey: "sk-bad-9999" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/rejected the key/);
  expect(await prisma.providerConnection.count({ where: { workspaceId: id } })).toBe(0);
});

test("custom endpoint without a key uses the host as the hint", async () => {
  const { req, id } = await owner();
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "Local", baseUrl: `${fake.url}/v1/` });
  expect(res.statusCode).toBe(201);
  const c = (await req("GET", `/api/workspaces/${id}/connections`)).json().connections[0];
  expect(c).toMatchObject({ kind: "custom", baseUrl: `${fake.url}/v1`, hint: new URL(fake.url).host });
});

test("private custom URL is refused when local endpoints are not allowed", async () => {
  const { req, id } = await owner();
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
  const res = await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "Sneaky", baseUrl: "https://169.254.169.254/latest" });
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/private network/);
});

test("validation: key required for key providers, URL required for custom", async () => {
  const { req, id } = await owner();
  expect((await req("POST", `/api/workspaces/${id}/connections`, { kind: "anthropic", label: "A" })).statusCode).toBe(400);
  expect((await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "C" })).statusCode).toBe(400);
  expect((await req("POST", `/api/workspaces/${id}/connections`, { kind: "chatgpt", label: "G", apiKey: "x" })).statusCode).toBe(400);
});

test("roles: member cannot add, viewer can list, stranger gets 404", async () => {
  const { req, id } = await owner();
  const member = await signUp(app);
  const viewer = await signUp(app);
  for (const [u, role] of [[member, "member"], [viewer, "viewer"]] as const) {
    const me = (await client(app, u.cookie)("GET", "/api/me")).json();
    await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role } });
  }
  expect((await client(app, member.cookie)("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "X", apiKey: "sk-good-1234" })).statusCode).toBe(403);
  expect((await client(app, viewer.cookie)("GET", `/api/workspaces/${id}/connections`)).statusCode).toBe(200);
  const stranger = await signUp(app);
  expect((await client(app, stranger.cookie)("GET", `/api/workspaces/${id}/connections`)).statusCode).toBe(404);
  await req("GET", `/api/workspaces/${id}`);
});

test("test, models, rename, replace key", async () => {
  const { req, id } = await owner();
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "O", apiKey: "sk-good-1234" })).json().id;
  expect((await req("POST", `/api/workspaces/${id}/connections/${cid}/test`)).json()).toEqual({ ok: true, models: 2 });
  expect((await req("GET", `/api/workspaces/${id}/connections/${cid}/models`)).json().models).toEqual([{ id: "m-1", label: "m-1" }, { id: "m-2", label: "m-2" }]);
  expect((await req("PATCH", `/api/workspaces/${id}/connections/${cid}`, { apiKey: "sk-bad-0000" })).statusCode).toBe(400);
  expect((await req("PATCH", `/api/workspaces/${id}/connections/${cid}`, { label: "Renamed" })).statusCode).toBe(200);
  expect((await req("GET", `/api/workspaces/${id}/connections`)).json().connections[0].label).toBe("Renamed");
});

test("failed test marks the connection as error with the reason", async () => {
  const { req, id } = await owner();
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "O", apiKey: "sk-good-1234" })).json().id;
  fake.routes["GET /v1/models"] = (_q, res) => json(res, 503, {});
  const r = (await req("POST", `/api/workspaces/${id}/connections/${cid}/test`)).json();
  expect(r).toMatchObject({ ok: false });
  const c = (await req("GET", `/api/workspaces/${id}/connections`)).json().connections[0];
  expect(c).toMatchObject({ status: "error", lastError: expect.stringMatching(/trouble/) });
  fake.routes["GET /v1/models"] = (_q, res) => json(res, 200, { data: [{ id: "m-1" }, { id: "m-2" }] });
});

test("removing a connection unassigns companions that use it", async () => {
  const { req, id } = await owner();
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "openai", label: "O", apiKey: "sk-good-1234" })).json().id;
  const agent = await prisma.agent.findFirstOrThrow({ where: { workspaceId: id } });
  await prisma.agent.update({ where: { id: agent.id }, data: { connectionId: cid, model: "m-1" } });
  const del = await req("DELETE", `/api/workspaces/${id}/connections/${cid}`);
  expect(del.statusCode).toBe(200);
  expect(del.json()).toEqual({ revoked: null });
  expect((await prisma.agent.findUniqueOrThrow({ where: { id: agent.id } })).connectionId).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/connections.test.ts`
Expected: FAIL, 404 on the connection routes.

- [ ] **Step 3: Write `backend/src/providers/index.ts`**

```ts
import { decryptSecret } from "../crypto.js";
import { testOverride } from "../env.js";
import type { ProviderKind } from "../generated/prisma/client.js";
import { anthropicClient } from "./anthropic.js";
import { openAiChatClient } from "./openai-chat.js";
import { openAiResponsesClient } from "./openai-responses.js";
import { ProviderError, type ProviderClient } from "./types.js";

export const PRESETS = {
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
} as const;

export type ConnectionLike = { id: string; kind: ProviderKind; baseUrl: string | null; secret: string | null };

export const openaiBase = () => testOverride("TEST_OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
const geminiBase = () => testOverride("TEST_GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai";

export function clientFor(conn: ConnectionLike): ProviderClient {
  const secret = conn.secret ? decryptSecret(conn.secret) : null;
  switch (conn.kind) {
    case "openai":
      return openAiResponsesClient({ baseUrl: openaiBase(), token: async () => secret ?? "", modelList: "api" });
    case "anthropic":
      return anthropicClient({ apiKey: secret ?? "", baseURL: testOverride("TEST_ANTHROPIC_BASE_URL") });
    case "gemini":
      return openAiChatClient({ baseUrl: geminiBase(), apiKey: secret });
    case "custom":
      return openAiChatClient({ baseUrl: conn.baseUrl ?? "", apiKey: secret });
    case "chatgpt":
      throw new ProviderError("unsupported", "ChatGPT connections are not available yet.");
  }
}
```

- [ ] **Step 4: Write `backend/src/routes/connections.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptSecret, SecretError } from "../crypto.js";
import { prisma } from "../db.js";
import type { ProviderConnection } from "../generated/prisma/client.js";
import { audit, HttpError, requireMember } from "../http.js";
import { clientFor } from "../providers/index.js";
import { ProviderError } from "../providers/types.js";
import { checkBaseUrl, UnsafeUrlError } from "../safe-fetch.js";
import { Name, WsParams } from "./workspaces.js";

const ConnParams = WsParams.extend({ cid: z.string().min(1).max(64) });
const ApiKey = z.string().trim().min(1).max(500);
const CreateConnection = z
  .object({ kind: z.enum(["openai", "anthropic", "gemini", "custom"]), label: Name, apiKey: ApiKey.optional(), baseUrl: z.string().trim().min(1).max(500).optional() })
  .superRefine((v, ctx) => {
    if (v.kind !== "custom" && !v.apiKey) ctx.addIssue({ code: "custom", path: ["apiKey"], message: "An API key is required" });
    if (v.kind === "custom" && !v.baseUrl) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "A base URL is required" });
  });
const UpdateConnection = z.object({ label: Name.optional(), apiKey: ApiKey.optional() });

const keyHint = (k: string) => (k.length >= 10 ? `${k.slice(0, 3)}…${k.slice(-4)}` : `…${k.slice(-2)}`);
const plainMessage = (e: unknown) =>
  e instanceof ProviderError || e instanceof UnsafeUrlError || e instanceof SecretError ? e.message : "Couldn't check this connection.";

export function connectionDTO(c: ProviderConnection, totals?: { inputTokens: number; outputTokens: number }) {
  return {
    id: c.id,
    kind: c.kind,
    label: c.label,
    baseUrl: c.baseUrl,
    hint: c.hint,
    status: c.status,
    lastCheckedAt: c.lastCheckedAt,
    lastError: c.lastError,
    inputTokens: totals?.inputTokens ?? 0,
    outputTokens: totals?.outputTokens ?? 0,
  };
}

async function probe(conn: Parameters<typeof clientFor>[0]) {
  try {
    return { ok: true as const, models: (await clientFor(conn).listModels(AbortSignal.timeout(20_000))).length };
  } catch (e) {
    return { ok: false as const, error: e };
  }
}

async function loadConnection(workspaceId: string, cid: string) {
  const c = await prisma.providerConnection.findFirst({ where: { id: cid, workspaceId } });
  if (!c) throw new HttpError(404, "not_found", "Connection not found");
  return c;
}

export async function connectionRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/connections", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    const [rows, sums] = await Promise.all([
      prisma.providerConnection.findMany({ where: { workspaceId: id }, orderBy: { createdAt: "asc" } }),
      prisma.chatMessage.groupBy({ by: ["connectionId"], where: { workspaceId: id }, _sum: { inputTokens: true, outputTokens: true } }),
    ]);
    const totals = new Map(sums.map((s) => [s.connectionId, { inputTokens: s._sum.inputTokens ?? 0, outputTokens: s._sum.outputTokens ?? 0 }]));
    return { connections: rows.map((c) => connectionDTO(c, totals.get(c.id))), chatgptLocalLogin: process.env.CHATGPT_LOCAL_LOGIN === "true" };
  });

  app.post("/api/workspaces/:id/connections", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const body = CreateConnection.parse(req.body);
    let baseUrl: string | null = null;
    try {
      baseUrl = body.kind === "custom" ? checkBaseUrl(body.baseUrl!) : null;
    } catch (e) {
      throw new HttpError(400, "invalid", plainMessage(e));
    }
    const secret = body.apiKey ? encryptSecret(body.apiKey) : null;
    const result = await probe({ id: "new", kind: body.kind, baseUrl, secret });
    if (!result.ok) throw new HttpError(400, "connection_failed", plainMessage(result.error));
    const created = await prisma.providerConnection.create({
      data: {
        workspaceId: id,
        kind: body.kind,
        label: body.label,
        baseUrl,
        secret,
        hint: body.apiKey ? keyHint(body.apiKey) : new URL(baseUrl!).host,
        status: "connected",
        lastCheckedAt: new Date(),
        createdById: user.id,
      },
    });
    await audit(prisma, id, user.id, "connection.create", "connection", created.id, { kind: body.kind });
    return reply.code(201).send({ id: created.id });
  });

  app.patch("/api/workspaces/:id/connections/:cid", async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const body = UpdateConnection.parse(req.body);
    const conn = await loadConnection(id, cid);
    const data: { label?: string; secret?: string; hint?: string; status?: "connected"; lastCheckedAt?: Date; lastError?: null } = {};
    if (body.label) data.label = body.label;
    if (body.apiKey) {
      if (conn.kind === "chatgpt") throw new HttpError(400, "invalid", "ChatGPT connections use sign-in, not a key");
      const secret = encryptSecret(body.apiKey);
      const result = await probe({ ...conn, secret });
      if (!result.ok) throw new HttpError(400, "connection_failed", plainMessage(result.error));
      Object.assign(data, { secret, hint: keyHint(body.apiKey), status: "connected", lastCheckedAt: new Date(), lastError: null });
    }
    await prisma.providerConnection.update({ where: { id: cid }, data });
    await audit(prisma, id, user.id, "connection.update", "connection", cid, { fields: Object.keys(body) });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/connections/:cid", async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    await loadConnection(id, cid);
    // Companions using it keep their identity; the foreign key clears connectionId.
    await prisma.providerConnection.delete({ where: { id: cid } });
    await audit(prisma, id, user.id, "connection.delete", "connection", cid);
    return { revoked: null };
  });

  app.post("/api/workspaces/:id/connections/:cid/test", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    await requireMember(req, id, "admin");
    const conn = await loadConnection(id, cid);
    const result = await probe(conn);
    const reauth = !result.ok && result.error instanceof ProviderError && result.error.code === "reauth";
    await prisma.providerConnection.update({
      where: { id: cid },
      data: { status: result.ok ? "connected" : reauth ? "reauth" : "error", lastCheckedAt: new Date(), lastError: result.ok ? null : plainMessage(result.error) },
    });
    return result.ok ? result : { ok: false, error: plainMessage(result.error) };
  });

  app.get("/api/workspaces/:id/connections/:cid/models", async (req) => {
    const { id, cid } = ConnParams.parse(req.params);
    await requireMember(req, id, "member");
    const conn = await loadConnection(id, cid);
    try {
      return { models: await clientFor(conn).listModels(AbortSignal.timeout(20_000)) };
    } catch (e) {
      throw new HttpError(502, "provider_error", plainMessage(e));
    }
  });
}
```

- [ ] **Step 5: Register in `backend/src/app.ts`**

Add `import { connectionRoutes } from "./routes/connections.js";` and `await app.register(connectionRoutes);` after `agentRoutes`. Also add log redaction to the Fastify constructor: change `logger: !process.env.VITEST` to `logger: process.env.VITEST ? false : { redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-api-key\"]"] }`.

- [ ] **Step 6: Run tests and type check**

Run: `cd backend && npx vitest run test/connections.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 9 passed, `TSC_OK`.

- [ ] **Step 7: Commit**

```bash
git add backend/src backend/test/connections.test.ts
git commit -m "feat(backend): provider connection routes with encrypted keys and live checks"
```

---

### Task 7: Sign in with ChatGPT

**Files:**
- Create: `backend/src/chatgpt-oauth.ts`, `backend/src/routes/chatgpt.ts`, `backend/test/chatgpt.test.ts`
- Modify: `backend/src/providers/index.ts` (chatgpt case), `backend/src/routes/connections.ts` (DELETE revokes), `backend/src/app.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `testOverride`, `prisma`, `openAiResponsesClient`, `openaiBase`, `ProviderError`, `connectionDTO`, `requireMember`, `audit`, `HttpError`.
- Produces: `localLoginEnabled()`, `redirectUri()`, `startAuthorization(p)`, `completeAuthorization(query)`, `chatgptAccessToken(connectionId)`, `revoke(secret)`, `type ChatgptSecret`, `class OAuthError`, routes `POST /api/workspaces/:id/connections/chatgpt/start`, `GET /auth/callback`.

- [ ] **Step 1: Write the failing tests**

`backend/test/chatgpt.test.ts`:

```ts
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeEach, expect, test } from "vitest";
import { chatgptAccessToken, type ChatgptSecret } from "../src/chatgpt-oauth.js";
import { decryptSecret, encryptSecret } from "../src/crypto.js";
import { prisma } from "../src/db.js";
import { clientFor } from "../src/providers/index.js";
import { client, makeApp, signUp } from "./helpers.js";
import { fakeServer, json } from "./fake-provider.js";

const ISSUER = "https://auth.openai.com";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
let tokenReply: (form: Record<string, string>) => [number, unknown] = () => [500, {}];
let nonceSeen = "";

const idToken = (clientId: string, nonce: string, sub = "user-sub-1") =>
  new SignJWT({ email: "asha@example.com", nonce })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(clientId)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

const auth = await fakeServer({
  "GET /.well-known/openid-configuration": (_q, res) => json(res, 200, { issuer: ISSUER, jwks_uri: `${auth.url}/jwks`, revocation_endpoint: `${auth.url}/revoke` }),
  "GET /jwks": (_q, res) => json(res, 200, { keys: [jwk] }),
  "POST /api/accounts/oauth/token": (q, res) => {
    const [status, body] = tokenReply(q.body as Record<string, string>);
    json(res, status, body);
  },
  "POST /revoke": (_q, res) => res.writeHead(200).end(),
  "GET /v1/models": (q, res) => json(res, q.headers.authorization === "Bearer access-2" || q.headers.authorization === "Bearer access-1" ? 200 : 401, { models: [{ slug: "gpt-a", display_name: "GPT A", visibility: "list" }] }),
});
const app = await makeApp();
afterAll(async () => {
  await auth.close();
  await app.close();
});
beforeEach(() => {
  process.env.TEST_OPENAI_AUTH_BASE = auth.url;
  process.env.TEST_OPENAI_ISSUER = ISSUER;
  process.env.TEST_OPENAI_BASE_URL = `${auth.url}/v1`;
  process.env.CHATGPT_LOCAL_LOGIN = "true";
  process.env.FRONTEND_URL = "http://localhost:3000";
  tokenReply = (form) => [200, { access_token: "access-1", refresh_token: "refresh-1", id_token: "", expires_in: 3600, scope: "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke", ...form }];
});

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const ws = (await req("POST", "/api/workspaces", { name: "Plan Co", template: "head-only" })).json() as { id: string; slug: string };
  return { req, ...ws };
}

async function signInFlow(req: ReturnType<typeof client>, id: string, opts: { scope?: string; callback?: Record<string, string>; badNonce?: boolean } = {}) {
  const start = await req("POST", `/api/workspaces/${id}/connections/chatgpt/start`, {});
  const url = new URL(start.json().url);
  const state = url.searchParams.get("state")!;
  nonceSeen = url.searchParams.get("nonce")!;
  tokenReply = (form) => [
    200,
    {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: opts.scope ?? "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
      id_token: "pending",
      _form: form,
    },
  ];
  const clientId = "oaiapp_test123";
  const token = await idToken(clientId, opts.badNonce ? "wrong" : nonceSeen);
  const base = tokenReply;
  tokenReply = (form) => {
    const [s, b] = base(form);
    return [s, { ...(b as object), id_token: token }];
  };
  const q = new URLSearchParams({ code: "code-1", state, client_id: clientId, ...opts.callback });
  return { start, url, cb: await app.inject({ method: "GET", url: `/auth/callback?${q}` }) };
}

test("start builds the documented authorization URL", async () => {
  const { req, id } = await owner();
  const { url } = await signInFlow(req, id);
  const p = url.searchParams;
  expect(url.origin + url.pathname).toBe(`${auth.url}/api/accounts/authorize`);
  expect(p.get("client_id")).toBe("dynamic_agent_client");
  expect(p.get("agent_name_hint")).toBe("Agent Company");
  expect(p.get("ext_agent_host_id")).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  expect(p.get("response_type")).toBe("code");
  expect(p.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  expect(p.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
  expect(p.get("resource")).toBe("https://api.openai.com/v1");
  expect(p.get("code_challenge_method")).toBe("S256");
  expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("successful sign-in saves an encrypted ChatGPT connection and redirects to the providers page", async () => {
  const { req, id, slug } = await owner();
  const { cb } = await signInFlow(req, id);
  expect(cb.statusCode).toBe(302);
  expect(cb.headers.location).toBe(`http://localhost:3000/w/${slug}/providers?connected=chatgpt`);
  const conn = await prisma.providerConnection.findFirstOrThrow({ where: { workspaceId: id, kind: "chatgpt" } });
  expect(conn).toMatchObject({ hint: "asha@example.com", status: "connected" });
  expect(conn.secret).not.toContain("access-1");
  const secret = JSON.parse(decryptSecret(conn.secret!)) as ChatgptSecret;
  expect(secret).toMatchObject({ clientId: "oaiapp_test123", subject: "user-sub-1", accessToken: "access-1", refreshToken: "refresh-1" });
  const exchange = auth.requests.find((r) => r.path === "/api/accounts/oauth/token")!.body as Record<string, string>;
  expect(exchange).toMatchObject({ grant_type: "authorization_code", client_id: "oaiapp_test123", code: "code-1", resource: "https://api.openai.com/v1" });
  expect(exchange.code_verifier).toBeTruthy();
});

test.each([
  ["declined consent", { callback: { error: "access_denied" } }, /wasn't allowed/],
  ["missing plan scope", { scope: "openid email profile" }, /wasn't granted/],
  ["wrong nonce", { badNonce: true }, /didn't match/],
])("%s saves nothing and explains why", async (_name, opts, message) => {
  const { req, id } = await owner();
  const { cb } = await signInFlow(req, id, opts);
  expect(cb.statusCode).toBe(302);
  expect(decodeURIComponent(cb.headers.location as string)).toMatch(message);
  expect(await prisma.providerConnection.count({ where: { workspaceId: id } })).toBe(0);
});

test("unknown state is rejected", async () => {
  const cb = await app.inject({ method: "GET", url: "/auth/callback?code=x&state=nope" });
  expect(cb.statusCode).toBe(302);
  expect(decodeURIComponent(cb.headers.location as string)).toMatch(/expired/);
});

test("disabled local login explains the hosted limitation", async () => {
  const { req, id } = await owner();
  process.env.CHATGPT_LOCAL_LOGIN = "false";
  const res = await req("POST", `/api/workspaces/${id}/connections/chatgpt/start`, {});
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/local or self-hosted/);
});

async function savedConnection(id: string, expiresIn: number) {
  const secret: ChatgptSecret = { clientId: "oaiapp_x", subject: "s", email: "a@b.c", idToken: "id", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + expiresIn, scopes: ["chatgpt.tokens.use.direct"] };
  return prisma.providerConnection.create({ data: { workspaceId: id, kind: "chatgpt", label: "ChatGPT", secret: encryptSecret(JSON.stringify(secret)), hint: "a@b.c", createdById: (await prisma.membership.findFirstOrThrow({ where: { workspaceId: id } })).userId } });
}

test("an access token close to expiry is refreshed and the new tokens are saved", async () => {
  const { id } = await owner();
  const conn = await savedConnection(id, 60_000);
  tokenReply = () => [200, { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600, scope: "chatgpt.tokens.use.direct" }];
  expect(await chatgptAccessToken(conn.id)).toBe("access-2");
  const refresh = auth.requests.filter((r) => r.path === "/api/accounts/oauth/token").at(-1)!.body as Record<string, string>;
  expect(refresh).toMatchObject({ grant_type: "refresh_token", client_id: "oaiapp_x", refresh_token: "refresh-1", resource: "https://api.openai.com/v1" });
  expect(refresh).not.toHaveProperty("scope");
  const saved = JSON.parse(decryptSecret((await prisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } })).secret!));
  expect(saved).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
});

test("a terminal refresh error marks the connection as needing sign-in", async () => {
  const { id } = await owner();
  const conn = await savedConnection(id, 0);
  tokenReply = () => [400, { error: "invalid_grant" }];
  await expect(chatgptAccessToken(conn.id)).rejects.toMatchObject({ code: "reauth" });
  expect((await prisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe("reauth");
});

test("ChatGPT models come from the account's catalog", async () => {
  const { id } = await owner();
  const conn = await savedConnection(id, 3_600_000);
  expect(await clientFor(conn).listModels(AbortSignal.timeout(5000))).toEqual([{ id: "gpt-a", label: "GPT A" }]);
});

test("removing a ChatGPT connection revokes the refresh token", async () => {
  const { req, id } = await owner();
  const conn = await savedConnection(id, 3_600_000);
  const res = await req("DELETE", `/api/workspaces/${id}/connections/${conn.id}`);
  expect(res.json()).toEqual({ revoked: true });
  const rev = auth.requests.filter((r) => r.path === "/revoke").at(-1)!.body as Record<string, string>;
  expect(rev).toEqual({ token: "refresh-1", token_type_hint: "refresh_token", client_id: "oaiapp_x" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/chatgpt.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `backend/src/chatgpt-oauth.ts`**

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { prisma } from "./db.js";
import { testOverride } from "./env.js";
import { ProviderError } from "./providers/types.js";

export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const authBase = () => testOverride("TEST_OPENAI_AUTH_BASE") ?? "https://auth.openai.com";
const issuer = () => testOverride("TEST_OPENAI_ISSUER") ?? "https://auth.openai.com";

export const localLoginEnabled = () => process.env.CHATGPT_LOCAL_LOGIN === "true";
export const redirectUri = () => `http://127.0.0.1:${process.env.PORT ?? 4000}/auth/callback`;

export type ChatgptSecret = {
  clientId: string;
  subject: string;
  email: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
};

export class OAuthError extends Error {
  constructor(
    message: string,
    public pending?: Pending,
  ) {
    super(message);
  }
}
class TokenError extends Error {
  constructor(
    public error: string,
    public status: number,
  ) {
    super(error);
  }
}

// One stable, opaque ID per install, as OpenAI requires. Not a user identifier.
const HOST_FILE = new URL("../data/chatgpt-host-id", import.meta.url);
export async function hostId() {
  try {
    return (await readFile(HOST_FILE, "utf8")).trim();
  } catch {
    const id = `urn:uuid:${randomUUID()}`;
    await mkdir(new URL("./", HOST_FILE), { recursive: true });
    await writeFile(HOST_FILE, id, { mode: 0o600 });
    return id;
  }
}

type Pending = { userId: string; workspaceId: string; slug: string; verifier: string; nonce: string; connectionId: string | null; clientId: string | null; subject: string | null; expires: number };
// ponytail: in-memory, single process; an attempt is lost on restart and the user simply clicks again.
const pending = new Map<string, Pending>();
const b64url = (b: Buffer) => b.toString("base64url");

export async function startAuthorization(p: { userId: string; workspaceId: string; slug: string; connectionId: string | null; clientId: string | null; subject: string | null; idTokenHint?: string }) {
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(32));
  const { idTokenHint, ...rest } = p;
  pending.set(state, { ...rest, verifier, nonce, expires: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({
    client_id: p.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: await hostId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  });
  if (!p.clientId) q.set("agent_name_hint", "Agent Company");
  if (idTokenHint) q.set("id_token_hint", idTokenHint);
  return `${authBase()}/api/accounts/authorize?${q}`;
}

let discovered: { base: string; jwks: ReturnType<typeof createRemoteJWKSet>; revocation: string } | null = null;
async function discovery() {
  if (discovered?.base === authBase()) return discovered;
  const res = await fetch(`${authBase()}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
  const cfg = (await res.json()) as { jwks_uri: string; revocation_endpoint: string };
  discovered = { base: authBase(), jwks: createRemoteJWKSet(new URL(cfg.jwks_uri)), revocation: cfg.revocation_endpoint };
  return discovered;
}

async function tokenRequest(form: Record<string, string>) {
  const res = await fetch(`${authBase()}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new TokenError(String(body.error ?? res.status), res.status);
  return body as { access_token: string; refresh_token?: string; id_token: string; expires_in: number; scope?: string };
}

export async function completeAuthorization(query: Record<string, string | undefined>) {
  const p = query.state ? pending.get(query.state) : undefined;
  if (!p || p.expires < Date.now()) throw new OAuthError("This ChatGPT sign-in expired. Start again from AI providers.");
  pending.delete(query.state!);
  if (query.error === "access_denied") throw new OAuthError("ChatGPT plan use wasn't allowed, so nothing was connected.", p);
  if (query.error) throw new OAuthError(`ChatGPT sign-in failed (${query.error}).`, p);
  if (p.clientId && query.client_id && query.client_id !== p.clientId) throw new OAuthError("OpenAI returned a different app registration, so nothing was changed.", p);
  const clientId = p.clientId ?? query.client_id;
  if (!clientId) throw new OAuthError("OpenAI didn't finish registering the app. Try again.", p);
  if (!query.code) throw new OAuthError("OpenAI didn't return a sign-in code. Try again.", p);

  let tokens;
  try {
    tokens = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code: query.code, code_verifier: p.verifier, redirect_uri: redirectUri(), resource: RESOURCE });
  } catch {
    throw new OAuthError("OpenAI didn't accept the sign-in. Try again.", p);
  }
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(tokens.id_token, (await discovery()).jwks, { issuer: issuer(), audience: clientId }));
  } catch {
    throw new OAuthError("The sign-in response couldn't be verified. Try again.", p);
  }
  if (claims.nonce !== p.nonce) throw new OAuthError("The sign-in response didn't match this attempt. Try again.", p);
  if (p.subject && claims.sub !== p.subject) throw new OAuthError("You signed in with a different ChatGPT account, so nothing was changed.", p);
  const scopes = String(tokens.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(PLAN_SCOPE)) throw new OAuthError("ChatGPT plan use wasn't granted, so nothing was connected.", p);
  const secret: ChatgptSecret = {
    clientId,
    subject: String(claims.sub),
    email: String(claims.email ?? ""),
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scopes,
  };
  return { pending: p, secret };
}

const TERMINAL = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
const refreshing = new Map<string, Promise<string>>();

/** Returns a usable access token, refreshing (serialized per connection) when it expires within 5 minutes. */
export function chatgptAccessToken(connectionId: string): Promise<string> {
  const running = refreshing.get(connectionId);
  if (running) return running;
  const job = (async () => {
    const conn = await prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const s = JSON.parse(decryptSecret(conn.secret!)) as ChatgptSecret;
    if (s.expiresAt - Date.now() > 5 * 60_000) return s.accessToken;
    try {
      const t = await tokenRequest({ grant_type: "refresh_token", client_id: s.clientId, refresh_token: s.refreshToken, resource: RESOURCE });
      const next: ChatgptSecret = { ...s, accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expiresAt: Date.now() + t.expires_in * 1000, scopes: t.scope ? t.scope.split(" ") : s.scopes };
      await prisma.providerConnection.update({ where: { id: connectionId }, data: { secret: encryptSecret(JSON.stringify(next)), status: "connected", lastError: null } });
      return next.accessToken;
    } catch (e) {
      if (e instanceof TokenError && TERMINAL.has(e.error)) {
        await prisma.providerConnection.update({ where: { id: connectionId }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
        throw new ProviderError("reauth", "Sign in to ChatGPT again to keep using it.");
      }
      throw new ProviderError("unavailable", "Couldn't renew the ChatGPT session. Try again shortly.");
    }
  })().finally(() => refreshing.delete(connectionId));
  refreshing.set(connectionId, job);
  return job;
}

/** Ends the renewable session. Returns false when revocation couldn't be confirmed. */
export async function revoke(secret: ChatgptSecret): Promise<boolean> {
  try {
    const res = await fetch((await discovery()).revocation, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: secret.refreshToken, token_type_hint: "refresh_token", client_id: secret.clientId }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Write `backend/src/routes/chatgpt.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { completeAuthorization, localLoginEnabled, OAuthError, startAuthorization, type ChatgptSecret } from "../chatgpt-oauth.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import { prisma } from "../db.js";
import { audit, HttpError, requireMember } from "../http.js";
import { WsParams } from "./workspaces.js";

const frontend = () => process.env.FRONTEND_URL ?? "http://localhost:3000";

export async function chatgptRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/connections/chatgpt/start", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    if (!localLoginEnabled()) {
      throw new HttpError(400, "unavailable", "ChatGPT sign-in works only on a local or self-hosted install. A hosted site needs OpenAI's approval first.");
    }
    const { connectionId } = z.object({ connectionId: z.string().max(64).optional() }).parse(req.body ?? {});
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id }, select: { slug: true } });
    let existing: ChatgptSecret | null = null;
    if (connectionId) {
      const conn = await prisma.providerConnection.findFirst({ where: { id: connectionId, workspaceId: id, kind: "chatgpt" } });
      if (!conn) throw new HttpError(404, "not_found", "Connection not found");
      existing = JSON.parse(decryptSecret(conn.secret!)) as ChatgptSecret;
    }
    const url = await startAuthorization({
      userId: user.id,
      workspaceId: id,
      slug: ws.slug,
      connectionId: connectionId ?? null,
      clientId: existing?.clientId ?? null,
      subject: existing?.subject ?? null,
      idTokenHint: existing?.idToken,
    });
    return { url };
  });

  // The browser lands here directly on 127.0.0.1 (OpenAI's loopback rule). Not logged: the URL carries the code.
  app.get("/auth/callback", { logLevel: "silent" }, async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    try {
      const { pending, secret } = await completeAuthorization(query);
      const data = { secret: encryptSecret(JSON.stringify(secret)), hint: secret.email, status: "connected" as const, lastCheckedAt: new Date(), lastError: null };
      if (pending.connectionId) {
        await prisma.providerConnection.update({ where: { id: pending.connectionId }, data });
      } else {
        const conn = await prisma.providerConnection.create({ data: { ...data, workspaceId: pending.workspaceId, kind: "chatgpt", label: "ChatGPT", createdById: pending.userId } });
        await audit(prisma, pending.workspaceId, pending.userId, "connection.create", "connection", conn.id, { kind: "chatgpt" });
      }
      return reply.redirect(`${frontend()}/w/${pending.slug}/providers?connected=chatgpt`);
    } catch (e) {
      const message = e instanceof OAuthError ? e.message : "ChatGPT sign-in failed. Try again.";
      const p = e instanceof OAuthError ? e.pending : undefined;
      const target = p ? `/w/${p.slug}/providers` : "/app";
      return reply.redirect(`${frontend()}${target}?chatgpt_error=${encodeURIComponent(message)}`);
    }
  });
}
```

- [ ] **Step 5: Wire the chatgpt case and revocation**

In `backend/src/providers/index.ts`, add `import { chatgptAccessToken } from "../chatgpt-oauth.js";` and replace the `chatgpt` case with:

```ts
    case "chatgpt":
      return openAiResponsesClient({ baseUrl: openaiBase(), token: () => chatgptAccessToken(conn.id), modelList: "chatgpt" });
```

In `backend/src/routes/connections.ts`, add `import { revoke, type ChatgptSecret } from "../chatgpt-oauth.js";` and `import { decryptSecret } from "../crypto.js";` (merge with the existing crypto import), and replace the DELETE handler body after `requireMember` with:

```ts
    const conn = await loadConnection(id, cid);
    let revoked: boolean | null = null;
    if (conn.kind === "chatgpt" && conn.secret) {
      try {
        revoked = await revoke(JSON.parse(decryptSecret(conn.secret)) as ChatgptSecret);
      } catch {
        revoked = false;
      }
    }
    // Companions using it keep their identity; the foreign key clears connectionId.
    await prisma.providerConnection.delete({ where: { id: cid } });
    await audit(prisma, id, user.id, "connection.delete", "connection", cid, { revoked });
    return { revoked };
```

Register `chatgptRoutes` in `backend/src/app.ts` after `connectionRoutes`.

- [ ] **Step 6: Run tests and type check**

Run: `cd backend && npx vitest run test/chatgpt.test.ts test/connections.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: all pass, `TSC_OK`.

- [ ] **Step 7: Commit**

```bash
git add backend/src backend/test/chatgpt.test.ts
git commit -m "feat(backend): Sign in with ChatGPT (local) with refresh and revocation"
```

---

### Task 8: Model assignment, snapshot, and chat

**Files:**
- Create: `backend/src/companion.ts`, `backend/src/routes/chat.ts`, `backend/test/chat.test.ts`
- Modify: `backend/src/routes/agents.ts`, `backend/src/snapshot.ts`, `backend/src/app.ts`

**Interfaces:**
- Consumes: `clientFor`, `ProviderError`, `SecretError`, `ChatTurn`, `requireMember`, `HttpError`, `WsParams`.
- Produces:
  - `companionInstructions(agent: { name: string; role: string; workingStyle: string }, company: string, department: string | null): string`
  - `trimTurns(turns: ChatTurn[], maxChars: number): ChatTurn[]`
  - Agent PATCH/POST accept `connectionId: string | null`, `model: string | null`; clone copies them.
  - Snapshot agents gain `connectionId`, `model`; snapshot gains `connections: { id, kind, label, hint, status }[]`.
  - Routes `GET/POST/DELETE /api/workspaces/:id/agents/:agentId/chat`. SSE events `start {userMessageId}`, `delta {text}`, `done {messageId, model, inputTokens, outputTokens}`, `error {messageId, code, message}`.
  - Chat message DTO: `{ id, role, content, status, model, inputTokens, outputTokens, errorCode, errorMessage, createdAt }`.

- [ ] **Step 1: Write the failing tests**

`backend/test/chat.test.ts`:

```ts
import type { ServerResponse } from "node:http";
import { afterAll, beforeEach, expect, test } from "vitest";
import { encryptSecret } from "../src/crypto.js";
import { prisma } from "../src/db.js";
import { trimTurns } from "../src/companion.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { fakeServer, json, sse, type FakeRequest } from "./fake-provider.js";

const chunk = (content: string) => JSON.stringify({ model: "fake-1", choices: [{ delta: { content } }] });
const okReply = (_q: FakeRequest, res: ServerResponse) =>
  sse(res, [chunk("Hello "), chunk("owner"), JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 2 } }), "[DONE]"]);
const fake = await fakeServer({ "GET /v1/models": (_q, res) => json(res, 200, { data: [{ id: "fake-1" }] }), "POST /v1/chat/completions": okReply });
const app = await makeApp();
afterAll(async () => {
  await fake.close();
  await app.close();
});
beforeEach(() => {
  process.env.ALLOW_LOCAL_ENDPOINTS = "true";
  fake.routes["POST /v1/chat/completions"] = okReply;
});

const parseEvents = (body: string) =>
  body.split("\n\n").filter(Boolean).map((block) => {
    const event = /event: (.*)/.exec(block)?.[1];
    const data = /data: (.*)/.exec(block)?.[1];
    return { event, data: data ? JSON.parse(data) : null };
  });

async function setup() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Chat Co", template: "starter" })).json().id as string;
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "Fake", baseUrl: `${fake.url}/v1` })).json().id as string;
  const snap = (await req("GET", `/api/workspaces/${id}`)).json();
  const nova = snap.agents.find((a: { isHead: boolean }) => a.isHead);
  return { req, id, cid, nova, cookie };
}

test("unassigned companion explains what to do", async () => {
  const { req, id, nova } = await setup();
  const res = await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toMatch(/Choose an AI model for Nova/);
});

test("assigning a connection and model shows in the snapshot; foreign connections are rejected", async () => {
  const a = await setup();
  const b = await setup();
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${a.nova.id}`, { connectionId: a.cid, model: "fake-1" })).statusCode).toBe(200);
  const snap = (await a.req("GET", `/api/workspaces/${a.id}`)).json();
  expect(snap.agents.find((x: { id: string }) => x.id === a.nova.id)).toMatchObject({ connectionId: a.cid, model: "fake-1" });
  expect(snap.connections[0]).toMatchObject({ id: a.cid, kind: "custom", label: "Fake" });
  expect(JSON.stringify(snap)).not.toContain("secret");
  expect((await a.req("PATCH", `/api/workspaces/${a.id}/agents/${a.nova.id}`, { connectionId: b.cid })).statusCode).toBe(400);
});

test("a chat reply streams, then both messages are saved with tokens", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  const res = await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Plan my launch" });
  expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
  const events = parseEvents(res.body);
  expect(events.map((e) => e.event)).toEqual(["start", "delta", "delta", "done"]);
  expect(events.at(-1)!.data).toMatchObject({ model: "fake-1", inputTokens: 40, outputTokens: 2 });
  const sent = fake.requests.at(-1)!.body as { model: string; messages: { role: string; content: string }[] };
  expect(sent.model).toBe("fake-1");
  expect(sent.messages[0].role).toBe("system");
  expect(sent.messages[0].content).toMatch(/You are Nova, the Head agent/);
  expect(sent.messages.at(-1)).toEqual({ role: "user", content: "Plan my launch" });
  const history = (await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages;
  expect(history.map((m: { role: string; content: string; status: string }) => [m.role, m.content, m.status])).toEqual([
    ["user", "Plan my launch", "complete"],
    ["assistant", "Hello owner", "complete"],
  ]);
  expect(history[1]).toMatchObject({ inputTokens: 40, outputTokens: 2, model: "fake-1" });
});

test("provider errors are sent as an error event and saved on the message", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  fake.routes["POST /v1/chat/completions"] = (_q, res) => json(res, 401, { error: { message: "nope" } });
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "auth" } });
  const last = (await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages.at(-1);
  expect(last).toMatchObject({ role: "assistant", status: "error", errorCode: "auth" });
});

test("a temporary failure before any text is retried once", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  let calls = 0;
  fake.routes["POST /v1/chat/completions"] = (q, res) => (++calls === 1 ? json(res, 503, {}) : okReply(q, res));
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(calls).toBe(2);
  expect(events.at(-1)!.event).toBe("done");
});

test("a failure after text has streamed is not retried and keeps the partial text", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  let calls = 0;
  fake.routes["POST /v1/chat/completions"] = (_q, res) => {
    calls++;
    sse(res, [chunk("Half")]);
  };
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(calls).toBe(1);
  expect(events.at(-1)!.event).toBe("error");
  const last = (await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages.at(-1);
  expect(last).toMatchObject({ content: "Half", status: "error" });
});

test("closing the connection mid-reply saves the partial reply as stopped", async () => {
  const { req, id, cid, nova, cookie } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  fake.routes["POST /v1/chat/completions"] = (_q, res) => sse(res, [chunk("Partial ")], { end: false });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const ac = new AbortController();
  const res = await fetch(`${address}/api/workspaces/${id}/agents/${nova.id}/chat`, {
    method: "POST",
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ message: "Hi" }),
    signal: ac.signal,
  });
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("Partial")) text += new TextDecoder().decode((await reader.read()).value);
  ac.abort();
  let last;
  for (let i = 0; i < 40 && last?.status !== "stopped"; i++) {
    await new Promise((r) => setTimeout(r, 250));
    last = await prisma.chatMessage.findFirst({ where: { agentId: nova.id, role: "assistant" }, orderBy: { createdAt: "desc" } });
  }
  expect(last).toMatchObject({ status: "stopped", content: "Partial " });
});

test("only the last 20 complete messages are sent, starting with a user turn", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  const userId = (await req("GET", "/api/me")).json().user.id;
  for (let i = 0; i < 30; i++) {
    await prisma.chatMessage.create({ data: { workspaceId: id, agentId: nova.id, userId, role: i % 2 ? "assistant" : "user", content: `m${i}`, createdAt: new Date(Date.now() - (60 - i) * 1000) } });
  }
  await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "latest" });
  const sent = (fake.requests.at(-1)!.body as { messages: { role: string; content: string }[] }).messages;
  expect(sent.length).toBeLessThanOrEqual(22);
  expect(sent[1].role).toBe("user");
  expect(sent.at(-1)!.content).toBe("latest");
});

test("trimTurns keeps the newest turns within the character budget", () => {
  const turns = [
    { role: "user" as const, content: "a".repeat(10) },
    { role: "assistant" as const, content: "b".repeat(10) },
    { role: "user" as const, content: "c".repeat(10) },
  ];
  expect(trimTurns(turns, 15).map((t) => t.content[0])).toEqual(["c"]);
  expect(trimTurns(turns, 100).map((t) => t.content[0])).toEqual(["a", "b", "c"]);
});

test("viewers cannot chat, other members see only their own threads, clear empties it", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1" });
  await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Mine" });
  const viewer = await signUp(app);
  const member = await signUp(app);
  for (const [u, role] of [[viewer, "viewer"], [member, "member"]] as const) {
    const me = (await client(app, u.cookie)("GET", "/api/me")).json();
    await prisma.membership.create({ data: { workspaceId: id, userId: me.user.id, role } });
  }
  expect((await client(app, viewer.cookie)("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "x" })).statusCode).toBe(403);
  expect((await client(app, member.cookie)("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages).toEqual([]);
  expect((await req("DELETE", `/api/workspaces/${id}/agents/${nova.id}/chat`)).statusCode).toBe(204);
  expect((await req("GET", `/api/workspaces/${id}/agents/${nova.id}/chat`)).json().messages).toEqual([]);
});

test("paused companions don't chat", async () => {
  const { req, id, cid, nova } = await setup();
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: cid, model: "fake-1", status: "paused" });
  const res = await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" });
  expect(res.statusCode).toBe(409);
  expect(res.json().error.message).toMatch(/Resume Nova/);
});

test("a rejected ChatGPT token marks the connection as needing sign-in", async () => {
  const { req, id, nova } = await setup();
  process.env.TEST_OPENAI_BASE_URL = `${fake.url}/v1`;
  fake.routes["POST /v1/responses"] = (_q, res) => json(res, 401, { error: { message: "expired" } });
  const userId = (await req("GET", "/api/me")).json().user.id;
  const secret = { clientId: "c", subject: "s", email: "e@x.y", idToken: "i", accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000, scopes: [] };
  const conn = await prisma.providerConnection.create({ data: { workspaceId: id, kind: "chatgpt", label: "ChatGPT", secret: encryptSecret(JSON.stringify(secret)), createdById: userId } });
  await req("PATCH", `/api/workspaces/${id}/agents/${nova.id}`, { connectionId: conn.id, model: "gpt-a" });
  const events = parseEvents((await req("POST", `/api/workspaces/${id}/agents/${nova.id}/chat`, { message: "Hi" })).body);
  expect(events.at(-1)).toMatchObject({ event: "error", data: { code: "reauth" } });
  expect((await prisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe("reauth");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx vitest run test/chat.test.ts`
Expected: FAIL, module `../src/companion.js` not found.

- [ ] **Step 3: Write `backend/src/companion.ts`**

```ts
import type { ChatTurn } from "./providers/types.js";

export function companionInstructions(agent: { name: string; role: string; workingStyle: string }, company: string, department: string | null) {
  return [
    `You are ${agent.name}, the ${agent.role}${department ? ` in the ${department} department` : ""} at ${company}.`,
    agent.workingStyle ? `Your working style: ${agent.workingStyle}` : "",
    "You are an AI companion in this company's workspace. You can talk and help think things through. You cannot take actions, browse, or open files yet; if asked, say so plainly.",
    "Keep answers clear and concise unless asked for more detail.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Keeps the newest turns within maxChars (always the last one), and starts on a user turn. */
export function trimTurns(turns: ChatTurn[], maxChars: number): ChatTurn[] {
  const out: ChatTurn[] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    total += turns[i].content.length;
    if (total > maxChars && out.length) break;
    out.unshift(turns[i]);
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return out;
}
```

- [ ] **Step 4: Accept connection and model on agents**

In `backend/src/routes/agents.ts`:

Add to the `Fields` object:

```ts
  connectionId: z.string().max(64).nullable(),
  model: z.string().trim().min(1).max(200).nullable(),
```

Add to `CreateAgent` overrides: `connectionId: Fields.connectionId.default(null), model: Fields.model.default(null),`.

At the top of `checkRelations`, change its signature to `checkRelations(workspaceId, agentId, departmentId?, managerId?, connectionId?)` and add:

```ts
  if (connectionId) {
    const conn = await prisma.providerConnection.findFirst({ where: { id: connectionId, workspaceId } });
    if (!conn) throw new HttpError(400, "invalid", "That AI connection isn't in this workspace");
  }
```

In the POST handler pass `body.connectionId` as the fifth argument. In the PATCH handler, replace the guarded `checkRelations` call with:

```ts
    if (agent.managerId !== body.managerId || agent.departmentId !== body.departmentId || (body.connectionId && body.connectionId !== agent.connectionId)) {
      await checkRelations(id, agentId, body.departmentId, body.managerId, body.connectionId);
    }
```

In the clone handler data, add `connectionId: src.connectionId, model: src.model,`.

- [ ] **Step 5: Extend the snapshot**

In `backend/src/snapshot.ts`, add `connectionId: a.connectionId, model: a.model,` to `toAgentDTO`'s returned object, add a fifth query to the `Promise.all`:

```ts
    prisma.providerConnection.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true, kind: true, label: true, hint: true, status: true } }),
```

destructure it as `connections`, and include `connections` in the returned object.

- [ ] **Step 6: Write `backend/src/routes/chat.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { companionInstructions, trimTurns } from "../companion.js";
import { SecretError } from "../crypto.js";
import { prisma } from "../db.js";
import type { ChatMessage } from "../generated/prisma/client.js";
import { HttpError, requireMember } from "../http.js";
import { clientFor } from "../providers/index.js";
import { ProviderError, type ChatTurn, type StreamEvent } from "../providers/types.js";
import { WsParams } from "./workspaces.js";

const AgentParams = WsParams.extend({ agentId: z.string().min(1).max(64) });
const Send = z.object({ message: z.string().trim().min(1).max(8000) });
const HISTORY = 50;
const CONTEXT_MESSAGES = 20;
const CONTEXT_CHARS = 24_000;

const dto = (m: ChatMessage) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  status: m.status,
  model: m.model,
  inputTokens: m.inputTokens,
  outputTokens: m.outputTokens,
  errorCode: m.errorCode,
  errorMessage: m.errorMessage,
  createdAt: m.createdAt,
});

async function loadAgent(workspaceId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId }, include: { connection: true, department: true, workspace: { select: { name: true } } } });
  if (!agent) throw new HttpError(404, "not_found", "Companion not found");
  return agent;
}

export async function chatRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/agents/:agentId/chat", async (req) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadAgent(id, agentId);
    const rows = await prisma.chatMessage.findMany({ where: { agentId, userId: user.id }, orderBy: { createdAt: "desc" }, take: HISTORY });
    return { messages: rows.reverse().map(dto) };
  });

  app.delete("/api/workspaces/:id/agents/:agentId/chat", async (req, reply) => {
    const { id, agentId } = AgentParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadAgent(id, agentId);
    await prisma.chatMessage.deleteMany({ where: { agentId, userId: user.id } });
    return reply.code(204).send();
  });

  app.post(
    "/api/workspaces/:id/agents/:agentId/chat",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: (req) => req.headers.cookie ?? req.ip } } },
    async (req, reply) => {
      const { id, agentId } = AgentParams.parse(req.params);
      const { user } = await requireMember(req, id, "member");
      const { message } = Send.parse(req.body);
      const agent = await loadAgent(id, agentId);
      if (agent.status === "archived") throw new HttpError(409, "inactive", `Restore ${agent.name} before chatting`);
      if (agent.status === "paused") throw new HttpError(409, "inactive", `Resume ${agent.name} before chatting`);
      const conn = agent.connection;
      if (!conn || !agent.model) throw new HttpError(409, "unassigned", `Choose an AI model for ${agent.name} first`);
      if (conn.status === "reauth") throw new HttpError(409, "reauth", "Sign in to ChatGPT again on the AI providers page");

      const history = await prisma.chatMessage.findMany({
        where: { agentId, userId: user.id, status: "complete" },
        orderBy: { createdAt: "desc" },
        take: CONTEXT_MESSAGES,
      });
      const userMsg = await prisma.chatMessage.create({ data: { workspaceId: id, agentId, userId: user.id, role: "user", content: message } });
      const turns = trimTurns([...history.reverse().map((m): ChatTurn => ({ role: m.role, content: m.content })), { role: "user", content: message }], CONTEXT_CHARS);
      const instructions = companionInstructions(agent, agent.workspace.name, agent.department?.name ?? null);

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
      const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("start", { userMessageId: userMsg.id });

      const ac = new AbortController();
      let clientGone = false;
      raw.on("close", () => {
        if (!raw.writableEnded) {
          clientGone = true;
          ac.abort();
        }
      });
      const signal = AbortSignal.any([ac.signal, AbortSignal.timeout(300_000)]);

      let text = "";
      let done: Extract<StreamEvent, { type: "done" }> | undefined;
      let failure: { code: string; message: string } | undefined;
      try {
        const provider = clientFor(conn);
        for (let attempt = 0; ; attempt++) {
          try {
            for await (const ev of provider.stream({ model: agent.model, instructions, turns, signal })) {
              if (ev.type === "delta") {
                text += ev.text;
                send("delta", { text: ev.text });
              } else done = ev;
            }
            break;
          } catch (e) {
            if (attempt === 0 && !text && e instanceof ProviderError && e.retryable && !signal.aborted) {
              await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        if (clientGone) failure = undefined;
        else if (signal.aborted) failure = { code: "timeout", message: "The reply took too long and was stopped." };
        else if (e instanceof ProviderError || e instanceof SecretError) failure = { code: e instanceof ProviderError ? e.code : "secret", message: e.message };
        else {
          req.log.error(e);
          failure = { code: "server_error", message: "Something went wrong while getting the reply." };
        }
      }

      const status = clientGone ? "stopped" : failure ? "error" : "complete";
      const saved = await prisma.chatMessage.create({
        data: {
          workspaceId: id,
          agentId,
          userId: user.id,
          role: "assistant",
          content: text,
          status,
          connectionId: conn.id,
          kind: conn.kind,
          model: done?.model ?? agent.model,
          inputTokens: done?.usage.inputTokens ?? null,
          outputTokens: done?.usage.outputTokens ?? null,
          errorCode: failure?.code ?? null,
          errorMessage: failure?.message ?? null,
        },
      });
      if (conn.kind === "chatgpt" && failure && (failure.code === "auth" || failure.code === "reauth")) {
        await prisma.providerConnection.update({ where: { id: conn.id }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
        failure = { code: "reauth", message: "Sign in to ChatGPT again to keep using it." };
      }
      if (clientGone) return;
      if (failure) send("error", { messageId: saved.id, ...failure });
      else send("done", { messageId: saved.id, model: saved.model, inputTokens: saved.inputTokens, outputTokens: saved.outputTokens });
      raw.end();
    },
  );
}
```

- [ ] **Step 7: Register in `backend/src/app.ts`**

Add `import { chatRoutes } from "./routes/chat.js";` and `await app.register(chatRoutes);` after `chatgptRoutes`.

- [ ] **Step 8: Run the chat tests, then the whole suite**

Run: `cd backend && npx vitest run test/chat.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: all chat tests pass, `TSC_OK`.

Run: `cd backend && npm test 2>&1 | grep -E "Tests |Test Files|×"`
Expected: every file passes.

- [ ] **Step 9: Commit**

```bash
git add backend/src backend/test/chat.test.ts
git commit -m "feat(backend): assign models to companions and stream companion chat"
```

---

### Task 9: AI providers page

**Files:**
- Modify: `frontend/src/lib/types.ts`, `frontend/src/components/app/AppShell.tsx`
- Create: `frontend/src/app/w/[slug]/providers/page.tsx`

**Interfaces:**
- Consumes: backend connection and ChatGPT routes, `useWorkspace`, `api`, `canAdmin`, `/logos/openai.svg`.
- Produces: types `ProviderKind`, `ConnectionStatus`, `ConnectionSummary`, `Connection`, `ChatMessageDTO`; `Agent.connectionId`, `Agent.model`; `Snapshot.connections`.

- [ ] **Step 1: Extend `frontend/src/lib/types.ts`**

Add:

```ts
export type ProviderKind = "chatgpt" | "openai" | "anthropic" | "gemini" | "custom";
export type ConnectionStatus = "connected" | "error" | "reauth";
export type ConnectionSummary = { id: string; kind: ProviderKind; label: string; hint: string; status: ConnectionStatus };
export type Connection = ConnectionSummary & {
  baseUrl: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  inputTokens: number;
  outputTokens: number;
};
export type ChatMessageDTO = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "error" | "stopped";
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};
export const PROVIDER_NAMES: Record<ProviderKind, string> = { chatgpt: "ChatGPT", openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", custom: "Custom endpoint" };
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
```

Add `connectionId: string | null; model: string | null;` to `Agent`, and `connections: ConnectionSummary[];` to `Snapshot`.

- [ ] **Step 2: Add the nav item in `frontend/src/components/app/AppShell.tsx`**

Import `Plugs` from `@phosphor-icons/react` and insert into `nav` after Organization:

```ts
    { href: `${base}/providers`, label: "AI providers", icon: Plugs },
```

- [ ] **Step 3: Write `frontend/src/app/w/[slug]/providers/page.tsx`**

```tsx
"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { canAdmin, CHATGPT_USAGE_URL, PROVIDER_NAMES, type Connection, type ProviderKind } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

type KeyKind = "openai" | "anthropic" | "gemini" | "custom";
const PRESETS = [
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { id: "xai", label: "xAI", url: "https://api.x.ai/v1" },
  { id: "deepseek", label: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { id: "ollama", label: "Ollama (this computer)", url: "http://127.0.0.1:11434/v1" },
  { id: "other", label: "Other", url: "" },
];
const field = "mt-1.5 w-full rounded-[10px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";
const statusText = (c: Connection) => (c.status === "connected" ? "Connected" : c.status === "reauth" ? "Sign in again" : `Error: ${c.lastError ?? "check failed"}`);

function ChatGptButton({ onClick, busy, label = "Continue with ChatGPT" }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button onClick={onClick} disabled={busy} className="inline-flex items-center gap-2 rounded-[10px] bg-[#0b0d10] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-70">
      <Image src="/logos/openai.svg" alt="" width={16} height={16} className="invert" />
      {busy ? "Opening ChatGPT..." : label}
    </button>
  );
}

function AddForm({ kind, onClose, onSaved }: { kind: KeyKind; onClose: () => void; onSaved: () => void }) {
  const { wsPath } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [preset, setPreset] = useState("openrouter");
  const [url, setUrl] = useState(PRESETS[0].url);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError("");
    try {
      await api(wsPath("/connections"), { method: "POST", body: { kind, label: f.label, apiKey: f.apiKey || undefined, baseUrl: kind === "custom" ? url : undefined } });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const defaultLabel = kind === "custom" ? (PRESETS.find((p) => p.id === preset)?.label ?? "Custom") : PROVIDER_NAMES[kind];
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="add-title" className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-6 text-ink backdrop:bg-black/40">
      <form onSubmit={submit} className="space-y-4">
        <h2 id="add-title" className="text-xl font-semibold">Add {PROVIDER_NAMES[kind]}</h2>
        {kind === "custom" && (
          <>
            <label className="block text-sm font-medium">
              Provider
              <select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  setUrl(PRESETS.find((p) => p.id === e.target.value)?.url ?? "");
                }}
                className={field}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Base URL
              <input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/v1" className={field} />
            </label>
          </>
        )}
        <label className="block text-sm font-medium">
          Name
          <input name="label" required maxLength={60} defaultValue={defaultLabel} key={defaultLabel} className={field} />
        </label>
        <label className="block text-sm font-medium">
          API key{kind === "custom" ? " (optional for local servers)" : ""}
          <input name="apiKey" type="password" autoComplete="off" required={kind !== "custom"} className={field} />
        </label>
        <p className="text-xs text-muted">We test the key before saving. It's stored encrypted and never shown again.</p>
        {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={busy} className="btn-dark rounded-[10px] px-4 py-2.5 text-sm font-semibold disabled:opacity-70">{busy ? "Testing..." : "Test and save"}</button>
        </div>
      </form>
    </dialog>
  );
}

function ProvidersInner() {
  const { snapshot, wsPath, reload } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const admin = canAdmin(snapshot.role);
  const [data, setData] = useState<{ connections: Connection[]; chatgptLocalLogin: boolean } | null>(null);
  const [adding, setAdding] = useState<KeyKind | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<{ connections: Connection[]; chatgptLocalLogin: boolean }>(wsPath("/connections")).then(setData), [wsPath]);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", text: (e as Error).message }));
  }, [load]);

  // Messages from the ChatGPT callback redirect.
  useEffect(() => {
    const err = params.get("chatgpt_error");
    const ok = params.get("connected") === "chatgpt";
    if (!err && !ok) return;
    const t = setTimeout(() => {
      if (err) setNotice({ kind: "error", text: err });
      if (ok) {
        let seen = false;
        try {
          seen = localStorage.getItem(`chatgpt-welcome-${snapshot.workspace.id}`) === "1";
          localStorage.setItem(`chatgpt-welcome-${snapshot.workspace.id}`, "1");
        } catch {}
        if (!seen) setWelcome(true);
        else setNotice({ kind: "ok", text: "ChatGPT is connected." });
      }
      router.replace(`/w/${snapshot.workspace.slug}/providers`);
    }, 0);
    return () => clearTimeout(t);
  }, [params, router, snapshot.workspace.id, snapshot.workspace.slug]);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice({ kind: "ok", text: done });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
      await load().catch(() => {});
      await reload();
    }
  }

  const startChatgpt = (connectionId?: string) =>
    run("chatgpt", async () => {
      const { url } = await api<{ url: string }>(wsPath("/connections/chatgpt/start"), { method: "POST", body: connectionId ? { connectionId } : {} });
      window.location.assign(url);
    });

  const cards: { kind: ProviderKind | "claude"; title: string; text: string; action?: React.ReactNode }[] = [
    {
      kind: "chatgpt",
      title: "Use your ChatGPT plan",
      text: data?.chatgptLocalLogin
        ? "Complete eligible AI requests with usage included in your ChatGPT plan. Works on this computer. Separate from any Agent Company charges."
        : "ChatGPT sign-in works on local or self-hosted installs. A hosted site needs OpenAI's approval first.",
      action: data?.chatgptLocalLogin ? (
        <ChatGptButton onClick={() => startChatgpt()} busy={busy === "chatgpt"} />
      ) : (
        <a href="https://openai.com/form/sign-in-with-chatgpt-interest/" target="_blank" rel="noreferrer" className="text-sm font-medium underline">OpenAI interest form</a>
      ),
    },
    {
      kind: "claude",
      title: "Claude account",
      text: "Anthropic doesn't allow other apps to use Claude logins. Use an Anthropic API key instead.",
      action: <button onClick={() => setAdding("anthropic")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add Anthropic key</button>,
    },
    { kind: "openai", title: "OpenAI API key", text: "Pay per use with your OpenAI platform account.", action: <button onClick={() => setAdding("openai")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add key</button> },
    { kind: "gemini", title: "Google Gemini API key", text: "Use Gemini models with a Google AI Studio key.", action: <button onClick={() => setAdding("gemini")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add key</button> },
    { kind: "custom", title: "Custom endpoint", text: "OpenRouter, xAI, DeepSeek, Ollama, or any OpenAI-compatible URL.", action: <button onClick={() => setAdding("custom")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add endpoint</button> },
  ];

  return (
    <main className="max-w-4xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">AI providers</h1>
        <p className="mt-1 text-sm text-muted">Connect the AI services your companions use. Each companion picks one in its Customize form.</p>
      </div>
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`rounded-[10px] px-4 py-3 text-sm ${notice.kind === "error" ? "bg-[#fde8e6] text-[#7a1b12]" : "bg-bg"}`}>
          {notice.text}
        </p>
      )}

      {admin ? (
        <section aria-labelledby="add-heading" className="grid gap-3 sm:grid-cols-2">
          <h2 id="add-heading" className="sr-only">Add a provider</h2>
          {cards.map((c) => (
            <div key={c.kind} className="flex flex-col justify-between gap-4 rounded-[14px] border border-line bg-paper p-5">
              <div>
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1 text-sm text-muted">{c.text}</p>
              </div>
              <div>{c.action}</div>
            </div>
          ))}
        </section>
      ) : (
        <p className="text-sm text-muted">Only owners and admins can add or change providers.</p>
      )}

      <section aria-labelledby="connected-heading">
        <h2 id="connected-heading" className="text-lg font-semibold">Connected</h2>
        {!data && <div className="mt-3 h-20 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
        {data && data.connections.length === 0 && <p className="mt-3 text-sm text-muted">Nothing connected yet. Add a provider above.</p>}
        <ul className="mt-3 space-y-2">
          {data?.connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-paper p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.label} <span className="text-sm font-normal text-muted">{PROVIDER_NAMES[c.kind]}</span>
                </p>
                <p className="truncate text-sm text-muted">
                  {c.hint} · {statusText(c)} · {c.inputTokens + c.outputTokens} tokens used
                </p>
                {c.kind === "chatgpt" && (
                  <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="text-sm underline">Manage usage</a>
                )}
              </div>
              {admin && (
                <div className="flex flex-wrap gap-2">
                  {c.kind === "chatgpt" && c.status === "reauth" && <ChatGptButton onClick={() => startChatgpt(c.id)} busy={busy === "chatgpt"} label="Sign in again" />}
                  <button disabled={!!busy} onClick={() => run(c.id, async () => {
                    const r = await api<{ ok: boolean; models?: number; error?: string }>(wsPath(`/connections/${c.id}/test`), { method: "POST" });
                    if (!r.ok) throw new Error(r.error);
                    setNotice({ kind: "ok", text: `${c.label} works. ${r.models} models available.` });
                  })} className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">{busy === c.id ? "Testing..." : "Test"}</button>
                  {c.kind !== "chatgpt" && (
                    <button disabled={!!busy} onClick={() => {
                      const apiKey = prompt(`New API key for ${c.label}`);
                      if (apiKey) run(c.id, () => api(wsPath(`/connections/${c.id}`), { method: "PATCH", body: { apiKey } }), "Key replaced and tested.");
                    }} className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">Replace key</button>
                  )}
                  <button disabled={!!busy} onClick={() => {
                    const label = prompt("New name", c.label);
                    if (label) run(c.id, () => api(wsPath(`/connections/${c.id}`), { method: "PATCH", body: { label } }));
                  }} className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">Rename</button>
                  <button disabled={!!busy} onClick={() => {
                    if (!confirm(`Remove ${c.label}? Companions using it will need a new AI model.`)) return;
                    run(c.id, async () => {
                      const r = await api<{ revoked: boolean | null }>(wsPath(`/connections/${c.id}`), { method: "DELETE" });
                      if (r.revoked === false) setNotice({ kind: "error", text: "Removed here, but OpenAI didn't confirm the sign-out. Disconnect the app in ChatGPT settings." });
                    });
                  }} className="rounded-[8px] px-3 py-1.5 text-sm font-semibold text-[#b42318] hover:bg-bg">Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {adding && <AddForm kind={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); setNotice({ kind: "ok", text: "Connected." }); load(); reload(); }} />}

      {welcome && (
        <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-[16px] bg-paper p-6 text-center">
            <Image src="/logos/openai.svg" alt="" width={36} height={36} className="mx-auto" />
            <h2 id="welcome-title" className="mt-4 text-xl font-semibold">You&apos;re using your ChatGPT plan</h2>
            <p className="mt-2 text-sm text-muted">Eligible AI requests in Agent Company now use your ChatGPT plan. You can manage usage in ChatGPT settings.</p>
            <button autoFocus onClick={() => setWelcome(false)} className="btn-dark mt-5 w-full rounded-[10px] py-2.5 text-sm font-semibold">Got it</button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ProvidersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted">Loading providers...</div>}>
      <ProvidersInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: Lint, type check, browser check**

Run: `cd frontend && npm run lint && npx tsc --noEmit 2>&1 | grep -v '^\.next' ; echo checked`
Expected: lint exits 0 and no `src/` type errors.

Browser (backend restarted so new routes load): open `/w/<slug>/providers` as owner. Cards render; "Add endpoint" with an invalid URL shows the server's message; with `ALLOW_LOCAL_ENDPOINTS=false` a `https://169.254.169.254` URL shows "private network". "Continue with ChatGPT" navigates to `auth.openai.com` (stop there if not signing in). Non-admin view shows the read-only note.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): AI providers page with ChatGPT, Claude, key, and custom endpoint cards"
```

---

### Task 10: Model picker, Chat tab, and Thinking status

**Files:**
- Create: `frontend/src/lib/sse.ts`, `frontend/src/components/app/CompanionChat.tsx`
- Modify: `frontend/src/components/app/CompanionForm.tsx`, `frontend/src/components/app/CompanionPanel.tsx`, `frontend/src/components/app/office/Office.tsx`, `frontend/src/components/app/office/OfficeScene.tsx`, `frontend/src/components/app/office/OfficeList.tsx`, `frontend/src/lib/types.ts`

**Interfaces:**
- Consumes: chat routes, `/connections/:cid/models`, snapshot `connections`.
- Produces: `readEvents(res: Response): AsyncGenerator<{ event: string; data: unknown }>`; `statusLabel(a: Agent, thinking?: boolean)`; `CompanionChat({ agent, onEdit, onThinking })`; `CompanionPanel` gains `onThinking: (busy: boolean) => void`; `OfficeScene` and `OfficeList` gain `thinkingId: string | null`.

- [ ] **Step 1: Update `statusLabel` in `frontend/src/lib/types.ts`**

```ts
export const statusLabel = (a: Agent, thinking = false) => (thinking ? "Thinking" : { active: "Idle", paused: "Paused", archived: "Archived" }[a.status]);
```

- [ ] **Step 2: Write `frontend/src/lib/sse.ts`**

```ts
/** Reads `event:`/`data:` server-sent events from a fetch Response. */
export async function* readEvents(res: Response): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(block)?.[1];
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}
```

- [ ] **Step 3: Write `frontend/src/components/app/CompanionChat.tsx`**

```tsx
"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { readEvents } from "@/lib/sse";
import { canEdit, CHATGPT_USAGE_URL, type Agent, type ChatMessageDTO } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

type Pending = { text: string; error?: { code: string; message: string } };

export function CompanionChat({ agent, onEdit, onThinking }: { agent: Agent; onEdit: () => void; onThinking: (busy: boolean) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessageDTO[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const conn = snapshot.connections.find((c) => c.id === agent.connectionId);
  const path = wsPath(`/agents/${agent.id}/chat`);

  const load = useCallback(() => api<{ messages: ChatMessageDTO[] }>(path).then((r) => setMessages(r.messages)), [path]);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
    return () => abort.current?.abort();
  }, [load]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages, pending]);

  if (!canEdit(snapshot.role)) return <p className="p-1 text-sm text-muted">Viewers can't chat with companions.</p>;
  if (!conn || !agent.model) {
    return (
      <div className="rounded-[12px] border border-dashed border-line p-5 text-center">
        <p className="font-medium">Choose an AI model for {agent.name} first</p>
        <p className="mt-1 text-sm text-muted">Pick a provider and model in the Customize form.</p>
        <button onClick={onEdit} className="btn-dark mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold">Choose a model</button>
      </div>
    );
  }

  async function send() {
    const message = draft.trim();
    if (!message || pending) return;
    setDraft("");
    setError("");
    setPending({ text: "" });
    onThinking(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }), signal: ac.signal });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "Couldn't send the message.");
      for await (const ev of readEvents(res)) {
        if (ev.event === "delta") setPending((p) => ({ text: (p?.text ?? "") + (ev.data as { text: string }).text }));
        if (ev.event === "error") setPending((p) => ({ text: p?.text ?? "", error: ev.data as { code: string; message: string } }));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      onThinking(false);
      abort.current = null;
      await load().catch(() => {});
      setPending(null);
    }
  }

  const bubble = (role: "user" | "assistant") => `max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2.5 text-sm ${role === "user" ? "ml-auto bg-ink text-paper" : "bg-bg"}`;
  const usageLimit = (code?: string | null) => code === "usage_limit" && conn.kind === "chatgpt";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[45dvh] min-h-40 flex-col gap-2 overflow-y-auto pr-1 lg:max-h-[50dvh]" aria-label={`Chat with ${agent.name}`}>
        {messages === null && <div className="h-16 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
        {messages?.length === 0 && !pending && <p className="py-6 text-center text-sm text-muted">Say hello to {agent.name}.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={bubble(m.role)}>
            {m.content || (m.status !== "complete" ? <span className="italic text-muted">No reply</span> : null)}
            {m.role === "assistant" && (
              <p className="mt-1.5 text-[11px] text-muted">
                {m.status === "stopped" ? "Stopped. " : ""}
                {m.status === "error" ? `${m.errorMessage} ` : ""}
                {m.model}
                {m.outputTokens != null ? ` · ${(m.inputTokens ?? 0) + m.outputTokens} tokens` : ""}
              </p>
            )}
            {usageLimit(m.errorCode) && (
              <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-[8px] bg-[#0b0d10] px-3 py-1.5 text-xs font-semibold text-white">Manage usage</a>
            )}
          </div>
        ))}
        {pending && (
          <div className={bubble("assistant")} aria-live="polite" aria-busy={!pending.error}>
            {pending.text || <span className="text-muted">{agent.name} is thinking...</span>}
            {pending.error && <p className="mt-1.5 text-[11px] text-[#b42318]">{pending.error.message}</p>}
          </div>
        )}
        <div ref={end} />
      </div>

      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}

      {conn.kind === "chatgpt" && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Image src="/logos/openai.svg" alt="" width={12} height={12} /> Using ChatGPT plan ·
          <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="underline">Manage usage</a>
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2"
      >
        <label htmlFor={`chat-${agent.id}`} className="sr-only">Message {agent.name}</label>
        <textarea
          id={`chat-${agent.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={8000}
          placeholder={`Message ${agent.name}...`}
          className="min-w-0 flex-1 resize-none rounded-[12px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
        {pending ? (
          <button type="button" onClick={() => abort.current?.abort()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Stop</button>
        ) : (
          <button type="submit" disabled={!draft.trim()} className="btn-dark rounded-[10px] px-4 py-2.5 text-sm font-semibold disabled:opacity-60">Send</button>
        )}
      </form>
      {messages && messages.length > 0 && !pending && (
        <button
          onClick={async () => {
            if (!confirm(`Clear your chat with ${agent.name}?`)) return;
            await api(path, { method: "DELETE" }).catch((e) => setError((e as Error).message));
            await load();
          }}
          className="self-start text-xs text-muted underline"
        >
          Clear chat
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add tabs to `frontend/src/components/app/CompanionPanel.tsx`**

Change the props to `{ agent, onClose, onEdit, onSelect, onThinking }: { agent: Agent; onClose: () => void; onEdit: () => void; onSelect: (id: string) => void; onThinking: (busy: boolean) => void }`. Add `import { CompanionChat } from "./CompanionChat";` and `const [tab, setTab] = useState<"profile" | "chat">("profile");`. Directly after the role paragraph (`<p className="text-sm text-muted">…</p>`), insert:

```tsx
      <div role="tablist" aria-label="Companion views" className="mt-4 flex gap-1 rounded-[10px] border border-line p-0.5">
        {(["profile", "chat"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-[8px] px-3 py-1.5 text-sm capitalize ${tab === t ? "bg-ink text-paper" : ""}`}>
            {t === "profile" ? "Profile" : "Chat"}
          </button>
        ))}
      </div>
      {tab === "chat" && (
        <div role="tabpanel" className="mt-4">
          <CompanionChat agent={agent} onEdit={onEdit} onThinking={onThinking} />
        </div>
      )}
```

Wrap the existing `<dl>`, error paragraph, action buttons, and the milestone note in `{tab === "profile" && (<div role="tabpanel">…</div>)}`. Add an "AI model" row to the `<dl>` list: `["AI model", agent.model ? `${agent.model} (${snapshot.connections.find((c) => c.id === agent.connectionId)?.label ?? "connection removed"})` : "Not chosen yet"]`, and remove the old `["AI provider", "Not connected yet"]` row.

- [ ] **Step 5: Add the AI model section to `frontend/src/components/app/CompanionForm.tsx`**

Add `connectionId: agent?.connectionId ?? ""` and `model: agent?.model ?? ""` to the initial form state. Add state and effect:

```tsx
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [modelsNote, setModelsNote] = useState("");
  useEffect(() => {
    if (!form.connectionId) return;
    let cancelled = false;
    api<{ models: { id: string; label: string }[] }>(wsPath(`/connections/${form.connectionId}/models`))
      .then((r) => {
        if (cancelled) return;
        setModels(r.models);
        setModelsNote(r.models.length ? "" : "No models listed. Type a model ID.");
      })
      .catch((e) => {
        if (cancelled) return;
        setModels([]);
        setModelsNote(`${(e as Error).message} You can still type a model ID.`);
      });
    return () => {
      cancelled = true;
    };
  }, [form.connectionId, wsPath]);
```

In `submit`, extend the body: `connectionId: form.connectionId || null, model: form.connectionId && form.model.trim() ? form.model.trim() : null`.

Insert before the "Working style" label:

```tsx
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-semibold">AI model</legend>
            <label className="text-sm font-medium">
              Provider
              <select value={form.connectionId} onChange={(e) => set("connectionId", e.target.value)} className={field}>
                <option value="">Not connected</option>
                {snapshot.connections.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} ({c.hint})</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Model
              <input list={`models-${agent?.id ?? "new"}`} value={form.model} disabled={!form.connectionId} onChange={(e) => set("model", e.target.value)} placeholder={form.connectionId ? "Pick or type a model" : "Choose a provider first"} className={field} />
              <datalist id={`models-${agent?.id ?? "new"}`}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </datalist>
            </label>
            {snapshot.connections.length === 0 && <p className="text-xs text-muted sm:col-span-2">No providers yet. An owner can add one on the AI providers page.</p>}
            {modelsNote && form.connectionId && <p className="text-xs text-muted sm:col-span-2">{modelsNote}</p>}
          </fieldset>
```

- [ ] **Step 6: Show "Thinking" in the office**

In `Office.tsx`: add `const [thinkingId, setThinkingId] = useState<string | null>(null);`, pass `thinkingId={thinkingId}` to `OfficeScene` and `OfficeList`, and pass `onThinking={(busy) => setThinkingId(busy ? selected.id : null)}` to `CompanionPanel`.

In `OfficeScene.tsx`: add `thinkingId: string | null` to the props, and in the companion rendering use `const thinking = thinkingId === a.id;`, `const label = \`${a.name}, ${a.role}, ${statusLabel(a, thinking)}\`;`, and render the status line with `statusLabel(a, thinking)`. While thinking, draw a small three-dot cue above the head: `{thinking && <text y={-46} textAnchor="middle" className="fill-ink" style={{ fontSize: 18 }}>…</text>}`.

In `OfficeList.tsx`: add `thinkingId: string | null` to the props and render `statusLabel(a, thinkingId === a.id)`.

- [ ] **Step 7: Lint, type check, browser check**

Run: `cd frontend && npm run lint && npx tsc --noEmit 2>&1 | grep -v '^\.next' ; echo checked`
Expected: lint exits 0, no `src/` errors.

Browser: with a custom connection to a running Ollama or the E2E fake server, assign Nova a model in Customize, open the Chat tab, send a message; the reply streams, Nova shows "Thinking" in the office until it finishes, the footer shows model and tokens, Stop works mid-reply, Clear chat empties it, refresh keeps history.

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): model picker, companion chat tab, and Thinking status"
```

---

### Task 11: End-to-end chat test, live smoke script, docs

**Files:**
- Create: `frontend/e2e/fake-llm.ts`, `frontend/e2e/chat.spec.ts`, `backend/scripts/smoke.ts`
- Modify: `frontend/e2e/global-setup.ts`, `backend/package.json`, `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the fake model server `frontend/e2e/fake-llm.ts`**

```ts
import { createServer, type Server } from "node:http";

export const FAKE_LLM_PORT = 4199;
export const FAKE_REPLY = ["Hello ", "from the ", "fake model."];

export function startFakeLlm(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "fake-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const text of FAKE_REPLY) res.write(`data: ${JSON.stringify({ model: "fake-model", choices: [{ delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 6 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(FAKE_LLM_PORT, "127.0.0.1", () => resolve(server)));
}
```

- [ ] **Step 2: Start it from `frontend/e2e/global-setup.ts`**

Replace the file with:

```ts
import { execSync } from "node:child_process";
import { startFakeLlm } from "./fake-llm";

export default async function setup() {
  execSync("npm --prefix ../backend run db:reset:test", { stdio: "inherit" });
  const server = await startFakeLlm();
  return () => new Promise<void>((r) => server.close(() => r()));
}
```

In `backend/package.json`, add `ALLOW_LOCAL_ENDPOINTS=true CHATGPT_LOCAL_LOGIN=false` to the `dev:test` script's environment prefix.

- [ ] **Step 3: Write `frontend/e2e/chat.spec.ts`**

```ts
import { expect, test } from "@playwright/test";

test("connect a custom endpoint, assign it to Nova, chat, and keep the history", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Chat Owner");
  await page.getByLabel("Email").fill(`chat-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("Chat Bakery");
  await page.getByRole("radio", { name: /Just the head agent/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/chat-bakery/);

  await page.getByRole("link", { name: "AI providers" }).click();
  await expect(page.getByRole("heading", { name: "AI providers" })).toBeVisible();
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Provider").selectOption("other");
  await dialog.getByLabel("Base URL").fill("http://127.0.0.1:4199/v1");
  await dialog.getByLabel("Name").fill("Fake LLM");
  await dialog.getByRole("button", { name: "Test and save" }).click();
  await expect(page.getByText(/Connected/).first()).toBeVisible();

  await page.getByRole("link", { name: "Office" }).click();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Companion details" });
  await panel.getByRole("button", { name: "Customize" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Provider").selectOption({ label: "Fake LLM (127.0.0.1:4199)" });
  await form.getByLabel("Model").fill("fake-model");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();

  await panel.getByRole("tab", { name: "Chat" }).click();
  await panel.getByLabel("Message Nova").fill("Hello Nova");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("Hello from the fake model.")).toBeVisible();
  await expect(panel.getByText(/fake-model · 56 tokens/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("complementary", { name: "Companion details" }).getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("Hello Nova")).toBeVisible();
  await expect(page.getByText("Hello from the fake model.")).toBeVisible();
});
```

- [ ] **Step 4: Run both E2E tests**

Run: `cd frontend && npm run e2e`
Expected: `2 passed`. If the chat reply arrives all at once instead of streaming through the Next.js proxy, the test still passes; note it and check streaming manually in the browser (Task 10 Step 7).

- [ ] **Step 5: Write the opt-in live smoke script `backend/scripts/smoke.ts`**

```ts
// Opt-in live check against a real provider. Never run in CI. Example:
//   LIVE_PROVIDER=openai LIVE_API_KEY=sk-... LIVE_MODEL=<model id> npm --prefix backend run smoke
import "../src/env.js";
import { encryptSecret } from "../src/crypto.js";
import { clientFor } from "../src/providers/index.js";

const kind = process.env.LIVE_PROVIDER as "openai" | "anthropic" | "gemini" | "custom" | undefined;
const key = process.env.LIVE_API_KEY;
const model = process.env.LIVE_MODEL;
if (!kind || !model || (!key && kind !== "custom")) {
  console.error("Set LIVE_PROVIDER (openai|anthropic|gemini|custom), LIVE_MODEL, LIVE_API_KEY, and LIVE_BASE_URL for custom.");
  process.exit(1);
}
const client = clientFor({ id: "smoke", kind, baseUrl: process.env.LIVE_BASE_URL ?? null, secret: key ? encryptSecret(key) : null });
const models = await client.listModels(AbortSignal.timeout(20_000));
console.log(`models listed: ${models.length}`);
let text = "";
for await (const ev of client.stream({ model, instructions: "Reply in five words or fewer.", turns: [{ role: "user", content: "Say hello." }], signal: AbortSignal.timeout(60_000) })) {
  if (ev.type === "delta") text += ev.text;
  else console.log(`reply: ${text.trim()}\nmodel: ${ev.model}\ntokens: ${ev.usage.inputTokens} in, ${ev.usage.outputTokens} out`);
}
```

Add `"smoke": "tsx scripts/smoke.ts"` to `backend/package.json` scripts and `"scripts"` to `backend/tsconfig.json` `include`.

- [ ] **Step 6: Update `README.md`**

Add after the Run section:

````markdown
## AI providers

Open **AI providers** in the app sidebar.

- **ChatGPT account**: "Continue with ChatGPT" uses OpenAI's Sign in with ChatGPT. It works on a local or self-hosted install (`CHATGPT_LOCAL_LOGIN=true`). A hosted site needs OpenAI's approval through their interest form.
- **Claude**: Anthropic does not allow other apps to use Claude logins, so use an Anthropic API key.
- **OpenAI, Google Gemini**: paste an API key.
- **Custom endpoint**: OpenRouter, xAI, DeepSeek, Ollama, or any OpenAI-compatible URL. Local servers such as Ollama need `ALLOW_LOCAL_ENDPOINTS=true`.

Keys and tokens are encrypted with `CREDENTIALS_KEY` and never shown again.

Live check with a real key (optional, costs a few tokens):

```
LIVE_PROVIDER=openai LIVE_API_KEY=sk-... LIVE_MODEL=<model id> npm --prefix backend run smoke
```
````

- [ ] **Step 7: Full verification gates**

Run each, all must exit 0:

```bash
cd backend && npm test && npx tsc --noEmit
cd ../frontend && npm run lint && npx tsc --noEmit && npm run build && npm run e2e
```

Then check at 1440px and 390px, light and dark: providers page (with and without connections, add dialog), Customize with the AI model section, companion panel Chat tab (empty, streaming, error, usage-limit button), office with "Thinking". Fix overflow and contrast issues before finishing.

- [ ] **Step 8: Commit**

```bash
git add frontend backend README.md
git commit -m "test: end-to-end companion chat, live smoke script, provider docs"
```

---

## Self-Review Notes

- **Spec coverage:** criteria 1 (Tasks 6, 9), 2 (Tasks 7, 9), 3 (Task 9 Claude card), 4 (Task 6 test route, Task 9 Test button), 5 (Tasks 8, 10), 6 (Tasks 8, 10), 7 (Task 10 Step 6), 8 (Tasks 3-5 error mapping, 8 saved errors, 10 messages and Manage usage), 9 (Task 2, Task 6 private URL test), 10 (all backend test files, Task 11 smoke), 11 (Task 11 Step 7).
- **Spec deviation recorded:** none in scope. The OpenAI UI/UX guideline items (welcome modal, Using ChatGPT plan, Manage usage) were added from the official guidelines page during planning; they extend the spec's "follows OpenAI's UI guidelines" line.
- **Known limits marked in code:** in-memory ChatGPT attempts (lost on restart), rate-limit key uses the session cookie or IP.
