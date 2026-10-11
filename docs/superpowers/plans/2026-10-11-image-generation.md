# Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Companions create and edit images with a `generate_image` tool: free Cloudflare FLUX.2 klein by default, Pollinations (FLUX.2 klein or gpt-image-2) for readable text and more volume. Images are shown to the owner and saved into goal projects.

**Architecture:**
- **Tool:** a new harness tool (`backend/src/harness/images.ts`) routes each request to Cloudflare or Pollinations with fallbacks, a 4-image cap and a cost note. It hands the finished image to a `MediaStore` and sends it back to the AI as a picture.
- **Storage:** made images are stored as `Attachment` rows, so thumbnails, access rules and Save to project come from part 1. Chat rows are linked to the reply when it's saved; task rows get a new `taskId`, and in a project they're also copied to `images/`.
- **Keys:** they live in a new `ImageKey` table, set from a Settings card.

**Tech Stack:** Fastify 5, Prisma 7 (Neon Postgres), Zod 4, Vitest, `sharp` (new), Next.js 16, React 19, Tailwind 4, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-image-generation-design.md`

## Global Constraints

- Cloudflare model `@cf/black-forest-labs/flux-2-klein-4b`. URL: `{base}/accounts/{accountId}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`, multipart fields `prompt`, `width`, `height`, `input_image_0`…`input_image_3`; the response image is `result.image` (base64). Default base `https://api.cloudflare.com/client/v4`.
- Pollinations models: `black-forest-labs/flux.2-klein-4b` for standard and `openai/gpt-image-2` for high. Every request sends `quality: "medium"` and `response_format: "b64_json"`.
  - Create: `POST {base}/v1/images/generations` (JSON).
  - Edit: `POST {base}/v1/images/edits` (multipart, repeated `image` fields).
  - The response image is `data[0].b64_json`. Default base `https://gen.pollinations.ai`.
- Test base URL overrides: `TEST_CLOUDFLARE_BASE_URL` and `TEST_POLLINATIONS_BASE_URL`, read through `testOverride` from `backend/src/env.js`.
- Sizes: `square` 1024×1024 (default), `landscape` 1536×1024, `portrait` 1024×1536.
- Edit inputs are shrunk to PNG: within 511×511 for Cloudflare, within 1536×1536 for Pollinations. At most 4 inputs.
- At most 4 images per chat reply or task (one tool instance per reply or task; Nova's revision rounds reuse the task's tools). The image tool's time limit is 120,000 ms; other tools keep 20,000 ms.
- Cost notes, appended to the activity label as ` · <note>`: `free`, `~$0.005`, `~$0.05`.
- Exact messages:
  - "Today's free images are used up; they come back at 00:00 UTC."
  - "The Cloudflare key was rejected. Update it in Settings › AI services." (and the same for Pollinations)
  - "The image service refused this description. Try different wording."
  - "That's 4 images for this reply, the limit. Finish with what you have."
  - "There's no image called X. Use list_attachments or list_files to see them."
  - "X isn't an image."
  - "The Pollinations balance is used up. Top it up at enter.pollinations.ai."
- Tool result text:
  - `Saved as images/<file> (<Service>, <cost>).` in a task with a project;
  - `Shown to the owner on the task card as <file> (…).` in a task without one;
  - `Shown to the owner under your reply as <file> (…).` in chats.
- File name: the `name` argument, or the prompt's first five `[a-z0-9]+` words joined by `-`, falling back to `image`; the extension comes from the image bytes.
- New dependency: `sharp@0.35.4`, exact, backend only.
- **Databases:**
  - Migrations run only against the test database: `USE_TEST_DB=1 npx prisma migrate dev`. Never run anything that writes to the main database; the owner runs `npm run db:deploy`.
  - Only one database test run at a time, because tests share one Neon test database. Tests that don't touch the database run with `--config vitest.unit.config.ts`.
- Don't stop the owner's dev servers (port 3000 `next dev`, port 4000 `tsx watch`). Leave the untracked `video/` folder alone.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Frontend: Next.js 16 has breaking changes. This plan only edits client components, so the guides in `frontend/node_modules/next/dist/docs/` aren't needed here, but read the relevant one before writing anything Next-specific.

## Review Focus

1. **Cloudflare sends back JPEG or WebP instead of PNG:** the image is saved with the matching extension and mime (`logo.jpg`, `image/jpeg`). Test in Task 3.
2. **The owner presses Stop while an image is being made:** the request is aborted and nothing is saved. Test in Task 3 (the cancel test checks `media.save` was never called).
3. **The goal's project is full:** the owner still sees the image on the task card, the companion is told it wasn't added, and no applied change is recorded. Test in Task 5.
4. **`from` names a file that exists but isn't an image** (`menu.md`): the companion gets "menu.md isn't an image." Test in Task 5.
5. **A prompt with no Latin letters** (Hindi, Japanese): the file is named `image.png`, then `image (2).png` in a project. Test in Task 3 (slug); the numbering is the existing `freePath` behaviour.

---

### Task 1: Slow tools — per-tool time limit, cost note, keep-alive pings

**Files:**
- Modify: `backend/src/harness/loop.ts` (types `ToolOutput`, `Tool`; `runTool`; the `toolUses.push` in `runLoop`)
- Modify: `backend/src/chat-stream.ts` (`streamReply`: ping interval)
- Test: `backend/test/harness-loop.test.ts`

**Interfaces:**
- Produces:
  - `ToolOutput = { text: string; images: { mime: string; data: string }[]; note?: string }`;
  - `Tool` gains `timeoutMs?: number`;
  - a saved `ToolUse.label` becomes `` `${label} · ${note}` `` when the tool returned a `note`.

- [ ] **Step 1: Write the failing test.** Append to `backend/test/harness-loop.test.ts`:

```ts
test("a tool can set its own time limit, and a result note is added to the saved label", async () => {
  const slowOk: Tool<{ word: string }> = { ...echo, name: "slow", timeoutMs: 1_000, run: async (a) => { await new Promise((r) => setTimeout(r, 200)); return { text: `slow ${a.word}`, images: [], note: "free" }; } };
  const stuck: Tool<{ word: string }> = { ...echo, name: "stuck", timeoutMs: 50, run: () => new Promise(() => {}) };
  const { done } = run([slowOk, stuck], [fence({ tool: "slow", args: { word: "a" } }), fence({ tool: "stuck", args: { word: "b" } }), "final"]);
  const r = await done;
  expect(r.toolUses.map((u) => [u.name, u.label, u.ok])).toEqual([["slow", "a · free", true], ["stuck", "b", false]]);
  expect(JSON.stringify(r.turns)).toContain("That took too long and was stopped.");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && npx vitest run --config vitest.unit.config.ts test/harness-loop.test.ts -t "own time limit"`
Expected: FAIL. TypeScript accepts the extra fields at runtime, but the label is `a`, not `a · free`, and the stuck tool runs for 20 s and times out the test, or the label check fails first.

- [ ] **Step 3: Implement.** In `backend/src/harness/loop.ts`, replace the two type lines:

```ts
export type ToolOutput = { text: string; images: { mime: string; data: string }[]; note?: string };
export type Tool<A = any> = { name: string; purpose: string; argsHelp: string; args: z.ZodType<A>; label: (a: A) => string; run: (a: A, signal: AbortSignal) => Promise<string | ToolOutput>; finishOnStop?: boolean; timeoutMs?: number };
```

Add one comment line above `export type ToolOutput`:

```ts
/** note: a few words added to the saved activity label (an image's cost); timeoutMs: a tool slower than the 20 s default (image generation). */
```

In `runTool`, change the signature's return type and the first line:

```ts
async function runTool(tool: Tool, args: unknown, signal: AbortSignal): Promise<{ ok: boolean; text: string; images: ToolOutput["images"]; note?: string }> {
  const timeout = AbortSignal.timeout(tool.timeoutMs ?? TOOL_TIMEOUT_MS);
```

In `runLoop`, change the `toolUses.push(...)` line to:

```ts
        toolUses.push({ name: tool.name, label: r.note ? `${label} · ${r.note}` : label, ok: r.ok, ms: Date.now() - started, chars: r.text.length });
```

In `backend/src/chat-stream.ts`, right after `send("start", opts.start);`, add:

```ts
  // Keeps proxies from closing a stream that's quiet while a slow tool (an image) runs; readers skip comment lines.
  const ping = setInterval(() => {
    if (!raw.writableEnded && !raw.destroyed) raw.write(": ping\n\n");
  }, 15_000);
```

and in the `finally` at the end of `streamReply` (the one with `if (!raw.writableEnded) raw.end();`), add `clearInterval(ping);` as its first line.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && npx vitest run --config vitest.unit.config.ts test/harness-loop.test.ts && npx tsc --noEmit -p .`
Expected: all harness-loop tests pass and tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/harness/loop.ts backend/src/chat-stream.ts backend/test/harness-loop.test.ts
git commit -m "feat(backend): tools can be slower than 20 s and add a note to their activity label; chat streams send keep-alive pings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Database — image keys, task-linked attachments, cleanup

**Files:**
- Modify: `backend/prisma/schema.prisma` (models `Attachment`, `GoalTask`, `Workspace`; new `ImageKey`)
- Create: `backend/prisma/migrations/<timestamp>_image_generation/migration.sql` (generated)
- Modify: `backend/src/attachments/service.ts` (`cleanupAttachments`)
- Test: `backend/test/image-storage.test.ts` (new; Task 5 adds to it)

**Interfaces:**
- Produces:
  - `prisma.imageKey`, with fields `id, workspaceId, provider, secret, hint, createdById, createdAt` and the compound unique `workspaceId_provider`;
  - `Attachment.taskId: string | null`;
  - the `GoalTask.media` relation.

- [ ] **Step 1: Write the failing test.** Create `backend/test/image-storage.test.ts`:

```ts
import sharp from "sharp";
import { afterAll, expect, test, vi } from "vitest";
import { cleanupAttachments } from "../src/attachments/service.js";
import { prisma } from "../src/db.js";
import { putBlob } from "../src/files/store.js";
import { createGoal } from "../src/goals/create.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c96" } }).png().toBuffer();
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");

