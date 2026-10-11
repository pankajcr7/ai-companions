# Image Generation: Free First with Cloudflare, Pollinations for Text and Volume

Date: 2026-10-11
Status: Draft for owner review
Builds on: companion harness (tools in a loop), files in chat and the vision foundation (part 1)
Part 3 of 3, built before part 2 (web visuals) at the owner's request. Part 2 reuses the "companion-made images" storage defined here (section 2.4) for its screenshots.

## 1. Goal

Companions create and edit images: logos, social posts, website pictures, product shots. Images are free by default (Cloudflare Workers AI, about 95 a day), and a Pollinations key adds paid images with readable text (gpt-image-2) and more volume. The owner sees every image under the companion's reply or on the task card; in a goal's project, images land in `images/` so website tasks can use them directly.

Research (2026-10-11): the owner's ChatGPT sign-in can't generate images (OpenAI lists image generation as unsupported for Sign in with ChatGPT); Gemini's free API tier for images is gone; NVIDIA's free credits are for testing only; Pollinations now needs a key and prepaid credit. Cloudflare's Workers AI gives 10,000 free Neurons a day, and on the free plan requests stop rather than bill when they run out. FLUX.2 [klein] 4B costs about 104 Neurons per 1024×1024 image and can edit up to 4 reference images.

Owner decisions: Cloudflare + Pollinations; create and edit; medium quality by default with at most 4 images per reply or task; images shown to the owner and saved in projects the same way as screenshots.

Out of scope: transparent backgrounds, several images in one call, style presets, video, OpenAI or Gemini keys used directly, a monthly spending limit.

## 2. Success criteria

### 2.1 The tool

1. `generate_image` takes:
   - `prompt` (1–4,000 characters);
   - `size`: `square` (1024×1024, default), `landscape` (1536×1024) or `portrait` (1024×1536);
   - `quality`: `standard` (default) or `high`;
   - `name` (optional, 1–60 letters, digits, `-` or `_`): the file name without extension;
   - `from` (optional, at most 4): names of images to edit or combine.
2. Its purpose line tells the companion to use `high` only for images that must show readable words (logos, posters, social posts with text) or when the owner asks for high quality, and that it costs about 5 cents.
3. The finished image comes back as a picture for the AI, through the part 1 tool-result image path, so the companion can check it. The text says where it went and which service made it: "Saved as images/hero.png (Cloudflare, free)." in a task with a project, or "Shown to the owner under your reply as logo.png (Cloudflare, free)." in a chat, so the companion knows the name to edit later.
4. The tool appears only when at least one image key is set, and only where images can be stored: Nova's chat, one-to-one companion chat, goal follow-up chat and goal tasks. Nova's planning step gets no image tool.
5. The tool runs for up to 2 minutes (a new optional `timeoutMs` on tools; other tools keep 20 s). Cancelling the task or chat aborts the request. Chat streams send a keep-alive comment every 15 s so proxies don't close a stream that's quiet while an image is made.

### 2.2 Choosing the service

6. Routing:

   | Quality | First choice | Then (if not set, used up, rejected, or failing) |
   |---|---|---|
   | standard | Cloudflare `@cf/black-forest-labs/flux-2-klein-4b` | Pollinations `black-forest-labs/flux.2-klein-4b` |
   | high | Pollinations `openai/gpt-image-2`, quality `medium` | Cloudflare, with "text in this image may be less accurate" in the tool text |

7. A refused description (a 4xx other than a rejected key, rate limit or used-up allowance) doesn't fall back: "The image service refused this description. Try different wording."
8. Cloudflare's daily allowance being used up (HTTP 429, or an error mentioning the daily free allocation) with no Pollinations key returns: "Today's free images are used up; they come back at 00:00 UTC."
9. A rejected key returns "The Cloudflare (or Pollinations) key was rejected. Update it in Settings › AI services." when there is nothing to fall back to.

### 2.3 Edits

10. Each `from` name is looked up, case-insensitively, among the chat's files (the owner's attachments and earlier companion images), then among the project's image files when the caller has a project. A missing name returns "There's no image called X. Use list_attachments or list_files to see them."; a file that isn't PNG, JPEG, WebP or GIF returns "X isn't an image."
11. Before an edit, each input is shrunk with `sharp` (new backend dependency) to PNG: within 511×511 for Cloudflare (it requires inputs under 512×512) and within 1536×1536 for Pollinations. The prompt can refer to inputs as image 1–4, in `from` order.
12. Cloudflare edits send `input_image_0`…`input_image_3` in the multipart form. Pollinations edits post multipart `image` fields to `/v1/images/edits`.

### 2.4 Where images go (shared with screenshots)

13. Each image is stored as an `Attachment` row in the existing blob store:
    - kind `image`, with the mime taken from the image's own bytes;
    - name `<name>.<ext>`, or without `name` the prompt's first five words, lower-cased and joined by `-` (`bakery-logo-with-warm-colours.png`);
    - `userId` is the person whose chat or goal it is.
    Thumbnails, click-to-enlarge, access rules and **Save to project** come from part 1. Like uploads, an image is visible to that person only; the rest of the team sees task images through the project copy.