test("the daily cleanup removes unlinked uploads but keeps images that belong to a task", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isPlan(s) ? fence({ tasks: [{ agentId: co.others[0].id, title: "t", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));
  const me = (await co.req("GET", "/api/me")).json().user.id as string;
  const { id: gid } = await createGoal({ workspaceId: co.id, userId: me, text: "Plan" });
  const goal = await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (g) => g.status === "awaiting_approval");
  const old = new Date(Date.now() - 25 * 3600_000);
  const blobHash = await putBlob(PNG);
  const row = { workspaceId: co.id, userId: me, mime: "image/png", kind: "image", size: PNG.length, blobHash, createdAt: old };
  const loose = await prisma.attachment.create({ data: { ...row, name: "loose.png" } });
  const kept = await prisma.attachment.create({ data: { ...row, name: "kept.png", taskId: goal.tasks[0].id } });
  await cleanupAttachments();
  expect(await prisma.attachment.findUnique({ where: { id: loose.id } })).toBeNull();
  expect(await prisma.attachment.findUnique({ where: { id: kept.id } })).not.toBeNull();
});
```

- [ ] **Step 2: Install `sharp` (the test file uses it) and confirm the test fails**

Run: `cd backend && npm install --save-exact sharp@0.35.4 && npx vitest run test/image-storage.test.ts`
Expected: FAIL to type-check or at runtime: `taskId` is not a known field of `Attachment`.

- [ ] **Step 3: Change the schema.** In `backend/prisma/schema.prisma`:

In `model Attachment`, add a field after `goalId String?`:

```prisma
  taskId        String?
```

then a relation after the `message` relation line:

```prisma
  task          GoalTask?    @relation(fields: [taskId], references: [id], onDelete: Cascade)
```

and an index next to the others:

```prisma
  @@index([taskId])
```

In `model GoalTask`, after `edits ProposedEdit[]`:

```prisma
  media            Attachment[]
```

In `model Workspace`, next to `searchKey SearchKey?`:

```prisma
  imageKeys    ImageKey[]
```

Add a new model after `model SearchKey { … }`:

```prisma
/** Keys for image services; secret is encrypted (Cloudflare: JSON {accountId, apiToken}). */
model ImageKey {
  id          String    @id @default(cuid())
  workspaceId String
  provider    String
  secret      String
  hint        String
  createdById String
  createdAt   DateTime  @default(now())
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, provider])
}
```

- [ ] **Step 4: Create the migration on the test database only**

Run: `cd backend && USE_TEST_DB=1 npx prisma migrate dev --name image_generation`
Expected: a new folder `prisma/migrations/<timestamp>_image_generation/` containing `CREATE TABLE "ImageKey"`, `ALTER TABLE "Attachment" ADD COLUMN "taskId"`, the index and the foreign key. Applied to the `test` database. Prisma Client is regenerated.

- [ ] **Step 5: Update the cleanup.** In `backend/src/attachments/service.ts`, change the `cleanupAttachments` query's `where` to:

```ts
  const r = await prisma.attachment.deleteMany({ where: { messageId: null, goalMessageId: null, goalId: null, taskId: null, createdAt: { lt: new Date(now - DAY_MS) } } });
```

and its comment to `/** Uploads never sent with a message, and images never linked to a reply or task, are removed after a day. */`

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd backend && npx vitest run test/image-storage.test.ts && npx tsc --noEmit -p .`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/attachments/service.ts backend/test/image-storage.test.ts backend/package.json backend/package-lock.json
git commit -m "feat(backend): image keys table; attachments can belong to a task and survive the daily cleanup

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The image services and the `generate_image` tool

**Files:**
- Create: `backend/src/harness/images.ts`
- Modify: `backend/test/fake-provider.ts` (record raw request bytes)
- Test: `backend/test/images-tool.test.ts` (new, no database)

**Interfaces:**
- Consumes:
  - `Tool`, `ToolOutput`, `ToolError` from `./loop.js` (Task 1 fields `timeoutMs` and `note`);
  - `detect` from `../attachments/detect.js`;
  - `imageFits` from `../attachments/parts.js`;
  - `testOverride` from `../env.js`;
  - `decryptSecret` from `../crypto.js`;
  - `prisma.imageKey` (Task 2).
- Produces:
  - `type CloudflareKey = { accountId: string; apiToken: string }`
  - `type ImageKeys = { cloudflare: CloudflareKey | null; pollinations: string | null }`
  - `type MediaStore = { save(data: Buffer, fileName: string): Promise<string> }`: returns the first part of the result sentence without a full stop, e.g. `Saved as images/hero.png`.
  - `type ImageSource = (name: string) => Promise<Buffer>`: throws `ToolError` when there's no such image.
  - `imageTool(keys, media, source): Tool | null`
  - `loadImageKeys(workspaceId): Promise<ImageKeys>`
  - `checkCloudflare(key, signal): Promise<void>` and `checkPollinations(key, signal): Promise<void>`, which throw `ToolError` with a plain message.
  - `shrink(data, max): Promise<Buffer>`, `slug(prompt): string`, `MAX_IMAGES = 4`, `IMAGE_TIMEOUT_MS = 120_000`
  - `FakeRequest.bytes: Buffer` in the test helper.

- [ ] **Step 1: Record raw bytes in the fake server.** In `backend/test/fake-provider.ts`, change the type and the record:

```ts
export type FakeRequest = { method: string; path: string; headers: IncomingMessage["headers"]; body: unknown; raw: string; bytes: Buffer };
```

```ts
    const bytes = Buffer.concat(chunks);
    const raw = bytes.toString();
```

(replacing `const raw = Buffer.concat(chunks).toString();`), and:

```ts
    const record = { method: req.method ?? "GET", path, headers: req.headers, body, raw, bytes };
```

- [ ] **Step 2: Write the failing tests.** Create `backend/test/images-tool.test.ts`:

```ts
import type { ServerResponse } from "node:http";
import sharp from "sharp";
import { afterAll, beforeEach, expect, test } from "vitest";
import { IMAGE_TIMEOUT_MS, imageTool, slug, type ImageKeys, type ImageSource, type MediaStore } from "../src/harness/images.js";
import { ToolError, type ToolOutput } from "../src/harness/loop.js";
import { fakeServer, json, type FakeRequest } from "./fake-provider.js";

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#c96" } }).png().toBuffer();
const PNG = await png(8, 8);
const B64 = PNG.toString("base64");
const CF_PATH = "POST /accounts/acc123/ai/run/@cf/black-forest-labs/flux-2-klein-4b";
const cf = await fakeServer({});
const pol = await fakeServer({});
process.env.TEST_CLOUDFLARE_BASE_URL = cf.url;
process.env.TEST_POLLINATIONS_BASE_URL = pol.url;
afterAll(async () => {
  await cf.close();
  await pol.close();
});
beforeEach(() => {
  for (const s of [cf, pol]) {
    s.requests.length = 0;
    for (const k of Object.keys(s.routes)) delete s.routes[k];
  }
});

const CF_KEY = { accountId: "acc123", apiToken: "cf-token" };
const both: ImageKeys = { cloudflare: CF_KEY, pollinations: "sk_pol" };
const cfOnly: ImageKeys = { cloudflare: CF_KEY, pollinations: null };
const cfImage = (data: Buffer) => (_q: FakeRequest, res: ServerResponse) => json(res, 200, { success: true, result: { image: data.toString("base64") } });
const polOk = (_q: FakeRequest, res: ServerResponse) => json(res, 200, { data: [{ b64_json: B64 }] });
const formOf = (q: FakeRequest) => new Response(new Uint8Array(q.bytes), { headers: { "content-type": String(q.headers["content-type"]) } }).formData();
const sizeOf = async (f: FormDataEntryValue | null) => sharp(Buffer.from(await (f as File).arrayBuffer())).metadata();

function store() {
  const saved: string[] = [];
  const media: MediaStore = { save: async (_d, name) => (saved.push(name), `Saved as images/${name}`) };
  return { saved, media };
}
const noSource: ImageSource = async (name) => {
  throw new ToolError(`There's no image called ${name}. Use list_attachments or list_files to see them.`);
};
async function make(keys: ImageKeys, args: object, o: { media?: MediaStore; source?: ImageSource } = {}) {
  const tool = imageTool(keys, o.media ?? store().media, o.source ?? noSource)!;
  return (await tool.run(tool.args.parse(args), new AbortController().signal)) as ToolOutput;
}

test("standard images come from free Cloudflare and come back as a picture with the cost note", async () => {
  cf.routes[CF_PATH] = cfImage(PNG);
  const { saved, media } = store();
  const out = await make(both, { prompt: "A warm bakery logo with wheat", name: "logo" }, { media });
  expect(out).toEqual({ text: "Saved as images/logo.png (Cloudflare, free).", note: "free", images: [{ mime: "image/png", data: B64 }] });
  expect(saved).toEqual(["logo.png"]);
  expect(pol.requests).toHaveLength(0);
  expect(cf.requests[0].headers.authorization).toBe("Bearer cf-token");
  const form = await formOf(cf.requests[0]);
  expect([form.get("prompt"), form.get("width"), form.get("height")]).toEqual(["A warm bakery logo with wheat", "1024", "1024"]);
});

test("a JPEG from Cloudflare is saved as .jpg", async () => {
  const jpeg = await sharp(PNG).jpeg().toBuffer();
  cf.routes[CF_PATH] = cfImage(jpeg);
  const { saved, media } = store();
  const out = await make(cfOnly, { prompt: "Bread" }, { media });
  expect(saved).toEqual(["bread.jpg"]);
  expect(out.images[0].mime).toBe("image/jpeg");
});

test("high quality goes to Pollinations gpt-image-2; without Pollinations it falls back to Cloudflare with a caveat", async () => {
  pol.routes["POST /v1/images/generations"] = polOk;
  cf.routes[CF_PATH] = cfImage(PNG);
  const high = await make(both, { prompt: "Poster that says OPEN", quality: "high", size: "portrait" });
  expect(high).toMatchObject({ text: "Saved as images/poster-that-says-open.png (Pollinations, ~$0.05).", note: "~$0.05" });
  expect(pol.requests[0].body).toMatchObject({ model: "openai/gpt-image-2", prompt: "Poster that says OPEN", size: "1024x1536", quality: "medium", response_format: "b64_json" });
  expect(pol.requests[0].headers.authorization).toBe("Bearer sk_pol");
  const free = await make(cfOnly, { prompt: "Poster that says OPEN", quality: "high" });
  expect(free.text).toBe("Saved as images/poster-that-says-open.png (Cloudflare, free). Made with the free service, so text in this image may be less accurate.");
});

test("when Cloudflare's free images are used up, standard images fall back to Pollinations klein; with no Pollinations key the owner hears when they return", async () => {
  cf.routes[CF_PATH] = (_q, res) => json(res, 429, { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] });
  pol.routes["POST /v1/images/generations"] = polOk;
  const out = await make(both, { prompt: "Bread", size: "landscape" });
  expect(out).toMatchObject({ text: "Saved as images/bread.png (Pollinations, ~$0.005).", note: "~$0.005" });
  expect(pol.requests[0].body).toMatchObject({ model: "black-forest-labs/flux.2-klein-4b", size: "1536x1024" });
  await expect(make(cfOnly, { prompt: "Bread" })).rejects.toThrow("Today's free images are used up; they come back at 00:00 UTC.");
});

test("a rejected key says where to fix it; a refused description doesn't fall back", async () => {
  cf.routes[CF_PATH] = (_q, res) => json(res, 401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] });
  await expect(make(cfOnly, { prompt: "Bread" })).rejects.toThrow("The Cloudflare key was rejected. Update it in Settings › AI services.");
  cf.routes[CF_PATH] = (_q, res) => json(res, 400, { success: false, errors: [{ code: 3030, message: "flagged" }] });
  pol.routes["POST /v1/images/generations"] = polOk;
  await expect(make(both, { prompt: "Bread" })).rejects.toThrow("The image service refused this description. Try different wording.");
  expect(pol.requests).toHaveLength(0);
});

test("at most 4 images per reply", async () => {
  cf.routes[CF_PATH] = cfImage(PNG);
  const tool = imageTool(cfOnly, store().media, noSource)!;
  for (let i = 0; i < 4; i++) await tool.run(tool.args.parse({ prompt: `Bread ${i}` }), new AbortController().signal);
  await expect(tool.run(tool.args.parse({ prompt: "Bread 5" }), new AbortController().signal)).rejects.toThrow("That's 4 images for this reply, the limit. Finish with what you have.");
  expect(cf.requests).toHaveLength(4);
});

test("edits shrink their inputs: under 512 px for Cloudflare, within 1536 px for Pollinations", async () => {
  const big = await png(2000, 1000);
  const source: ImageSource = async (name) => (name === "cake.png" ? big : noSource(name));
  cf.routes[CF_PATH] = cfImage(PNG);
  await make(cfOnly, { prompt: "Put image 1 on marble next to image 2", from: ["cake.png", "cake.png"] }, { source });
  const form = await formOf(cf.requests[0]);
  for (const field of ["input_image_0", "input_image_1"]) {
    const meta = await sizeOf(form.get(field));
    expect(meta.width).toBe(511);
    expect(meta.height!).toBeLessThan(512);
  }
  pol.routes["POST /v1/images/edits"] = polOk;
  await make({ cloudflare: null, pollinations: "sk_pol" }, { prompt: "Put image 1 on marble", from: ["cake.png"] }, { source });
  const pform = await formOf(pol.requests[0]);
  const meta = await sizeOf(pform.getAll("image")[0]);
  expect([meta.width, meta.height]).toEqual([1536, 768]);
  expect([pform.get("model"), pform.get("prompt")]).toEqual(["black-forest-labs/flux.2-klein-4b", "Put image 1 on marble"]);
  await expect(make(cfOnly, { prompt: "x", from: ["nope.png"] }, { source })).rejects.toThrow("There's no image called nope.png. Use list_attachments or list_files to see them.");
});

test("cancelling stops the request and saves nothing", async () => {
  cf.routes[CF_PATH] = () => new Promise<void>(() => {});
  const { saved, media } = store();
  const tool = imageTool(cfOnly, media, noSource)!;
  const c = new AbortController();
  const pending = tool.run(tool.args.parse({ prompt: "Bread" }), c.signal);
  setTimeout(() => c.abort(), 100);
  await expect(pending).rejects.toThrow();
  expect(saved).toEqual([]);
});