14. **Chats**: rows are created while the reply runs and linked when the reply is saved (`messageId` for Nova and companion chat, `goalMessageId` for goal chat). They show under the companion's reply; the attachment list now renders for assistant messages too. Chats never add images to a project on their own.
15. **Tasks**: rows carry a new `Attachment.taskId`. The goal page's task data gains `media` (these rows), shown on the task card. When the goal has a project, each image is also copied to `images/<file>` without overwriting (`hero (2).png`, as attachments do) and recorded as an applied change with the note "Image". The tool text gives the saved path so a website task can reference it.
16. Rows left unlinked (a reply that failed to save) are removed by the existing 24-hour cleanup, which now also checks `taskId`. Linked rows stay as long as their message or task.
17. Storage goes through one small interface the tools receive, `media: { save(data, fileName): Promise<string> }`. It returns the "Saved as …" or "Shown to the owner" text, and screenshots will reuse it.

### 2.5 Cost and limits

18. At most 4 images per chat reply or per task. Nova's revision rounds count toward the same task, because the same tool instance serves them. The 5th call returns "That's 4 images for this reply, the limit. Finish with what you have."
19. The activity line shows the cost of each image: `generate_image: “bakery logo with name” · ~$0.05`. Notes are `free` (Cloudflare), `~$0.005` (Pollinations klein) and `~$0.05` (gpt-image-2). A tool result can add a short `note` that the loop appends to the saved label. `ponytail:` a fixed price table, updated when prices move.

### 2.6 Keys in Settings

20. Model `ImageKey { id, workspaceId, provider ("cloudflare" | "pollinations"), secret (encrypted), hint, createdById, createdAt }`, unique per workspace and provider. Cloudflare's secret is the encrypted JSON `{accountId, apiToken}`.
21. Routes, admin-only to change, audited as `image_key.set` / `image_key.delete`:
    - `GET /api/workspaces/:id/image-keys` returns `{ cloudflare: {hint} | null, pollinations: {hint} | null }`;
    - `PUT /api/workspaces/:id/image-keys/cloudflare` with `{accountId, apiToken}`;
    - `PUT /api/workspaces/:id/image-keys/pollinations` with `{apiKey}`;
    - `DELETE /api/workspaces/:id/image-keys/:provider`.
22. Saving tests the key with a call that makes no image: Cloudflare `GET /accounts/{accountId}/ai/models/search?per_page=1`, Pollinations `GET /account/key`. A rejected key is refused with a plain message.
23. Settings › AI services gains an "Image generation" card under Web search:
    - **Cloudflare (free)**: Account ID and API token fields, steps for getting them (Cloudflare dashboard → Workers AI → Use REST API), "About 95 free images a day; never bills on the free plan."
    - **Pollinations (optional, paid)**: an `sk_` key field, "Readable text in images and more volume. Prepaid, about $0.005–0.05 an image."
    Each row shows its hint and a Remove button.

### 2.7 Design work

24. The design guide gains: "If you have generate_image, make the key pictures (hero, products, illustrations) with it instead of placeholder or stock-photo links, and use their images/ path in the site."

## 3. Architecture

```
harness/images.ts    imageTool(keys, media, files): routing, fallbacks, cap, cost note
                     cloudflareImage(), pollinationsImage(): one request each, error mapping
                     shrink(data, max) with sharp
harness/loop.ts      Tool.timeoutMs?; ToolOutput.note? appended to the saved label
attachments/service.ts  saveMadeImage(...) → Attachment row (+ project copy for tasks); cleanup checks taskId
routes/image-keys.ts get / set (with free key check) / delete
routes/{conversations,chat,goal-chat}.ts  pass keys + media; link rows when the reply is saved
goals/runner.ts      passes keys + media with taskId (+ project copy); routes/goals.ts adds task.media
frontend: AIServices "Image generation" card; ChatThread attachments on assistant replies; TaskCard task.media
```

- Base URLs can be overridden in tests (`TEST_CLOUDFLARE_BASE_URL`, `TEST_POLLINATIONS_BASE_URL`), following the existing `testOverride`.
- Data model: `ImageKey` (new), `Attachment.taskId String?` with a relation to `GoalTask` (`onDelete: Cascade`) and an index. One migration, applied to the test database; the owner runs `npm run db:deploy` on the main database before deploying.
- New dependency: `sharp` (backend), only for shrinking edit inputs.

## 4. Testing

- Fake Cloudflare and Pollinations servers (the existing `fake-provider` helpers) record requests and return a small PNG, a used-up error, a rejected key or a refusal on demand. No real image is made in tests.
- Unit tests (no database):
  - routing for every row of the table;
  - each fallback, and the tool text naming the service;
  - the used-up and rejected-key messages;
  - a refusal doesn't fall back;
  - the 4-image cap;
  - the cost note on the saved label;
  - edit inputs shrunk to within 511 px for Cloudflare and 1536 px for Pollinations, with the right multipart field names;
  - a missing or non-image `from` name;
  - cancelling aborts the request;
  - the 2-minute tool limit applies to this tool only.
- Database tests:
  - an image in Nova's chat is linked to the reply, listed in its attachments and saveable to a project;
  - goal chat links through `goalMessageId`;
  - a task image appears in `task.media`, lands in `images/` without overwriting, is recorded with the note "Image", and counts against the cap across a revision round;
  - planning has no image tool;
  - the tool is hidden with no keys;
  - cleanup removes unlinked rows and keeps task-linked ones;
  - image-key routes test the key on save, store it encrypted, show only the hint, refuse non-admins and are audited.
- E2E: an admin adds a (fake) Cloudflare key in Settings; Nova makes an image in chat; the thumbnail shows under her reply, opens large and saves to a project.
- Manual check before pushing: the owner's real Cloudflare key makes one image through a companion chat.