test("no keys, no tool; a 2-minute limit; names come from the prompt's first five words", () => {
  expect(imageTool({ cloudflare: null, pollinations: null }, store().media, noSource)).toBeNull();
  expect(imageTool(cfOnly, store().media, noSource)!.timeoutMs).toBe(IMAGE_TIMEOUT_MS);
  expect(IMAGE_TIMEOUT_MS).toBe(120_000);
  expect(slug("A Warm bakery logo, with wheat & sun!")).toBe("a-warm-bakery-logo-with");
  expect(slug("ताज़ी रोटी")).toBe("image");
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd backend && npx vitest run --config vitest.unit.config.ts test/images-tool.test.ts`
Expected: FAIL with "Cannot find module '../src/harness/images.js'".

- [ ] **Step 4: Implement.** Create `backend/src/harness/images.ts`:

```ts
import sharp from "sharp";
import { z } from "zod";
import { detect } from "../attachments/detect.js";
import { imageFits } from "../attachments/parts.js";
import { decryptSecret } from "../crypto.js";
import { prisma } from "../db.js";
import { testOverride } from "../env.js";
import { ToolError, type Tool } from "./loop.js";

export type CloudflareKey = { accountId: string; apiToken: string };
export type ImageKeys = { cloudflare: CloudflareKey | null; pollinations: string | null };
/** Where a made image goes; returns the start of the result sentence ("Saved as images/hero.png"). */
export type MediaStore = { save(data: Buffer, fileName: string): Promise<string> };
/** The bytes of an image named in `from`; throws a ToolError when there is none. */
export type ImageSource = (name: string) => Promise<Buffer>;

export const MAX_IMAGES = 4;
export const IMAGE_TIMEOUT_MS = 120_000;
const SIZES = { square: [1024, 1024], landscape: [1536, 1024], portrait: [1024, 1536] } as const;
type Size = (typeof SIZES)[keyof typeof SIZES];
const CF_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const POL_STANDARD = "black-forest-labs/flux.2-klein-4b";
const POL_HIGH = "openai/gpt-image-2";
// ponytail: fixed prices as of 2026-10; update when the services change them.
const COST = { cloudflare: "free", polStandard: "~$0.005", polHigh: "~$0.05" };
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

const cfBase = () => testOverride("TEST_CLOUDFLARE_BASE_URL") ?? "https://api.cloudflare.com/client/v4";
const polBase = () => testOverride("TEST_POLLINATIONS_BASE_URL") ?? "https://gen.pollinations.ai";

type Failure = "used_up" | "rejected" | "refused" | "failed";
class ImageServiceError extends Error {
  constructor(
    readonly kind: Failure,
    message: string,
  ) {
    super(message);
  }
}
const rejected = (service: string) => new ImageServiceError("rejected", `The ${service} key was rejected. Update it in Settings › AI services.`);
const refused = () => new ImageServiceError("refused", "The image service refused this description. Try different wording.");

function cloudflareError(status: number, message: string) {
  if (status === 401 || status === 403 || status === 404) return rejected("Cloudflare");
  if (status === 429 || /daily free allocation|\b4006\b/i.test(message)) return new ImageServiceError("used_up", "Today's free images are used up; they come back at 00:00 UTC.");
  if (status >= 400 && status < 500) return refused();
  return new ImageServiceError("failed", `Cloudflare isn't working right now (${status}). Try again in a minute.`);
}

function pollinationsError(status: number) {
  if (status === 401 || status === 403) return rejected("Pollinations");
  if (status === 402) return new ImageServiceError("used_up", "The Pollinations balance is used up. Top it up at enter.pollinations.ai.");
  if (status === 429) return new ImageServiceError("failed", "Pollinations is busy right now. Try again in a minute.");
  if (status >= 400 && status < 500) return refused();
  return new ImageServiceError("failed", `Pollinations isn't working right now (${status}). Try again in a minute.`);
}

/** Fits an image inside max×max as PNG, never enlarging it. */
export const shrink = (data: Buffer, max: number) => sharp(data, { animated: false }).resize(max, max, { fit: "inside", withoutEnlargement: true }).png().toBuffer();

const blob = (data: Buffer) => new Blob([new Uint8Array(data)], { type: "image/png" });

async function cloudflareImage(key: CloudflareKey, prompt: string, size: Size, inputs: Buffer[], signal: AbortSignal): Promise<Buffer> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(size[0]));
  form.append("height", String(size[1]));
  // Cloudflare takes at most 4 inputs, each under 512×512.
  (await Promise.all(inputs.map((d) => shrink(d, 511)))).forEach((d, i) => form.append(`input_image_${i}`, blob(d), `image-${i}.png`));
  const res = await fetch(`${cfBase()}/accounts/${encodeURIComponent(key.accountId)}/ai/run/${CF_MODEL}`, { method: "POST", headers: { authorization: `Bearer ${key.apiToken}` }, body: form, signal });
  const body = (await res.json().catch(() => null)) as { result?: { image?: string }; errors?: { code?: number; message?: string }[] } | null;
  if (res.ok && body?.result?.image) return Buffer.from(body.result.image, "base64");
  throw cloudflareError(res.status, (body?.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`).join(" "));
}

async function pollinationsImage(key: string, model: string, prompt: string, size: Size, inputs: Buffer[], signal: AbortSignal): Promise<Buffer> {
  const fields = { model, prompt, size: `${size[0]}x${size[1]}`, quality: "medium", response_format: "b64_json" };
  const auth = { authorization: `Bearer ${key}` };
  let res: Response;
  if (!inputs.length) res = await fetch(`${polBase()}/v1/images/generations`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(fields), signal });
  else {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    (await Promise.all(inputs.map((d) => shrink(d, 1536)))).forEach((d, i) => form.append("image", blob(d), `image-${i}.png`));
    res = await fetch(`${polBase()}/v1/images/edits`, { method: "POST", headers: auth, body: form, signal });
  }
  const body = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
  const image = body?.data?.[0]?.b64_json;
  if (res.ok && image) return Buffer.from(image, "base64");
  throw pollinationsError(res.status);
}

/** "A warm bakery logo, with wheat" → "a-warm-bakery-logo-with"; no Latin letters → "image". */
export const slug = (prompt: string) => prompt.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 5).join("-") || "image";

const Args = z.object({
  prompt: z.string().trim().min(1).max(4000),
  size: z.enum(["square", "landscape", "portrait"]).default("square"),
  quality: z.enum(["standard", "high"]).default("standard"),
  name: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/, "use 1-60 letters, digits, - or _").optional(),
  from: z.array(z.string().min(1).max(300)).max(4).default([]),
});
type ImageArgs = z.infer<typeof Args>;
type Attempt = { service: "Cloudflare" | "Pollinations"; cost: string; make: (inputs: Buffer[], signal: AbortSignal) => Promise<Buffer> };

function attempts(keys: ImageKeys, a: ImageArgs): Attempt[] {
  const size = SIZES[a.size];
  const cf = keys.cloudflare;
  const pk = keys.pollinations;
  const cloudflare: Attempt | null = cf ? { service: "Cloudflare", cost: COST.cloudflare, make: (inputs, signal) => cloudflareImage(cf, a.prompt, size, inputs, signal) } : null;
  const pollinations = (model: string, cost: string): Attempt | null => (pk ? { service: "Pollinations", cost, make: (inputs, signal) => pollinationsImage(pk, model, a.prompt, size, inputs, signal) } : null);
  const order = a.quality === "high" ? [pollinations(POL_HIGH, COST.polHigh), cloudflare] : [cloudflare, pollinations(POL_STANDARD, COST.polStandard)];
  return order.filter((x): x is Attempt => x !== null);
}

/** generate_image: free Cloudflare first, Pollinations for readable text or when Cloudflare can't; at most 4 per reply or task. */
export function imageTool(keys: ImageKeys, media: MediaStore, source: ImageSource): Tool<ImageArgs> | null {
  if (!keys.cloudflare && !keys.pollinations) return null;
  let made = 0;
  return {
    name: "generate_image",
    purpose: `Creates an image from a description, or edits and combines up to 4 existing images named in "from" (call them image 1 to 4 in the prompt, in that order). Use quality "high" only for images that must show readable words (logos, posters, social posts with text) or when the owner asks for high quality: it costs about 5 cents. At most ${MAX_IMAGES} images per reply.`,
    argsHelp: '{"prompt": text, "size"?: "square"|"landscape"|"portrait", "quality"?: "standard"|"high", "name"?: file name without extension, "from"?: [image names]}',
    args: Args,
    label: (a) => `“${a.prompt.length > 40 ? `${a.prompt.slice(0, 40)}…` : a.prompt}”`,
    timeoutMs: IMAGE_TIMEOUT_MS,
    run: async (a, signal) => {
      if (made >= MAX_IMAGES) throw new ToolError(`That's ${MAX_IMAGES} images for this reply, the limit. Finish with what you have.`);
      const inputs = await Promise.all(a.from.map(source));
      const problems: string[] = [];
      for (const at of attempts(keys, a)) {
        let data: Buffer;
        try {
          data = await at.make(inputs, signal);
        } catch (e) {
          if (signal.aborted) throw e;
          if (e instanceof ImageServiceError && e.kind === "refused") throw new ToolError(e.message);
          problems.push(e instanceof ImageServiceError ? e.message : `${at.service} isn't reachable right now.`);
          continue;
        }
        const type = detect("image", data);
        if (type?.kind !== "image") {
          problems.push(`${at.service} sent back something that isn't an image.`);
          continue;
        }
        made++;
        const where = await media.save(data, `${a.name ?? slug(a.prompt)}.${EXT[type.mime]}`);
        const caveat = a.quality === "high" && at.service === "Cloudflare" ? " Made with the free service, so text in this image may be less accurate." : "";
        const text = `${where} (${at.service}, ${at.cost}).${caveat}`;
        return imageFits(data.length) ? { text, images: [{ mime: type.mime, data: data.toString("base64") }], note: at.cost } : { text: `${text} It's too large to show you.`, images: [], note: at.cost };
      }
      throw new ToolError(problems.join(" "));
    },
  };
}

export async function loadImageKeys(workspaceId: string): Promise<ImageKeys> {
  const rows = await prisma.imageKey.findMany({ where: { workspaceId } });
  const secret = (provider: string) => {
    const row = rows.find((r) => r.provider === provider);
    return row ? decryptSecret(row.secret) : null;
  };
  const cf = secret("cloudflare");
  return { cloudflare: cf ? (JSON.parse(cf) as CloudflareKey) : null, pollinations: secret("pollinations") };
}

/** Free checks used when a key is saved: neither makes an image. */
export async function checkCloudflare(key: CloudflareKey, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${cfBase()}/accounts/${encodeURIComponent(key.accountId)}/ai/models/search?per_page=1`, { headers: { authorization: `Bearer ${key.apiToken}` }, signal });
  } catch {
    throw new ToolError("Cloudflare isn't reachable right now. Try again in a minute.");
  }
  if (res.ok) return;
  if (res.status >= 400 && res.status < 500) throw new ToolError("Cloudflare rejected that Account ID or API token. Check both, and that the token can use Workers AI.");
  throw new ToolError(`Cloudflare isn't working right now (${res.status}). Try again in a minute.`);
}

export async function checkPollinations(key: string, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${polBase()}/account/key`, { headers: { authorization: `Bearer ${key}` }, signal });
  } catch {
    throw new ToolError("Pollinations isn't reachable right now. Try again in a minute.");
  }
  const body = (await res.json().catch(() => null)) as { valid?: boolean } | null;
  if (res.ok && body?.valid !== false) return;
  if (res.ok || (res.status >= 400 && res.status < 500)) throw new ToolError("Pollinations rejected that key. Use a secret key (sk_…) from enter.pollinations.ai.");
  throw new ToolError(`Pollinations isn't working right now (${res.status}). Try again in a minute.`);
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd backend && npx vitest run --config vitest.unit.config.ts test/images-tool.test.ts test/harness-loop.test.ts && npx tsc --noEmit -p .`
Expected: all pass, and tsc prints nothing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/harness/images.ts backend/test/images-tool.test.ts backend/test/fake-provider.ts
git commit -m "feat(backend): generate_image tool — free Cloudflare FLUX.2 klein first, Pollinations for text and volume, edits, 4-image cap, cost note

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Image keys in Settings (backend routes)

**Files:**
- Create: `backend/src/routes/image-keys.ts`
- Modify: `backend/src/routes/search-key.ts` (export `hint`)
- Modify: `backend/src/app.ts` (register the routes)
- Test: `backend/test/image-keys.test.ts` (new)

**Interfaces:**
- Consumes: `checkCloudflare`, `checkPollinations`, `loadImageKeys`, `CloudflareKey` from `../harness/images.js` (Task 3); `prisma.imageKey` (Task 2).
- Produces:
  - `GET /api/workspaces/:id/image-keys` → `{ cloudflare: { hint } | null, pollinations: { hint } | null }`
  - `PUT /api/workspaces/:id/image-keys/cloudflare` with `{ accountId, apiToken }` → `{ hint }`
  - `PUT /api/workspaces/:id/image-keys/pollinations` with `{ apiKey }` → `{ hint }`
  - `DELETE /api/workspaces/:id/image-keys/:provider` → 204

- [ ] **Step 1: Write the failing test.** Create `backend/test/image-keys.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { loadImageKeys } from "../src/harness/images.js";
import { fakeServer, json } from "./fake-provider.js";
import { client, makeApp, signUp } from "./helpers.js";

const ACC = "0123456789abcdef0123456789abcdef";
const app = await makeApp();
const cf = await fakeServer({
  [`GET /accounts/${ACC}/ai/models/search`]: (q, res) => (q.headers.authorization === "Bearer good-cloudflare-token-123" ? json(res, 200, { success: true, result: [] }) : json(res, 403, { success: false })),
});
const pol = await fakeServer({
  "GET /account/key": (q, res) => (q.headers.authorization === "Bearer sk_good_pollinations" ? json(res, 200, { valid: true, type: "secret" }) : json(res, 401, { error: "invalid key" })),
});
process.env.TEST_CLOUDFLARE_BASE_URL = cf.url;
process.env.TEST_POLLINATIONS_BASE_URL = pol.url;
afterAll(async () => {
  await cf.close();
  await pol.close();
  await app.close();
});

test("admins add image keys after a free check; only hints come back; keys are stored encrypted; members can't change them", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Pics Co", template: "starter" })).json().id as string;
  const base = `/api/workspaces/${id}/image-keys`;
  expect((await req("GET", base)).json()).toEqual({ cloudflare: null, pollinations: null });

  const bad = await req("PUT", `${base}/cloudflare`, { accountId: ACC, apiToken: "wrong-cloudflare-token-12" });
  expect(bad.statusCode).toBe(400);
  expect(bad.json().error.message).toMatch(/rejected/);
  expect((await req("PUT", `${base}/cloudflare`, { accountId: "not-an-account", apiToken: "good-cloudflare-token-123" })).statusCode).toBe(400);
  expect((await req("PUT", `${base}/pollinations`, { apiKey: "sk_wrong_pollinations" })).statusCode).toBe(400);

  expect((await req("PUT", `${base}/cloudflare`, { accountId: ACC, apiToken: "good-cloudflare-token-123" })).json()).toEqual({ hint: "goo…-123" });
  expect((await req("PUT", `${base}/pollinations`, { apiKey: "sk_good_pollinations" })).json()).toEqual({ hint: "sk_…ions" });
  const shown = JSON.stringify((await req("GET", base)).json());
  expect(shown).toBe(JSON.stringify({ cloudflare: { hint: "goo…-123" }, pollinations: { hint: "sk_…ions" } }));
  const stored = JSON.stringify(await prisma.imageKey.findMany({ where: { workspaceId: id } }));
  expect(stored).not.toContain("good-cloudflare-token-123");
  expect(stored).not.toContain("sk_good_pollinations");
  expect(await loadImageKeys(id)).toEqual({ cloudflare: { accountId: ACC, apiToken: "good-cloudflare-token-123" }, pollinations: "sk_good_pollinations" });
  expect(await prisma.auditLog.count({ where: { workspaceId: id, action: "image_key.set" } })).toBe(2);

  const member = await signUp(app);
  const m = client(app, member.cookie);
  const mid = (await m("GET", "/api/me")).json().user.id as string;
  await prisma.membership.create({ data: { workspaceId: id, userId: mid, role: "member" } });
  expect((await m("GET", base)).json().cloudflare).toEqual({ hint: "goo…-123" });
  expect((await m("PUT", `${base}/pollinations`, { apiKey: "sk_good_pollinations" })).statusCode).toBe(403);
  expect((await m("DELETE", `${base}/pollinations`)).statusCode).toBe(403);

  expect((await req("DELETE", `${base}/pollinations`)).statusCode).toBe(204);
  expect((await loadImageKeys(id)).pollinations).toBeNull();
  expect(await prisma.auditLog.count({ where: { workspaceId: id, action: "image_key.delete" } })).toBe(1);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd backend && npx vitest run test/image-keys.test.ts`
Expected: FAIL with a 404 on `GET /api/workspaces/:id/image-keys` (`toEqual` mismatch).

- [ ] **Step 3: Implement.** In `backend/src/routes/search-key.ts`, change `const hint =` to `export const hint =`.

Create `backend/src/routes/image-keys.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptSecret } from "../crypto.js";
import { prisma } from "../db.js";
import { checkCloudflare, checkPollinations } from "../harness/images.js";
import { ToolError } from "../harness/loop.js";
import { audit, HttpError, requireMember } from "../http.js";
import { hint } from "./search-key.js";
import { WsParams } from "./workspaces.js";

const Provider = z.enum(["cloudflare", "pollinations"]);
const Cloudflare = z.object({ accountId: z.string().trim().regex(/^[a-f0-9]{32}$/i, "An Account ID is 32 letters and digits"), apiToken: z.string().trim().min(20).max(200) });
const Pollinations = z.object({ apiKey: z.string().trim().regex(/^sk_[A-Za-z0-9_-]{8,200}$/, "Use a Pollinations secret key (it starts with sk_)") });

/** The key check's plain message becomes a 400 for the Settings form. */
async function checked(check: () => Promise<void>) {
  try {
    await check();
  } catch (e) {
    if (e instanceof ToolError) throw new HttpError(400, "invalid", e.message);
    throw e;
  }
}

async function saveKey(workspaceId: string, userId: string, provider: z.infer<typeof Provider>, secret: string, shown: string) {
  const data = { secret: encryptSecret(secret), hint: hint(shown), createdById: userId };
  await prisma.imageKey.upsert({ where: { workspaceId_provider: { workspaceId, provider } }, create: { workspaceId, provider, ...data }, update: data });
  await audit(prisma, workspaceId, userId, "image_key.set", "workspace", workspaceId);
  return { hint: data.hint };
}

export async function imageKeyRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/image-keys", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    const rows = await prisma.imageKey.findMany({ where: { workspaceId: id } });
    const of = (provider: string) => {
      const row = rows.find((r) => r.provider === provider);
      return row ? { hint: row.hint } : null;
    };
    return { cloudflare: of("cloudflare"), pollinations: of("pollinations") };
  });

  app.put("/api/workspaces/:id/image-keys/cloudflare", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const key = Cloudflare.parse(req.body);
    await checked(() => checkCloudflare(key, AbortSignal.timeout(15_000)));
    return saveKey(id, user.id, "cloudflare", JSON.stringify(key), key.apiToken);
  });

  app.put("/api/workspaces/:id/image-keys/pollinations", async (req) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    const { apiKey } = Pollinations.parse(req.body);
    await checked(() => checkPollinations(apiKey, AbortSignal.timeout(15_000)));
    return saveKey(id, user.id, "pollinations", apiKey, apiKey);
  });

  app.delete("/api/workspaces/:id/image-keys/:provider", async (req, reply) => {
    const { id, provider } = WsParams.extend({ provider: Provider }).parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    await prisma.imageKey.deleteMany({ where: { workspaceId: id, provider } });
    await audit(prisma, id, user.id, "image_key.delete", "workspace", id);
    return reply.code(204).send();
  });
}
```

In `backend/src/app.ts`, add `import { imageKeyRoutes } from "./routes/image-keys.js";` next to the `searchKeyRoutes` import, and `await app.register(imageKeyRoutes);` right after `await app.register(searchKeyRoutes);`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && npx vitest run test/image-keys.test.ts test/search-key.test.ts && npx tsc --noEmit -p .`
Expected: PASS, and tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/image-keys.ts backend/src/routes/search-key.ts backend/src/app.ts backend/test/image-keys.test.ts
git commit -m "feat(backend): Cloudflare and Pollinations image keys — checked for free on save, encrypted, admin-only

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Made images — storage, chats, tasks, goal page, design guide

**Files:**
- Modify: `backend/src/attachments/service.ts` (new `madeImages`)
- Modify: `backend/src/routes/conversations.ts`, `backend/src/routes/chat.ts`, `backend/src/routes/goal-chat.ts` (add the tool; link rows when the reply is saved)
- Modify: `backend/src/goals/runner.ts` (add the tool for tasks)
- Modify: `backend/src/routes/goals.ts` (`withTasks` includes `media`; the DTO adds `media`)
- Modify: `backend/src/harness/tools.ts` (`list_attachments` purpose)
- Modify: `backend/src/goals/quality.ts` (`DESIGN_GUIDE` line)
- Test: `backend/test/image-storage.test.ts` (add tests)

**Interfaces:**
- Consumes: `imageTool`, `loadImageKeys`, `MediaStore`, `ImageSource` (Task 3); `Attachment.taskId` and `GoalTask.media` (Task 2); the image-key routes (Task 4, used by the tests).
- Produces:
  - `madeImages(o: { workspaceId: string; userId: string; files: Attachment[]; project: Project | null; task?: { id: string; goalId: string } }) → { media: MediaStore; source: ImageSource; link(to: { messageId: string } | { goalMessageId: string }): Promise<void> }`
  - the goal API's `task.media: AttachmentDTO[]`.

- [ ] **Step 1: Write the failing tests.** In `backend/test/image-storage.test.ts`:

Replace the imports and setup at the top with:

```ts
import sharp from "sharp";
import { afterAll, expect, test, vi } from "vitest";
import { cleanupAttachments, madeImages } from "../src/attachments/service.js";
import { prisma } from "../src/db.js";
import { putBlob } from "../src/files/store.js";
import { createGoal } from "../src/goals/create.js";
import { fakeServer, json, type FakeRequest } from "./fake-provider.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const ACC = "0123456789abcdef0123456789abcdef";
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c96" } }).png().toBuffer();
const llm = await fakeLLM();
const app = await makeApp();
const cf = await fakeServer({
  [`GET /accounts/${ACC}/ai/models/search`]: (_q, res) => json(res, 200, { success: true, result: [] }),
  [`POST /accounts/${ACC}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`]: (_q, res) => json(res, 200, { success: true, result: { image: PNG.toString("base64") } }),
});
process.env.TEST_CLOUDFLARE_BASE_URL = cf.url;
afterAll(async () => {
  await llm.close();
  await cf.close();
  await app.close();
});
const tool = (name: string, args: object) => fence({ tool: name, args });
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !isPlan(s);
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review a teammate's finished task");
const formOf = (q: FakeRequest) => new Response(new Uint8Array(q.bytes), { headers: { "content-type": String(q.headers["content-type"]) } }).formData();
type Co = Awaited<ReturnType<typeof company>>;
const withCloudflare = async (co: Co) => expect((await co.req("PUT", `/api/workspaces/${co.id}/image-keys/cloudflare`, { accountId: ACC, apiToken: "good-cloudflare-token-123" })).statusCode).toBe(200);
const userId = async (co: Co) => (await co.req("GET", "/api/me")).json().user.id as string;
async function finishGoal(co: Co, text: string) {
  const { id: gid } = await createGoal({ workspaceId: co.id, userId: await userId(co), text, newProject: true });
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "awaiting_approval");
  await co.req("POST", `${base}/start`);
  return waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "done" || g.status === "failed");
}
```

Keep the cleanup test from Task 2 below the setup, unchanged. Then append:

```ts
test("with no image key there's no image tool; with Cloudflare, Nova's image shows under her reply, saves to a project, and can be edited by name", async () => {
  const co = await company(app, llm);
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  const base = `/api/workspaces/${co.id}/conversations/${cid}`;
  const seen: string[] = [];
  llm.setScript((s, u) => {
    if (!isNova(s)) return "ok";
    seen.push(s);
    if (u === "Hello") return "Hi.";
    if (u.startsWith("TOOL RESULT generate_image")) return u.includes("Make image 1 blue") ? "Bluer now." : "Here it is.";
    return /blue/i.test(u) ? tool("generate_image", { prompt: "Make image 1 blue", from: ["logo.png"], name: "logo-blue" }) : tool("generate_image", { prompt: "A warm bakery logo", name: "logo" });
  });
  await co.req("POST", `${base}/messages`, { message: "Hello" });
  expect(seen.at(-1)).not.toContain("generate_image");

  await withCloudflare(co);
  const res = await co.req("POST", `${base}/messages`, { message: "Make me a logo" });
  expect(res.body).toContain('event: tool\ndata: {"name":"generate_image","label":"“A warm bakery logo”"}');
  let reply = (await co.req("GET", base)).json().messages.at(-1);
  expect(reply).toMatchObject({ content: "Here it is.", toolUses: [{ name: "generate_image", label: "“A warm bakery logo” · free", ok: true }], attachments: [{ name: "logo.png", kind: "image", mime: "image/png" }] });
  expect((await co.req("GET", reply.attachments[0].url)).statusCode).toBe(200);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Brand" })).json().id as string;
  expect((await co.req("POST", `/api/workspaces/${co.id}/attachments/${reply.attachments[0].id}/save`, { projectId: pid })).json()).toEqual({ path: "attachments/logo.png" });

  await co.req("POST", `${base}/messages`, { message: "Make it blue" });
  reply = (await co.req("GET", base)).json().messages.at(-1);
  expect(reply.content).toBe("Bluer now.");
  expect(reply.attachments.map((a: { name: string }) => a.name)).toEqual(["logo-blue.png"]);
  expect((await formOf(cf.requests.at(-1)!)).get("input_image_0")).toBeInstanceOf(File);
});

test("task images land in the goal's project under images/, show on the task card, and stop at 4 across Nova's revision round; planning has no image tool", async () => {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  await withCloudflare(co);
  const planSaw: boolean[] = [];
  let n = 0;
  let reviewed = false;
  llm.setScript((s, u) => {
    if (isPlan(s)) {
      planSaw.push(s.includes("generate_image"));
      return fence({ projectName: "Shop", tasks: [{ agentId: co.others[0].id, title: "Make the hero pictures", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    }
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (isReview(s)) {
      if (reviewed) return fence({ approved: true, fixes: [] });
      reviewed = true;
      return fence({ approved: false, fixes: ["Add more pictures"] });
    }
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return u.includes("the limit") ? "Done." : tool("generate_image", { prompt: `Hero picture ${++n}`, name: "hero" });
    return "ok";
  });
  const done = await finishGoal(co, "Make hero pictures");
  expect(done.status).toBe("done");
  expect(planSaw).toEqual([false]);
  expect(reviewed).toBe(true);
  expect(done.tasks[0].media.map((m: { name: string }) => m.name)).toEqual(["hero.png", "hero.png", "hero.png", "hero.png"]);
  const images = done.edits.filter((e: { note: string }) => e.note === "Image").map((e: { path: string; status: string }) => [e.path, e.status]);
  expect(images).toEqual([["images/hero.png", "applied"], ["images/hero (2).png", "applied"], ["images/hero (3).png", "applied"], ["images/hero (4).png", "applied"]]);
  expect(await prisma.projectEntry.count({ where: { projectId: done.projectId, path: { startsWith: "images/" } } })).toBe(4);
});

test("goal chat images belong to the chat message; a non-image can't be edited; a full project still shows the image", async () => {
  const co = await company(app, llm);
  await withCloudflare(co);
  llm.setScript((s, u) => {
    if (isPlan(s)) return fence({ tasks: [{ agentId: co.others[0].id, title: "Say hi", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return "Hi.";
    if (s.includes("You are answering questions about a company goal")) return u.startsWith("TOOL RESULT generate_image") ? "Made a banner." : tool("generate_image", { prompt: "A banner" });
    return "ok";
  });
  const done = await finishGoal(co, "Say hi");
  const chat = `/api/workspaces/${co.id}/goals/${done.id}/chat`;
  await co.req("POST", chat, { message: "Make a banner for this" });
  expect((await co.req("GET", chat)).json().messages.at(-1)).toMatchObject({ content: "Made a banner.", attachments: [{ name: "a-banner.png", kind: "image" }] });

  const me = await userId(co);
  await co.req("PUT", `/api/workspaces/${co.id}/projects/${done.projectId}/files`, { path: "menu.md", content: "Croissant 3", baseRevision: 0 });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: done.projectId } });
  const made = madeImages({ workspaceId: co.id, userId: me, files: [], project, task: { id: done.tasks[0].id, goalId: done.id } });
  await expect(made.source("menu.md")).rejects.toThrow("menu.md isn't an image.");
  await expect(made.source("nope.png")).rejects.toThrow("There's no image called nope.png. Use list_attachments or list_files to see them.");

  await prisma.project.update({ where: { id: done.projectId }, data: { totalBytes: 50 * 1024 * 1024 } });
  const full = madeImages({ workspaceId: co.id, userId: me, files: [], project: { ...project, totalBytes: 50 * 1024 * 1024 }, task: { id: done.tasks[0].id, goalId: done.id } });
  expect(await full.media.save(PNG, "full.png")).toMatch(/^Shown to the owner on the task card as full\.png; it couldn't be added to the project \(/);
  expect(await prisma.proposedEdit.count({ where: { goalId: done.id, note: "Image" } })).toBe(0);
  expect((await co.req("GET", `/api/workspaces/${co.id}/goals/${done.id}`)).json().goal.tasks[0].media.map((m: { name: string }) => m.name)).toEqual(["full.png"]);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx vitest run test/image-storage.test.ts`
Expected: the three new tests FAIL. `madeImages` isn't exported (a TypeError at import or call), and Nova's prompt never offers `generate_image`.

- [ ] **Step 3: Add `madeImages`.** In `backend/src/attachments/service.ts`, extend the imports:

```ts
import { addFiles } from "../files/service.js";
import { getBlob, putBlob } from "../files/store.js";
import type { Attachment, Project } from "../generated/prisma/client.js";
import type { ImageSource, MediaStore } from "../harness/images.js";
import { ToolError } from "../harness/loop.js";
import { HttpError } from "../http.js";
import { detect } from "./detect.js";
```

(keep `prisma` and anything else already imported), then append:

```ts
/**
 * Images companions make while replying or working. Each is stored like an upload, so thumbnails and Save to project work.
 * A chat image is linked to the reply once it's saved (`link`); a task image is linked to the task right away,
 * and in a project it's also copied to images/ and listed with the goal's changes.
 * `source` finds images to edit by name: images made here, the given files, then the project's files.
 */
export function madeImages(o: { workspaceId: string; userId: string; files: Attachment[]; project: Project | null; task?: { id: string; goalId: string } }) {
  const made: Attachment[] = [];
  const media: MediaStore = {
    async save(data, fileName) {
      const mime = detect(fileName, data)?.mime ?? "image/png";
      const row = await prisma.attachment.create({ data: { workspaceId: o.workspaceId, userId: o.userId, name: fileName, mime, kind: "image", size: data.length, blobHash: await putBlob(data), taskId: o.task?.id ?? null } });
      made.push(row);
      if (!o.task) return `Shown to the owner under your reply as ${fileName}`;
      if (!o.project) return `Shown to the owner on the task card as ${fileName}`;
      const path = await freePath(o.project.id, "images", fileName);
      const result = await addFiles(o.project.id, o.userId, [{ path, data }], []);
      if (!result.added) return `Shown to the owner on the task card as ${fileName}; it couldn't be added to the project (${result.skipped[0]?.reason ?? "the project is full"})`;
      await prisma.proposedEdit.create({ data: { taskId: o.task.id, goalId: o.task.goalId, path, baseRevision: 0, content: "", note: "Image", status: "applied", decidedById: o.userId } });
      return `Saved as ${path}`;
    },
  };
  const source: ImageSource = async (name) => {
    const want = name.trim().toLowerCase();
    const att = [...made, ...o.files].find((a) => a.name.toLowerCase() === want);
    let data = att ? await getBlob(att.blobHash) : null;
    if (!data && o.project) {
      const entry = await prisma.projectEntry.findFirst({ where: { projectId: o.project.id, pathLower: want, kind: "file" } });
      if (entry?.blobHash) data = await getBlob(entry.blobHash);
    }
    if (!data) throw new ToolError(`There's no image called ${name}. Use list_attachments or list_files to see them.`);
    if (detect(name, data)?.kind !== "image") throw new ToolError(`${name} isn't an image.`);
    return data;
  };
  const link = async (to: { messageId: string } | { goalMessageId: string }) => {
    if (made.length) await prisma.attachment.updateMany({ where: { id: { in: made.map((m) => m.id) } }, data: to });
  };
  return { media, source, link };
}
```

- [ ] **Step 4: Wire the tool into Nova's conversation chat.** In `backend/src/routes/conversations.ts`, add the imports:

```ts
import { attachmentDTO, linkGoalAttachments, madeImages, ownAttachments } from "../attachments/service.js";
import { imageTool, loadImageKeys } from "../harness/images.js";
```

(replacing the existing `attachments/service.js` import line). Replace the `withFiles` line with:

```ts
    const withFiles = () => [...tools, ...(chatFiles.length ? attachmentTools(chatFiles) : []), ...(image ? [image] : [])];
```

Right after the `const chatFiles = await prisma.attachment.findMany(...)` line, add:

```ts
    const made = madeImages({ workspaceId: id, userId: user.id, files: chatFiles, project: projectRow });
    const image = imageTool(await loadImageKeys(id), made.media, made.source);
```

In the `save: async (r) => { ... }` callback, right after `await saveChatEdits(id, saved.id, projectRow?.id ?? null, writer.edits);`, add:

```ts
        await made.link({ messageId: saved.id });
```

- [ ] **Step 5: Wire it into one-to-one companion chat.** In `backend/src/routes/chat.ts`, change the `attachments/service.js` import to `import { attachmentDTO, madeImages, ownAttachments } from "../attachments/service.js";` and add `import { imageTool, loadImageKeys } from "../harness/images.js";`. After the `const chatFiles = ...` line, add:

```ts
      const made = madeImages({ workspaceId: id, userId: user.id, files: chatFiles, project: null });
      const image = imageTool(await loadImageKeys(id), made.media, made.source);
```

Change the `tools:` line and the `save:` callback to:

```ts
        tools: [...webTools(await loadSearchKey(id)), ...(chatFiles.length ? attachmentTools(chatFiles) : []), ...(image ? [image] : [])],
```

```ts
        save: async (r) => {
          const saved = await prisma.chatMessage.create({
            data: { workspaceId: id, agentId, userId: user.id, role: "assistant", content: r.text, status: r.status, connectionId: conn.id, kind: conn.kind, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, errorCode: r.errorCode, errorMessage: r.errorMessage, toolUses: r.toolUses, visionFallback: r.visionFallback },
          });
          await made.link({ messageId: saved.id });
          return saved;
        },
```

- [ ] **Step 6: Wire it into goal chat.** In `backend/src/routes/goal-chat.ts`, change the import to `import { attachmentDTO, madeImages, ownAttachments } from "../attachments/service.js";` and add `import { imageTool, loadImageKeys } from "../harness/images.js";`. After the `const chatFiles = ...` line, add:

```ts
    const made = madeImages({ workspaceId: id, userId: user.id, files: chatFiles, project: goal.project });
    const image = imageTool(await loadImageKeys(id), made.media, made.source);
```

Change the `tools:` line to:

```ts
      tools: [...(goal.project ? projectTools(goal.project, { write: null, read: new Map() }) : []), ...webTools(await loadSearchKey(id)), ...(chatFiles.length ? attachmentTools(chatFiles) : []), ...(image ? [image] : [])],
```

In `save`, after the `goalStep.create(...)` line and before `return saved;`, add:

```ts
        await made.link({ goalMessageId: saved.id });
```

- [ ] **Step 7: Wire it into tasks.** In `backend/src/goals/runner.ts`, add the imports:

```ts
import { madeImages } from "../attachments/service.js";
import { imageTool, loadImageKeys } from "../harness/images.js";
```

Replace the `const tools = [...]` line with:

```ts
    // The owner's goal files can be edited too; images made here go to the task card (and images/ in a project).
    const made = madeImages({ workspaceId: goal.workspaceId, userId: goal.createdById, files: await prisma.attachment.findMany({ where: { goalId } }), project: goal.project, task: { id: taskId, goalId } });
    const image = imageTool(await loadImageKeys(goal.workspaceId), made.media, made.source);
    const tools = [...(goal.project ? projectTools(goal.project, { write: saveOrSuggest, read }) : []), ...webTools(await loadSearchKey(goal.workspaceId)), ...(image ? [image] : [])];
```

- [ ] **Step 8: Send `media` with the goal's tasks.** In `backend/src/routes/goals.ts`, change the import to `import { attachmentDTO, copyGoalAttachments } from "../attachments/service.js";`, and in `withTasks` change the tasks include to:

```ts
tasks: { orderBy: { position: "asc" }, include: { agent: { select: { name: true } }, media: { orderBy: { createdAt: "asc" } } } },
```

In `goalDTO`'s task mapping, after `toolUses: t.toolUses,`, add:

```ts
      media: t.media.map(attachmentDTO),
```

- [ ] **Step 9: Wording updates.** In `backend/src/harness/tools.ts`, change the `list_attachments` purpose to:

```ts
      purpose: "Lists the files in this chat: the owner's attachments and images companions made.",
```

In `backend/src/goals/quality.ts`, change the end of `DESIGN_GUIDE` so its last line is followed by a new line inside the same template string:

```ts
Don't: generic purple or blue gradients; emoji as icons; "Lorem ipsum" or made-up data presented as real; the stock "centered hero + three feature cards" layout unless asked; buzzwords like unlock, elevate, seamless, revolutionize; fake testimonials, logos or numbers; sections that add nothing.
Pictures: if you have generate_image, make the key pictures (hero, products, illustrations) with it instead of placeholder or stock-photo links, and use their images/ path in the site.`;
```

- [ ] **Step 10: Run the tests and confirm they pass**

Run: `cd backend && npx tsc --noEmit -p . && npx vitest run test/image-storage.test.ts`
Expected: tsc prints nothing, and all 4 tests in the file pass.

- [ ] **Step 11: Run the neighbouring suites (database, one run)**

Run: `cd backend && npx vitest run test/chat-harness.test.ts test/chat-attachments.test.ts test/conversations.test.ts test/goal-chat.test.ts test/goal-quality.test.ts test/goal-attachments.test.ts test/quality-unit.test.ts`
Expected: all pass. If a test compares `DESIGN_GUIDE` or the `list_attachments` purpose word for word, update its expected text to the new wording, since that wording is required by the spec.

- [ ] **Step 12: Commit**

```bash
git add backend/src/attachments/service.ts backend/src/routes/conversations.ts backend/src/routes/chat.ts backend/src/routes/goal-chat.ts backend/src/goals/runner.ts backend/src/routes/goals.ts backend/src/harness/tools.ts backend/src/goals/quality.ts backend/test/image-storage.test.ts
git commit -m "feat(backend): companions make images in every chat and task — shown under the reply or on the task card, saved to images/ in projects

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — images on replies and task cards, Image generation card, browser test

**Files:**
- Modify: `frontend/src/lib/goals.ts` (`TaskDTO.media`)
- Modify: `frontend/src/components/app/chat/ChatThread.tsx` (attachments on assistant replies)
- Modify: `frontend/src/components/app/goals/TaskCard.tsx` (show `task.media`)
- Modify: `frontend/src/components/app/settings/AIServices.tsx` (new `ImageGenerationCard`)
- Modify: `frontend/e2e/fake-llm.ts` (Cloudflare stand-in and Nova's script)
- Modify: `backend/package.json` (`dev:test` env)
- Test: `frontend/e2e/images.spec.ts` (new)

**Interfaces:**
- Consumes:
  - the routes `GET/PUT/DELETE /api/workspaces/:id/image-keys[/cloudflare|/pollinations]` (Task 4);
  - `task.media: AttachmentDTO[]` and assistant-message `attachments` (Task 5);
  - `AttachmentList` from `frontend/src/components/app/chat/AttachmentList.tsx` (exists).

- [ ] **Step 1: Write the failing browser test.** Create `frontend/e2e/images.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("add a free Cloudflare key, ask Nova for a logo, see it under her reply, open it, and save it to a project", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Pics", company: "Pics Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);
  const made = await page.request.post(`/api/workspaces/${co.id}/projects`, { headers: { origin: "http://localhost:3100" }, data: { name: "Brand" } });
  expect(made.ok()).toBe(true);

  await page.goto(`/w/${co.slug}/providers`);
  const card = page.getByRole("region", { name: "Image generation" });
  await card.getByLabel("Account ID").fill("0123456789abcdef0123456789abcdef");
  await card.getByLabel("API token").fill("fake-cloudflare-token-1234");
  await card.getByRole("button", { name: "Save Cloudflare" }).click();
  await expect(card.getByText("fak…1234")).toBeVisible();

  await page.goto(`/w/${co.slug}`);
  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await chat.getByLabel("Message Nova").fill("Draw a logo for the bakery");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Here's your logo.")).toBeVisible();
  await chat.getByRole("img", { name: "logo.png" }).click();
  const viewer = page.getByRole("dialog", { name: "logo.png" });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();

  await chat.getByRole("button", { name: "Save to project" }).click();
  const save = page.getByRole("dialog", { name: "Save logo.png to a project" });
  await save.getByRole("button", { name: "Save" }).click();
  await expect(save.getByRole("status")).toHaveText("Saved as attachments/logo.png");
});
```

- [ ] **Step 2: Add the fakes.** In `backend/package.json`, change `dev:test` so the backend's image services point at the e2e fake server:

```json
    "dev:test": "USE_TEST_DB=1 ALLOW_LOCAL_ENDPOINTS=true CHATGPT_LOCAL_LOGIN=false PORT=4100 BETTER_AUTH_URL=http://localhost:3100 FRONTEND_URL=http://localhost:3100 TEST_CLOUDFLARE_BASE_URL=http://127.0.0.1:4199/cf TEST_POLLINATIONS_BASE_URL=http://127.0.0.1:4199/pollinations tsx src/server.ts",
```

In `frontend/e2e/fake-llm.ts`, add a constant under `MATH_EDIT`:

```ts
const FAKE_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
```

In `scripted`, add these two lines right before the final `return null;`:

```ts
  if (system.includes("When the owner asks for work to be done") && /draw a logo/i.test(user)) return fence({ tool: "generate_image", args: { prompt: "A warm bakery logo", name: "logo" } });
  if (system.includes("When the owner asks for work to be done") && user.startsWith("TOOL RESULT generate_image")) return "Here's your logo.";
```

In `startFakeLlm`, right before the final `res.writeHead(404).end();`, add:

```ts
    // Cloudflare Workers AI stand-in for image generation: the key check and FLUX.2 klein, any account.
    if (req.method === "GET" && /^\/cf\/accounts\/[^/]+\/ai\/models\/search/.test(req.url ?? "")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, result: [] }));
      return;
    }
    if (req.method === "POST" && /^\/cf\/accounts\/[^/]+\/ai\/run\//.test(req.url ?? "")) {
      for await (const _chunk of req) void _chunk;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, result: { image: FAKE_IMAGE } }));
      return;
    }
```

- [ ] **Step 3: Run the browser test and confirm it fails**

Run: `cd frontend && npx playwright test e2e/images.spec.ts`
Expected: FAIL. The region "Image generation" isn't found. (This run uses the shared test database, so no other database test may be running.)

- [ ] **Step 4: Show attachments on assistant replies.** In `frontend/src/components/app/chat/ChatThread.tsx`, replace

```tsx
              {m.role === "user" && <AttachmentList items={m.attachments ?? []} canSave={canSend} />}
```

with

```tsx
              <AttachmentList items={m.attachments ?? []} canSave={canSend} />
```

- [ ] **Step 5: Show task images.** In `frontend/src/lib/goals.ts`, add `import type { AttachmentDTO } from "./types.ts";` under the existing import, and in `TaskDTO` add after `toolUses?: ToolUseDTO[];`:

```ts
  media?: AttachmentDTO[];
```

In `frontend/src/components/app/goals/TaskCard.tsx`, add `import { AttachmentList } from "../chat/AttachmentList";` and, right after the `{task.error && ...}` line, add:

```tsx
      <AttachmentList items={task.media ?? []} canSave={editable} />
```

- [ ] **Step 6: Add the Image generation card.** In `frontend/src/components/app/settings/AIServices.tsx`, add this component after `WebSearchCard`:

```tsx
type ImageKeys = { cloudflare: { hint: string } | null; pollinations: { hint: string } | null };

function ImageGenerationCard({ admin }: { admin: boolean }) {
  const { wsPath } = useWorkspace();
  const [keys, setKeys] = useState<ImageKeys | undefined>(undefined);
  const [accountId, setAccountId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = wsPath("/image-keys");
  useEffect(() => {
    api<ImageKeys>(path).then(setKeys, () => setKeys({ cloudflare: null, pollinations: null }));
  }, [path]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const remove = (provider: keyof ImageKeys) =>
    run(async () => {
      await api(`${path}/${provider}`, { method: "DELETE" });
      setKeys((k) => k && { ...k, [provider]: null });
    });
  const connected = (provider: keyof ImageKeys, hint: string) => (
    <div className="mt-2 flex items-center gap-3 text-sm">
      <span>Connected · <span className="font-mono">{hint}</span></span>
      {admin && <button disabled={busy} onClick={() => remove(provider)} className="rounded-[8px] px-3 py-1.5 font-semibold text-[#b42318] hover:bg-bg">Remove</button>}
    </div>
  );
  return (
    <section aria-label="Image generation" className="rounded-[14px] border border-line bg-paper p-4">
      <h2 className="font-semibold">Image generation</h2>
      <p className="mt-1 text-sm text-muted">Lets companions create and edit images: logos, social posts, website pictures. Cloudflare is free; Pollinations adds readable text in images.</p>
      {keys && (
        <>
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-sm font-semibold">Cloudflare (free)</h3>
            <p className="mt-0.5 text-sm text-muted">About 95 free images a day; never bills on the free plan.</p>
            {keys.cloudflare ? connected("cloudflare", keys.cloudflare.hint) : admin ? (
              <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api<{ hint: string }>(`${path}/cloudflare`, { method: "PUT", body: { accountId, apiToken } }); setKeys((k) => k && { ...k, cloudflare: r }); setAccountId(""); setApiToken(""); }); }}>
                <p className="text-xs text-muted">In the Cloudflare dashboard, open Workers AI and choose “Use REST API”: copy your Account ID and create an API token.</p>
                <label htmlFor="cf-account" className="block text-sm">Account ID<input id="cf-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="32 letters and digits" className={field} /></label>
                <label htmlFor="cf-token" className="block text-sm">API token<input id="cf-token" type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} className={field} /></label>
                <button disabled={busy || accountId.trim().length !== 32 || apiToken.trim().length < 20} className="btn-dark rounded-[10px] px-4 py-2 text-sm font-semibold">Save Cloudflare</button>
              </form>
            ) : <p className="mt-2 text-sm">Not set up</p>}
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="text-sm font-semibold">Pollinations (optional, paid)</h3>
            <p className="mt-0.5 text-sm text-muted">Readable text in images and more volume. Prepaid, about $0.005–0.05 an image.</p>
            {keys.pollinations ? connected("pollinations", keys.pollinations.hint) : admin ? (
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await api<{ hint: string }>(`${path}/pollinations`, { method: "PUT", body: { apiKey } }); setKeys((k) => k && { ...k, pollinations: r }); setApiKey(""); }); }}>
                <label className="sr-only" htmlFor="pol-key">Pollinations key</label>
                <input id="pol-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk_..." className="min-w-0 flex-1 rounded-[10px] border border-line bg-paper px-3 py-2 text-sm" />
                <button disabled={busy || !apiKey.trim().startsWith("sk_")} className="btn-dark rounded-[10px] px-4 text-sm font-semibold">Save Pollinations</button>
              </form>
            ) : <p className="mt-2 text-sm">Not set up</p>}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-[#b42318]">{error}</p>}
    </section>
  );
}
```

and render it right after `<WebSearchCard admin={admin} />`:

```tsx
      <ImageGenerationCard admin={admin} />
```

- [ ] **Step 7: Check the frontend compiles, lints and passes its unit tests**

Run: `cd frontend && npx tsc --noEmit -p . && npx eslint src/components/app/settings/AIServices.tsx src/components/app/chat/ChatThread.tsx src/components/app/goals/TaskCard.tsx src/lib/goals.ts e2e/fake-llm.ts e2e/images.spec.ts && npm run test:unit`
Expected: no tsc or eslint output, and `# fail 0`.

- [ ] **Step 8: Run the browser test and confirm it passes**

Run: `cd frontend && npx playwright test e2e/images.spec.ts e2e/attachments.spec.ts e2e/harness.spec.ts`
Expected: all pass.

- [ ] **Step 9: Look at it.** With the e2e servers or a screenshot from the test, check the Image generation card at 1440 px and 390 px wide, in light and dark. Check that the image thumbnail under Nova's reply sits above the activity line and doesn't push the copy button off-screen at 390 px.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/goals.ts frontend/src/components/app/chat/ChatThread.tsx frontend/src/components/app/goals/TaskCard.tsx frontend/src/components/app/settings/AIServices.tsx frontend/e2e/fake-llm.ts frontend/e2e/images.spec.ts backend/package.json
git commit -m "feat(frontend): companion images under replies and on task cards; Image generation card for Cloudflare and Pollinations keys

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full verification and hand-off

**Files:** none new. This task fixes whatever the full runs turn up.

- [ ] **Step 1: Full backend suite (database, nothing else running against the test database)**

Run: `cd backend && npx tsc --noEmit -p . && npx vitest run`
Expected: every test file passes. For an ETIMEDOUT or P1017 from Neon, rerun that file alone before treating it as a failure.

- [ ] **Step 2: Full browser suite (after the backend suite finishes)**

Run: `cd frontend && npx playwright test`
Expected: all specs pass.

- [ ] **Step 3: Frontend checks**

Run: `cd frontend && npx tsc --noEmit -p . && npm run lint && npm run test:unit`
Expected: clean, and `# fail 0`.

- [ ] **Step 4: Fresh review.** Ask one fresh reviewer, on the most capable model, to review the whole branch against the spec and this plan's Review Focus. Fix what it confirms, rerun the affected tests, and commit the fixes as `fix: …` commits.

- [ ] **Step 5: Hand-off message to the owner.** Report the results, then the steps for trying it for real:
  1. `cd backend && npm install` (adds sharp)
  2. `npm run db:deploy` (adds the ImageKey table and Attachment.taskId)
  3. Restart the dev servers.
  4. Create a free Cloudflare account, open Workers AI → Use REST API, copy the Account ID and create a token, then paste both into Settings › AI services › Image generation.
  5. Ask Nova "draw a logo for my bakery".

  Also mention that deploying to Render needs the same `npm run db:deploy` on the main database first.
