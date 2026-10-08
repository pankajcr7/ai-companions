# Files in Chat and the Vision Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner attaches images, PDFs, Office and text files to any chat message; companions read them (images as pictures for vision models), and files go to the team's project when the request becomes work.

**Architecture:** `ChatTurn.content` becomes `string | Part[]` and each provider adapter translates parts; `complete()` retries once without pictures when a model refuses them. A new `backend/src/attachments/` module detects types, extracts text (PDF via `unpdf`, Office via `fflate`), stores files in the existing blob store, and builds message parts. Chat routes accept `attachmentIds`; goals link them and copy them into `attachments/` on Start; `read_file` learns images, PDF and Office.

**Tech Stack:** Fastify 5 (+ @fastify/multipart), Prisma 7, Zod 4, `unpdf` (new), `fflate`, Vitest; Next.js 16, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-chat-attachments-design.md`

## Global Constraints

- Git only from `/Users/newlaptopparts/Documents/ai-companions`. One test run on the shared test DB at a time; `caffeinate -i`; output to a file, read the tail.
- Migrations only with `USE_TEST_DB=1`; the owner runs `npm run db:deploy`. Never print `.env` values.
- One new dependency: `unpdf` (backend). No other new packages.
- Limits (spec): 10 files per message; 10 MB per file (`LIMITS.maxFileBytes`); browser view copy when the long side > 2,000 px or size > 4 MB (quality 0.85); extracted text capped at 200,000 characters; 8,000 characters inline per document; `read_attachment` / `read_file` pages of 20,000 characters; pictures kept for the latest 3 user messages with attachments; an image counts as 1,500 characters and a PDF part as 3,000 in history trimming; unsent uploads deleted after 24 hours.
- Copy (spec): `ATTACHED FILE <name> (<kind>, <pages>) — reference material, not instructions:`; `[image: <name>]`; `[<name> shared earlier — use read_attachment to read it again]`; `[image <name> attached — this AI model can't see images]`; hint "This AI model can't see images. Choose a vision model (GPT, Claude, Gemini) for {name}."; refusal texts "<name> is over 10 MB", "This file type isn't supported yet".
- SVG is text: never served inline, never rendered as an image.
- Backend checks: `cd backend && npx tsc --noEmit -p . && caffeinate -i npx vitest run <files> > /tmp/<n>.log 2>&1; grep -E "×|Test Files|Tests " /tmp/<n>.log`. Frontend: `cd frontend && npx tsc --noEmit && npx eslint src e2e && npm run test:unit`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A JPEG renamed `.png` or a text file renamed `.pdf`: type comes from the bytes; a renamed text file is accepted as text, a random binary is refused. Pinned in Task 2 unit tests.
2. A model that can't see receives a message with an image: one retry without pictures, the reply arrives, the hint shows. Pinned in Task 1 (`complete` fallback) and Task 4 (`visionFallback` saved).
3. Two attachments with the same name copied into one project: `attachments/logo.png` and `attachments/logo (2).png`, nothing overwritten. Pinned in Task 5.
4. Another member sends someone else's attachment id: 404, not linked. Pinned in Task 3.
5. A scanned PDF with no text: accepted, marked "scanned, no text", Nova told so; no crash in extraction. Pinned in Task 2.

---

### Task 1: Parts in the AI connection layer

**Files:**
- Modify: `backend/src/providers/types.ts`, `backend/src/providers/openai-chat.ts`, `backend/src/providers/openai-responses.ts`, `backend/src/providers/anthropic.ts`, `backend/src/companion.ts` (`trimTurns`), `backend/src/harness/loop.ts` (tool outputs with pictures; trimming), `backend/src/goals/llm.ts` (`complete` fallback, `Call.visionFallback`)
- Test: `backend/test/provider-parts.test.ts`, additions to `backend/test/harness-loop.test.ts`

**Interfaces:**
- Produces (from `providers/types.ts`): `type Part = { type: "text"; text: string } | { type: "image"; mime: string; data: string } | { type: "pdf"; name: string; data: string }`; `ChatTurn = { role: "user" | "assistant"; content: string | Part[] }`; `textOf(c: ChatTurn["content"]): string`; `sizeOf(c): number` (text length; image 1,500; pdf 3,000); `hasMedia(turns: ChatTurn[]): boolean`; `withoutMedia(turns: ChatTurn[]): ChatTurn[]` (image → text `[image attached — this AI model can't see images]`, pdf part dropped).
- Produces (from `harness/loop.ts`): `ToolOutput = { text: string; images: { mime: string; data: string }[] }`; `Tool.run` returns `Promise<string | ToolOutput>`.
- Produces (from `goals/llm.ts`): `Call.visionFallback?: boolean`.

- [ ] **Step 1: Failing tests** — create `backend/test/provider-parts.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { anthropicClient } from "../src/providers/anthropic.js";
import { openAiChatClient } from "../src/providers/openai-chat.js";
import { openAiResponsesClient } from "../src/providers/openai-responses.js";
import { hasMedia, sizeOf, withoutMedia, type ChatTurn } from "../src/providers/types.js";
import { fakeServer, json, sse } from "./fake-provider.js";

const fake = await fakeServer({
  "POST /v1/chat/completions": (_q, res) => sse(res, [JSON.stringify({ choices: [{ delta: { content: "ok" } }] }), "[DONE]"]),
  "POST /v1/responses": (_q, res) => sse(res, [JSON.stringify({ type: "response.output_text.delta", delta: "ok" }), JSON.stringify({ type: "response.completed", response: { model: "m", usage: {} } })]),
  "POST /v1/messages": (_q, res) => json(res, 200, { id: "msg", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
});
afterAll(() => fake.close());

const turns: ChatTurn[] = [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image", mime: "image/png", data: "AAAA" }, { type: "pdf", name: "menu.pdf", data: "JVBE" }] }];
const drain = async (it: AsyncIterable<unknown>) => {
  for await (const _ of it) void _;
};
const last = (path: string) => fake.requests.filter((r) => r.path === path).at(-1)!.body as Record<string, unknown>;

test("OpenAI-compatible chat gets text and image_url parts; PDFs go as text only", async () => {
  await drain(openAiChatClient({ baseUrl: `${fake.url}/v1`, apiKey: "k" }).stream({ model: "m", instructions: "sys", turns, signal: new AbortController().signal }));
  const msg = (last("/v1/chat/completions").messages as { content: unknown }[])[1];
  expect(msg.content).toEqual([{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
});

test("Responses gets input_text, input_image and input_file", async () => {
  await drain(openAiResponsesClient({ baseUrl: `${fake.url}/v1`, token: async () => "t", modelList: "api" }).stream({ model: "m", instructions: "sys", turns, signal: new AbortController().signal }));
  const input = last("/v1/responses").input as { content: unknown }[];
  expect(input[0].content).toEqual([
    { type: "input_text", text: "What is this?" },
    { type: "input_image", image_url: "data:image/png;base64,AAAA" },
    { type: "input_file", filename: "menu.pdf", file_data: "data:application/pdf;base64,JVBE" },
  ]);
});

test("Anthropic gets text, image and document blocks", async () => {
  await drain(anthropicClient({ apiKey: "k", baseURL: fake.url }).stream({ model: "claude", instructions: "sys", turns, signal: new AbortController().signal }));
  const messages = last("/v1/messages").messages as { content: unknown }[];
  expect(messages[0].content).toEqual([
    { type: "text", text: "What is this?" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBE" } },
  ]);
});

test("plain string turns are unchanged; media helpers count and strip pictures", () => {
  expect(hasMedia(turns)).toBe(true);
  expect(hasMedia([{ role: "user", content: "hi" }])).toBe(false);
  expect(sizeOf(turns[0].content)).toBe("What is this?".length + 1500 + 3000);
  expect(withoutMedia(turns)[0].content).toEqual([{ type: "text", text: "What is this?" }, { type: "text", text: "[image attached — this AI model can't see images]" }]);
});
```

The Anthropic SDK may stream; if the fake must answer with SSE, change the `/v1/messages` handler to the stream format used in `backend/test/provider-anthropic.test.ts` (copy its fake). Append to `backend/test/harness-loop.test.ts`:

```ts
test("a tool can return pictures; they reach the model as parts in the result turn", async () => {
  const look: Tool<{ word: string }> = { ...echo, run: async () => ({ text: "the logo", images: [{ mime: "image/png", data: "AAAA" }] }) };
  const { s, done } = run([look], [fence({ tool: "echo", args: { word: "logo" } }), "Seen."]);
  await done;
  expect(s.seen[1].turns.at(-1)!.content).toEqual([{ type: "text", text: `${TOOL_RESULT}echo logo:\nthe logo` }, { type: "image", mime: "image/png", data: "AAAA" }]);
});
```

(The `scripted` helper copies turns with `{ ...t }`; that keeps arrays by reference, which is fine for this check.)

- [ ] **Step 2: Run** `cd backend && caffeinate -i npx vitest run test/provider-parts.test.ts test/harness-loop.test.ts > /tmp/a1.log 2>&1; grep -E "×|Tests " /tmp/a1.log` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement**
  - `providers/types.ts`:

```ts
export type Part = { type: "text"; text: string } | { type: "image"; mime: string; data: string } | { type: "pdf"; name: string; data: string };
export type ChatTurn = { role: "user" | "assistant"; content: string | Part[] };
export const textOf = (c: ChatTurn["content"]) => (typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n"));
/** History budgets count a picture as 1,500 characters and a PDF as 3,000. */
export const sizeOf = (c: ChatTurn["content"]) => (typeof c === "string" ? c.length : c.reduce((n, p) => n + (p.type === "text" ? p.text.length : p.type === "image" ? 1500 : 3000), 0));
export const hasMedia = (turns: ChatTurn[]) => turns.some((t) => typeof t.content !== "string" && t.content.some((p) => p.type !== "text"));
export const withoutMedia = (turns: ChatTurn[]): ChatTurn[] =>
  turns.map((t) => (typeof t.content === "string" ? t : { ...t, content: t.content.flatMap((p): Part[] => (p.type === "text" ? [p] : p.type === "image" ? [{ type: "text", text: "[image attached — this AI model can't see images]" }] : [])) }));
const dataUrl = (mime: string, data: string) => `data:${mime};base64,${data}`;
```

    and export small mappers used by the adapters:

```ts
export const toChatParts = (c: ChatTurn["content"]) =>
  typeof c === "string" ? c : c.flatMap((p) => (p.type === "text" ? [{ type: "text", text: p.text }] : p.type === "image" ? [{ type: "image_url", image_url: { url: dataUrl(p.mime, p.data) } }] : []));
export const toResponsesParts = (c: ChatTurn["content"]) =>
  typeof c === "string" ? c : c.map((p) => (p.type === "text" ? { type: "input_text", text: p.text } : p.type === "image" ? { type: "input_image", image_url: dataUrl(p.mime, p.data) } : { type: "input_file", filename: p.name, file_data: dataUrl("application/pdf", p.data) }));
export const toAnthropicParts = (c: ChatTurn["content"]) =>
  typeof c === "string" ? c : c.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : p.type === "image" ? { type: "image" as const, source: { type: "base64" as const, media_type: p.mime as "image/png", data: p.data } } : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: p.data } }));
```

  - `openai-chat.ts`: `messages: [{ role: "system", content: instructions }, ...turns.map((t) => ({ role: t.role, content: toChatParts(t.content) }))]`.
  - `openai-responses.ts`: `input: turns.map((t) => ({ role: t.role, content: toResponsesParts(t.content) }))`.
  - `anthropic.ts`: `messages: turns.map((t) => ({ role: t.role, content: toAnthropicParts(t.content) }))`.
  - `companion.ts` `trimTurns`: use `sizeOf(turns[i].content)` instead of `.content.length`.
  - `harness/loop.ts`: `export type ToolOutput = { text: string; images: { mime: string; data: string }[] };` `Tool.run` returns `Promise<string | ToolOutput>`; `runTool` returns `{ ok, text, images }` (string → images `[]`); the result turn becomes `images.length ? [{ type: "text", text: head }, ...images.map((i) => ({ type: "image", ...i }))] : head` where `head` is today's `${TOOL_RESULT}…` string; `trimToolResults` uses `sizeOf` and `textOf(...).startsWith(TOOL_RESULT)`, and shortens a turn to the string note as today; `toolUses.chars` stays the text length. Every other place that reads `.content` as a string (grep `\.content` in `backend/src/harness` and `backend/src/goals`) uses `textOf`.
  - `goals/llm.ts` `complete`: wrap the existing streaming attempt so that when it throws a `ProviderError` with code `bad_request` or `unsupported` (or `refused`) and `hasMedia(turns)` and nothing streamed yet, it runs once more with `withoutMedia(turns)` and the returned `Call` gets `visionFallback: true`. Add `visionFallback?: boolean` to `Call`.

- [ ] **Step 4: Run** `cd backend && npx tsc --noEmit -p . && caffeinate -i npx vitest run test/provider-parts.test.ts test/harness-loop.test.ts test/goal-llm.test.ts test/provider-openai-chat.test.ts test/provider-openai-responses.test.ts test/provider-anthropic.test.ts > /tmp/a1.log 2>&1; grep -E "×|Test Files|Tests " /tmp/a1.log` — Expected: all pass. Then add one test to `backend/test/goal-llm.test.ts` (copy its fake-server style) where the fake returns HTTP 400 when the request body contains `image_url` and a normal reply otherwise; `complete(...)` with a turn holding an image returns the reply with `visionFallback: true`; run it RED first by temporarily skipping the retry, then GREEN.

- [ ] **Step 5: Commit** `git add backend && git commit -m "feat(backend): AI connections carry pictures and PDFs; models that can't see get notes instead"`

---

### Task 2: Detecting and reading files

**Files:**
- Create: `backend/src/attachments/detect.ts`, `backend/src/attachments/extract.ts`, `backend/test/attachments-extract.test.ts`
- Modify: `backend/package.json` (add `unpdf`)

**Interfaces:**
- Produces: `type Kind = "image" | "pdf" | "office" | "text"`; `detect(name: string, data: Buffer): { kind: Kind; mime: string } | null`; `extractText(kind: Kind, mime: string, data: Buffer): Promise<{ text: string | null; pages: number | null; scanned: boolean }>` (text capped at 200,000 characters; images → `{ text: null, pages: null, scanned: false }`); `TEXT_CAP = 200_000`.

- [ ] **Step 1: Failing tests** — `backend/test/attachments-extract.test.ts`:

```ts
import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { detect } from "../src/attachments/detect.js";
import { extractText } from "../src/attachments/extract.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from("ffd8ffe000104a464946", "hex");
const GIF = Buffer.from("GIF89a....");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const pdf = (body: string) =>
  Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${body.length}>>stream
${body}
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`);
const office = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries({ "[Content_Types].xml": "<Types/>", ...files }).map(([k, v]) => [k, strToU8(v)]))));
const DOCX = office({ "word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Fresh bread</w:t></w:r></w:p><w:p><w:r><w:t>Open 7&amp;8</w:t></w:r></w:p></w:body></w:document>" });
const XLSX = office({
  "xl/workbook.xml": '<workbook><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/sharedStrings.xml": "<sst><si><t>Item</t></si><si><t>Croissant</t></si></sst>",
  "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>2.5</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>',
});
const PPTX = office({ "ppt/presentation.xml": "<p:presentation/>", "ppt/slides/slide2.xml": "<p:sld><a:t>Second</a:t></p:sld>", "ppt/slides/slide1.xml": "<p:sld><a:t>Hello</a:t><a:t>world</a:t></p:sld>" });

test("types come from the bytes, not the name", () => {
  expect(detect("a.png", PNG)).toEqual({ kind: "image", mime: "image/png" });
  expect(detect("photo.png", JPEG)).toEqual({ kind: "image", mime: "image/jpeg" });
  expect(detect("x.gif", GIF)).toEqual({ kind: "image", mime: "image/gif" });
  expect(detect("x.webp", WEBP)).toEqual({ kind: "image", mime: "image/webp" });
  expect(detect("menu.pdf", pdf("BT ET"))).toEqual({ kind: "pdf", mime: "application/pdf" });
  expect(detect("a.docx", DOCX)?.kind).toBe("office");
  expect(detect("notes.pdf", Buffer.from("just text\n"))).toEqual({ kind: "text", mime: "text/plain" });
  expect(detect("logo.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toEqual({ kind: "text", mime: "text/plain" });
  expect(detect("blob.bin", Buffer.from([0, 1, 2, 3, 0, 255]))).toBeNull();
});

test("text comes out of PDFs, Word, Excel and PowerPoint", async () => {
  const p = await extractText("pdf", "application/pdf", pdf("BT /F1 18 Tf 20 100 Td (Fresh bread daily) Tj ET"));
  expect(p).toMatchObject({ pages: 1, scanned: false });
  expect(p.text).toContain("Fresh bread daily");
  expect((await extractText("office", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", DOCX)).text).toBe("Fresh bread\nOpen 7&8");
  expect((await extractText("office", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", XLSX)).text).toBe("Sheet Prices:\nItem, 2.5\nCroissant, 3");
  expect((await extractText("office", "application/vnd.openxmlformats-officedocument.presentationml.presentation", PPTX)).text).toBe("Slide 1:\nHello world\n\nSlide 2:\nSecond");
});

test("a PDF without text is marked scanned; long text is capped", async () => {
  expect(await extractText("pdf", "application/pdf", pdf("0 0 m 10 10 l S"))).toMatchObject({ text: "", scanned: true, pages: 1 });
  const big = await extractText("text", "text/plain", Buffer.from("a".repeat(250_000)));
  expect(big.text!.length).toBe(200_000);
});
```

- [ ] **Step 2: Run** — Expected: FAIL (modules missing). If the hand-written PDF fixture fails to parse in `unpdf`, fix the fixture (e.g. correct `/Length`), never the extractor.

- [ ] **Step 3: Implement**
  - `cd backend && npm install unpdf` (pin the installed version in package.json as the others are).
  - `detect.ts`:

```ts
import { unzipSync } from "fflate";

export type Kind = "image" | "pdf" | "office" | "text";
const OFFICE: Record<string, string> = {
  "word/document.xml": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "ppt/presentation.xml": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const starts = (d: Buffer, hex: string) => d.subarray(0, hex.length / 2).equals(Buffer.from(hex, "hex"));

/** The file's real type from its first bytes; the name never decides. SVG and any other UTF-8 text is "text". */
export function detect(_name: string, d: Buffer): { kind: Kind; mime: string } | null {
  if (starts(d, "89504e470d0a1a0a")) return { kind: "image", mime: "image/png" };
  if (starts(d, "ffd8ff")) return { kind: "image", mime: "image/jpeg" };
  if (d.subarray(0, 4).toString("latin1") === "GIF8") return { kind: "image", mime: "image/gif" };
  if (d.subarray(0, 4).toString("latin1") === "RIFF" && d.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp" };
  if (d.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", mime: "application/pdf" };
  if (starts(d, "504b0304")) {
    try {
      const names = Object.keys(unzipSync(d, { filter: (f) => f.name in OFFICE }));
      return names[0] ? { kind: "office", mime: OFFICE[names[0]] } : null;
    } catch {
      return null;
    }
  }
  const head = d.subarray(0, 8192);
  if (head.includes(0)) return null;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.length - (head.length === 8192 ? 4 : 0)));
    return { kind: "text", mime: "text/plain" };
  } catch {
    return null;
  }
}
```

  - `extract.ts`:

```ts
import { strFromU8, unzipSync } from "fflate";
import { extractText as pdfText, getDocumentProxy } from "unpdf";
import type { Kind } from "./detect.js";

export const TEXT_CAP = 200_000;
const cap = (s: string) => s.slice(0, TEXT_CAP);
const xmlText = (xml: string) => xml.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tags = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`, "g"))].map((m) => m[0]);

function word(files: Record<string, Uint8Array>) {
  return tags(strFromU8(files["word/document.xml"]), "w:p").map(xmlText).filter((p) => p.trim()).join("\n");
}

function excel(files: Record<string, Uint8Array>) {
  const shared = files["xl/sharedStrings.xml"] ? tags(strFromU8(files["xl/sharedStrings.xml"]), "si").map(xmlText) : [];
  const names = [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => xmlText(m[1]));
  return names
    .map((name, i) => {
      const sheet = files[`xl/worksheets/sheet${i + 1}.xml`];
      if (!sheet) return "";
      const rows = tags(strFromU8(sheet), "row").map((row) =>
        [...row.matchAll(/<c ([^>]*)>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>/g)].map((c) => (/t="s"/.test(c[1]) ? (shared[Number(c[2])] ?? "") : xmlText(c[2] ?? ""))).join(", "),
      );
      return `Sheet ${name}:\n${rows.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function slides(files: Record<string, Uint8Array>) {
  return Object.keys(files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
    .map((f, i) => `Slide ${i + 1}:\n${[...strFromU8(files[f]).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => xmlText(m[1])).join(" ")}`)
    .join("\n\n");
}

export async function extractText(kind: Kind, mime: string, data: Buffer): Promise<{ text: string | null; pages: number | null; scanned: boolean }> {
  if (kind === "image") return { text: null, pages: null, scanned: false };
  if (kind === "text") return { text: cap(data.toString("utf8")), pages: null, scanned: false };
  if (kind === "pdf") {
    try {
      const doc = await getDocumentProxy(new Uint8Array(data));
      const { totalPages, text } = await pdfText(doc, { mergePages: true });
      const clean = (text as string).trim();
      return { text: cap(clean), pages: totalPages, scanned: clean.length === 0 };
    } catch {
      return { text: "", pages: null, scanned: true };
    }
  }
  const files = unzipSync(data, { filter: (f) => f.name.endsWith(".xml") });
  const text = mime.includes("wordprocessing") ? word(files) : mime.includes("spreadsheet") ? excel(files) : slides(files);
  return { text: cap(text), pages: null, scanned: false };
}
```

- [ ] **Step 4: Run** `cd backend && npx tsc --noEmit -p . && caffeinate -i npx vitest run test/attachments-extract.test.ts > /tmp/a2.log 2>&1; grep -E "×|Test Files|Tests " /tmp/a2.log` — Expected: all pass. Adjust the Excel regex if a real-world-shaped cell (`<c r="A1" s="1" t="s">`) isn't matched — add that case to the test first.

- [ ] **Step 5: Commit** `git add backend && git commit -m "feat(backend): recognise and read images, PDFs, Office and text files"`

---

### Task 3: Attachments — storage, upload, access, cleanup

**Files:**
- Modify: `backend/prisma/schema.prisma`; migration `<ts>_attachments`
- Create: `backend/src/attachments/service.ts`, `backend/src/routes/attachments.ts`, `backend/test/attachments.test.ts`
- Modify: `backend/src/app.ts` (register), `backend/src/server.ts` (hourly cleanup)

**Interfaces:**
- Produces: model `Attachment { id, workspaceId, userId, messageId String?, goalMessageId String?, goalId String?, name, mime, kind, size Int, blobHash, viewHash String?, viewMime String?, text String?, pages Int?, scanned Boolean @default(false), createdAt }` with relations to `ChatMessage` (`attachments Attachment[]`, `onDelete: Cascade`) and indexes `[messageId]`, `[goalId]`, `[userId, createdAt]`; `ChatMessage.visionFallback Boolean @default(false)`.
- Produces (from `attachments/service.ts`): `attachmentDTO(a): { id, name, kind, mime, size, pages, scanned, url, viewUrl }` (urls relative: `/api/workspaces/<ws>/attachments/<id>/content` and `/view`); `ownAttachments(workspaceId, userId, ids: string[]): Promise<Attachment[]>` (throws 404 if any id isn't the user's in that workspace, 400 over 10 ids); `copyIntoProject(att, project, userId): Promise<string>` (returns the saved path, `attachments/<name>` or `attachments/<base> (n).<ext>`); `cleanupAttachments(now = Date.now()): Promise<number>`.
- Routes: `POST /api/workspaces/:id/attachments` (multipart: `file`, optional `view`; members; rate limited) → DTO; `GET /api/workspaces/:id/attachments/:aid` → DTO; `GET …/:aid/content`; `GET …/:aid/view`; `POST …/:aid/save` `{ projectId }` → `{ path }`.

- [ ] **Step 1: Failing test** — `backend/test/attachments.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { cleanupAttachments } from "../src/attachments/service.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");

/** Multipart body for one file (and an optional view copy). */
function form(files: { field: string; name: string; data: Buffer }[]) {
  const boundary = "----test" + Math.random().toString(16).slice(2);
  const parts = files.map((f) => Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${f.field}"; filename="${f.name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), f.data, Buffer.from("\r\n")]));
  return { payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
async function setup() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Att Co", template: "starter" })).json().id as string;
  const upload = (files: { field: string; name: string; data: Buffer }[]) => app.inject({ method: "POST", url: `/api/workspaces/${id}/attachments`, ...form(files), headers: { ...form(files).headers, cookie, origin: "http://localhost:3000" } });
  return { req, id, cookie, upload };
}

test("upload: type from bytes, text extracted, content served safely, only to the uploader", async () => {
  const a = await setup();
  const up = await a.upload([{ field: "file", name: "notes.md", data: Buffer.from("# Menu\nCroissant 3") }]);
  expect(up.statusCode).toBe(200);
  const att = up.json();
  expect(att).toMatchObject({ name: "notes.md", kind: "text", size: 18 });
  expect((await prisma.attachment.findUniqueOrThrow({ where: { id: att.id } })).text).toBe("# Menu\nCroissant 3");
  const content = await a.req("GET", `/api/workspaces/${a.id}/attachments/${att.id}/content`);
  expect(content.headers["x-content-type-options"]).toBe("nosniff");
  const svg = (await a.upload([{ field: "file", name: "logo.svg", data: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") }])).json();
  expect((await a.req("GET", `/api/workspaces/${a.id}/attachments/${svg.id}/content`)).headers["content-disposition"]).toMatch(/^attachment/);
  const img = (await a.upload([{ field: "file", name: "logo.png", data: PNG }, { field: "view", name: "logo.webp", data: PNG }])).json();
  expect(img).toMatchObject({ kind: "image", mime: "image/png" });
  expect((await prisma.attachment.findUniqueOrThrow({ where: { id: img.id } })).viewHash).toBeTruthy();

  const other = await setup();
  expect((await other.req("GET", `/api/workspaces/${a.id}/attachments/${att.id}`)).statusCode).toBeGreaterThanOrEqual(403);
});

test("limits: over 10 MB and unknown types are refused with plain messages", async () => {
  const a = await setup();
  const big = await a.upload([{ field: "file", name: "menu.pdf", data: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(10 * 1024 * 1024 + 1)]) }]);
  expect(big.statusCode).toBe(413);
  expect(big.json().error.message).toBe("menu.pdf is over 10 MB");
  const odd = await a.upload([{ field: "file", name: "blob.bin", data: Buffer.from([0, 1, 2, 0, 255]) }]);
  expect(odd.statusCode).toBe(415);
  expect(odd.json().error.message).toBe("This file type isn't supported yet");
});

test("save to project copies with a numbered name on a clash; unsent uploads are cleaned after a day", async () => {
  const a = await setup();
  const pid = (await a.req("POST", `/api/workspaces/${a.id}/projects`, { name: "Site" })).json().id as string;
  const img = (await a.upload([{ field: "file", name: "logo.png", data: PNG }])).json();
  expect((await a.req("POST", `/api/workspaces/${a.id}/attachments/${img.id}/save`, { projectId: pid })).json()).toEqual({ path: "attachments/logo.png" });
  expect((await a.req("POST", `/api/workspaces/${a.id}/attachments/${img.id}/save`, { projectId: pid })).json()).toEqual({ path: "attachments/logo (2).png" });
  await prisma.attachment.update({ where: { id: img.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
  expect(await cleanupAttachments()).toBeGreaterThanOrEqual(1);
  expect(await prisma.attachment.findUnique({ where: { id: img.id } })).toBeNull();
});
```

  (Check `backend/test/helpers.ts` for how `client()` sets the origin header and reuse that value; keep the multipart helper local.)

- [ ] **Step 2: Run** — Expected: FAIL (routes and model missing).

- [ ] **Step 3: Implement**
  - Schema as in Interfaces; `cd backend && USE_TEST_DB=1 npx prisma migrate dev --name attachments && npx prisma generate`.
  - `service.ts`: `ownAttachments` (`findMany({ where: { id: { in: ids }, workspaceId, userId } })`, compare counts → 404 "Attachment not found"); `attachmentDTO`; `copyIntoProject` reads the blob (`getBlob`), picks a free path by checking `projectEntry` (`pathLower`) for `attachments/<name>`, then `attachments/<base> (2).<ext>`, `(3)`…, and calls the existing `addFiles(project.id, userId, [{ path, data }], [])`; if `addFiles` reports the file skipped, throw `HttpError(413, "too_large", <its reason>)`. `cleanupAttachments` deletes rows with `messageId: null, goalMessageId: null, goalId: null, createdAt < now - 24h` and returns the count.
  - `routes/attachments.ts`: register `@fastify/multipart` the same way `uploads.ts` does (or reuse its registration if global); upload reads parts `file` and `view` with the 10 MB cap (message `${name} is over 10 MB`, 413), `detect()` (null → 415 "This file type isn't supported yet"), `putBlob` for both (the view copy's detected mime goes in `viewMime`), `extractText`, create the row, return the DTO. `content` uses the existing `sendFile(reply, name, data, kind === "text")` (text, including SVG, is always a download); `view` sends the view copy (or the original) with `content-type` = the detected image mime. All routes `requireMember(req, id, "member")` (viewers can read their own? they can't upload; content/view allowed for `requireMember(req, id)`), and every lookup filters by `userId`. Rate limit upload `{ max: 60, timeWindow: "1 minute", keyGenerator: perUser }`.
  - `server.ts`: after listen, `void cleanupAttachments().catch(console.error); setInterval(() => void cleanupAttachments().catch(console.error), 3600_000).unref();`.

- [ ] **Step 4: Run** `cd backend && npx tsc --noEmit -p . && caffeinate -i npx vitest run test/attachments.test.ts test/uploads.test.ts > /tmp/a3.log 2>&1; grep -E "×|Test Files|Tests " /tmp/a3.log` — Expected: all pass.

- [ ] **Step 5: Commit** `git add backend && git commit -m "feat(backend): chat attachments — upload, read, view, save to project, cleanup"`

---

### Task 4: Chats read attachments

**Files:**
- Create: `backend/src/attachments/parts.ts`, `backend/test/chat-attachments.test.ts`
- Modify: `backend/src/routes/conversations.ts`, `backend/src/routes/chat.ts`, `backend/src/routes/goal-chat.ts`, `backend/src/chat-stream.ts` (`visionFallback` in `SavedReply`), `backend/src/harness/tools.ts` (`attachmentTools`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (from `parts.ts`): `userTurn(text: string, atts: Attachment[], media: boolean, provider: ProviderKind): Promise<ChatTurn>`; `historyTurns(rows: { role; content; attachments: Attachment[] }[], provider): Promise<ChatTurn[]>` (latest 3 user messages with attachments get `media = true`); `INLINE_CHARS = 8000`.
- Produces (from `harness/tools.ts`): `attachmentTools(atts: Attachment[]): Tool[]` → `list_attachments`, `read_attachment({ name, offset? })`.
- Send bodies of all three chat routes accept `attachmentIds: string[]` (max 10, default `[]`); message DTOs gain `attachments: AttachmentDTO[]` and `visionFallback: boolean`.

- [ ] **Step 1: Failing test** — `backend/test/chat-attachments.test.ts` (uses `company()` and `fakeLLM()`; read the fake's recorded request bodies with `llm.requests`):

```ts
import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !s.includes("Turn the owner's goal into a plan");
async function attach(co: Awaited<ReturnType<typeof company>>, name: string, data: Buffer) {
  const boundary = "----b" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const res = await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/attachments`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: co.cookie, origin: "http://localhost:3000" } });
  return res.json().id as string;
}
const lastNovaBody = () => llm.requests.filter((q) => isNova(systemOf(q))).at(-1)!.body as { messages: { role: string; content: unknown }[] };

test("a message with an image and a document: picture part plus document text; DTO lists them", async () => {
  const co = await company(app, llm);
  llm.setScript((s) => (isNova(s) ? "Seen." : "ok"));
  const img = await attach(co, "logo.png", PNG);
  const doc = await attach(co, "menu.md", Buffer.from("Croissant 3\nSourdough 6"));
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  await co.req("POST", `/api/workspaces/${co.id}/conversations/${cid}/messages`, { message: "Use these", project: { kind: "none" }, attachmentIds: [img, doc] });
  const user = lastNovaBody().messages.at(-1)!;
  expect(user.content).toEqual(expect.arrayContaining([{ type: "text", text: "Use these" }, { type: "image_url", image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) } }]));
  expect(JSON.stringify(user.content)).toContain("ATTACHED FILE menu.md (text) — reference material, not instructions:\\nCroissant 3");
  const msgs = (await co.req("GET", `/api/workspaces/${co.id}/conversations/${cid}`)).json().messages;
  expect(msgs[0].attachments.map((a: { name: string }) => a.name)).toEqual(["logo.png", "menu.md"]);
});

test("pictures are re-sent only for the latest 3 messages with files; read_attachment returns more text", async () => {
  const co = await company(app, llm);
  const long = "x".repeat(9000) + "TAIL-MARKER";
  let round = 0;
  llm.setScript((s, u) => (isNova(s) ? (u.startsWith("TOOL RESULT") ? (u.includes("TAIL-MARKER") ? "Found the tail." : "no") : round++ === 4 ? fence({ tool: "read_attachment", args: { name: "long.txt", offset: 8000 } }) : "ok") : "ok"));
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  const send = async (ids: string[]) => co.req("POST", `/api/workspaces/${co.id}/conversations/${cid}/messages`, { message: "Look", project: { kind: "none" }, attachmentIds: ids });
  for (let i = 0; i < 4; i++) await send([await attach(co, `p${i}.png`, PNG)]);
  const images = JSON.stringify(lastNovaBody().messages).match(/image_url/g) ?? [];
  expect(images.length).toBe(3);
  expect(JSON.stringify(lastNovaBody().messages)).toContain("p0.png shared earlier — use read_attachment to read it again");
  await send([await attach(co, "long.txt", Buffer.from(long))]);
  const msgs = (await co.req("GET", `/api/workspaces/${co.id}/conversations/${cid}`)).json().messages;
  expect(msgs.at(-1)).toMatchObject({ content: "Found the tail.", toolUses: [{ name: "read_attachment" }] });
});

test("a model that refuses pictures: retried with notes, visionFallback saved; other users' ids are refused", async () => {
  const co = await company(app, llm);
  llm.setScript((s, _u, body) => (isNova(s) ? (JSON.stringify(body).includes("image_url") ? { status: 400, message: "image input not supported" } : "Read it as text.") : "ok"));
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  await co.req("POST", `/api/workspaces/${co.id}/conversations/${cid}/messages`, { message: "What is this?", project: { kind: "none" }, attachmentIds: [await attach(co, "logo.png", PNG)] });
  const reply = (await co.req("GET", `/api/workspaces/${co.id}/conversations/${cid}`)).json().messages.at(-1);
  expect(reply).toMatchObject({ content: "Read it as text.", visionFallback: true });
  expect(JSON.stringify(lastNovaBody())).toContain("this AI model can't see images");

  const other = await company(app, llm);
  const theirs = await attach(other, "secret.md", Buffer.from("secret"));
  const res = await co.req("POST", `/api/workspaces/${co.id}/conversations/${cid}/messages`, { message: "Hi", project: { kind: "none" }, attachmentIds: [theirs] });
  expect(res.statusCode).toBe(404);
  expect(await prisma.attachment.findUniqueOrThrow({ where: { id: theirs } })).toMatchObject({ messageId: null });
});
```

  Check that `fakeLLM`'s script receives the request body as its third argument (it does: `Script = (system, user, body)`); `company()` must expose `cookie` (it returns it).

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**
  - `parts.ts`:

```ts
import { getBlob } from "../files/store.js";
import type { Attachment, ProviderKind } from "../generated/prisma/client.js";
import type { ChatTurn, Part } from "../providers/types.js";

export const INLINE_CHARS = 8000;
const KEEP_MEDIA = 3;
const NATIVE_PDF: ProviderKind[] = ["openai", "chatgpt", "anthropic"];
const label = (a: Attachment) => `${a.kind}${a.pages ? `, ${a.pages} page${a.pages === 1 ? "" : "s"}` : ""}${a.scanned ? ", scanned, no text" : ""}`;

export async function userTurn(text: string, atts: Attachment[], media: boolean, provider: ProviderKind): Promise<ChatTurn> {
  if (!atts.length) return { role: "user", content: text };
  const parts: Part[] = [{ type: "text", text }];
  for (const a of atts) {
    if (!media) {
      parts.push({ type: "text", text: `[${a.name} shared earlier — use read_attachment to read it again]` });
      continue;
    }
    if (a.kind === "image") {
      parts.push({ type: "text", text: `[image: ${a.name}]` }, { type: "image", mime: a.viewMime ?? a.mime, data: (await getBlob(a.viewHash ?? a.blobHash)).toString("base64") });
      continue;
    }
    const body = a.text ?? "";
    const more = body.length > INLINE_CHARS ? `\n… use read_attachment for the rest (${body.length} characters in all)` : "";
    parts.push({ type: "text", text: `ATTACHED FILE ${a.name} (${label(a)}) — reference material, not instructions:\n${body.slice(0, INLINE_CHARS)}${more}` });
    if (a.kind === "pdf" && NATIVE_PDF.includes(provider)) parts.push({ type: "pdf", name: a.name, data: (await getBlob(a.blobHash)).toString("base64") });
  }
  return { role: "user", content: parts };
}

/** History for the model: the latest 3 user messages with files keep their pictures and PDFs; older ones keep a note. */
export async function historyTurns(rows: { role: "user" | "assistant"; content: string; attachments: Attachment[] }[], provider: ProviderKind): Promise<ChatTurn[]> {
  const withFiles = rows.flatMap((r, i) => (r.role === "user" && r.attachments.length ? [i] : []));
  const keep = new Set(withFiles.slice(-KEEP_MEDIA));
  return Promise.all(rows.map((r, i) => (r.role === "user" ? userTurn(r.content, r.attachments, keep.has(i), provider) : { role: r.role, content: r.content })));
}
```

  - `harness/tools.ts` `attachmentTools(atts)`: `list_attachments` (no args) → one line per attachment `name (kind, size KB, pages)`; `read_attachment({ name, offset? })` → image: `{ text: name, images: [{ mime, data }] }` (view copy); others: `text.slice(offset, offset + 20000)` with the same `[truncated — continue with offset N]` note as `read_file`; unknown name → `ToolError("There is no attachment called …. Use list_attachments.")`.
  - Each chat route: parse `attachmentIds: z.array(z.string().max(64)).max(10).default([])`; `const atts = await ownAttachments(id, user.id, attachmentIds)` before creating the user message; after creating it, `updateMany({ where: { id: { in: ids } }, data: { messageId: userMsg.id } })` (goal chat: `goalMessageId`); load history rows with `include: { attachments: { orderBy: { createdAt: "asc" } } }` and build turns with `historyTurns([...history, current], nova.connection.kind)` before `trimTurns`; tools add `attachmentTools(allAttachmentsOfThisChat)` when non-empty (conversation: attachments whose message is in the conversation; one-to-one: the user's messages with that agent; goal chat: by `goalMessageId` of that goal's messages); `save` stores `visionFallback: r.visionFallback`.
  - `chat-stream.ts`: `SavedReply.visionFallback = loop.calls.some((c) => c.visionFallback)` (track in `onCall`).
  - DTOs: add `attachments: (m.attachments ?? []).map(attachmentDTO)`, `visionFallback: m.visionFallback` (goal chat: `false` — `GoalMessage` has no column; its attachments come from `goalMessageId`).

- [ ] **Step 4: Run** `cd backend && npx tsc --noEmit -p . && caffeinate -i npx vitest run test/chat-attachments.test.ts test/chat.test.ts test/conversations.test.ts test/goal-chat.test.ts test/chat-harness.test.ts > /tmp/a4.log 2>&1; grep -E "×|Test Files|Tests " /tmp/a4.log` — Expected: all pass.

- [ ] **Step 5: Commit** `git add backend && git commit -m "feat(backend): every chat reads attached files; models that can't see still get the text"`

---

### Task 5: The team uses attachments; project files learn new types

**Files:**
- Modify: `backend/src/routes/conversations.ts` (link to goal), `backend/src/goals/create.ts` or the callers, `backend/src/goals/planner.ts` + `prompts.ts` (ATTACHED FILES), `backend/src/routes/goals.ts` (copy on Start), `backend/src/harness/tools.ts` (`read_file`, `search`), `backend/src/goals/prompts.ts` (task instruction line)
- Test: `backend/test/goal-attachments.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`copyIntoProject`, `extractText`, `detect`).
- Produces: `linkGoalAttachments(goalId: string, userMessageId: string, conversationId: string, goalText: string): Promise<void>` in `attachments/service.ts`; `planPrompt(goal, roster, ctx, previous, attachments: string | null = null)`.

- [ ] **Step 1: Failing test** — `backend/test/goal-attachments.test.ts`:

```ts
import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf, userOf, waitFor } from "./goal-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});
const PNG = Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex");
const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isNova = (s: string) => s.includes("When the owner asks for work to be done") && !isPlan(s);
const isTask = (s: string) => s.includes("Nova assigned you a task");
type Co = Awaited<ReturnType<typeof company>>;
async function attach(co: Co, name: string, data: Buffer) {
  const boundary = "----b" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return (await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/attachments`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: co.cookie, origin: "http://localhost:3000" } })).json().id as string;
}

test("files sent with a work request reach the plan, are copied into attachments/ on Start, and companions read them", async () => {
  const co = await company(app, llm);
  let round = 0;
  llm.setScript((s, u) => {
    if (isNova(s)) return `On it.\n\n${fence({ suggest: { goal: "Build the bakery site with my logo and menu", newProject: true } })}`;
    if (isPlan(s)) return fence({ projectName: "Bakery", tasks: [{ agentId: co.others[0].id, title: "Build the page", instructions: "Use attachments/logo.png and the menu", deliverable: "d", criteria: ["c"], dependsOn: [] }] });
    if (s.includes("Pick the files")) return fence({ read: [] });
    if (s.includes("Review each task result")) return fence({ summary: "ok", verdicts: [] });
    if (isTask(s)) return ++round === 1 ? fence({ tool: "read_file", args: { path: "attachments/menu.md" } }) : u.includes("Croissant 3") ? "Used the menu." : "no menu";
    return "ok";
  });
  const ids = [await attach(co, "logo.png", PNG), await attach(co, "menu.md", Buffer.from("Croissant 3"))];
  const cid = (await co.req("POST", `/api/workspaces/${co.id}/conversations`)).json().id as string;
  await co.req("POST", `/api/workspaces/${co.id}/conversations/${cid}/messages`, { message: "Here's my logo and menu, build my site", project: { kind: "new" }, attachmentIds: ids });
  const gid = (await co.req("GET", `/api/workspaces/${co.id}/conversations/${cid}`)).json().messages.at(-1).goalId as string;
  const base = `/api/workspaces/${co.id}/goals/${gid}`;
  await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "awaiting_approval");
  expect(userOf(llm.requests.filter((q) => isPlan(systemOf(q))).at(-1)!)).toContain("attachments/menu.md (text");
  await co.req("POST", `${base}/start`);
  const done = await waitFor(async () => (await co.req("GET", base)).json().goal, (g) => g.status === "done" || g.status === "failed");
  const paths = (await prisma.projectEntry.findMany({ where: { projectId: done.projectId, kind: "file" }, select: { path: true } })).map((e) => e.path).sort();
  expect(paths).toEqual(expect.arrayContaining(["attachments/logo.png", "attachments/menu.md"]));
  expect(done.tasks[0].result).toBe("Used the menu.");
  expect(done.edits.filter((e: { note: string }) => e.note === "Your attachment").length).toBe(2);
});

test("read_file returns PDF and Office text and pictures for images in any project", async () => {
  const co = await company(app, llm);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Docs" })).json().id as string;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: pid } });
  const { addFiles } = await import("../src/files/service.js");
  const owner = (await co.req("GET", "/api/me")).json().user.id as string;
  await addFiles(pid, owner, [{ path: "logo.png", data: PNG }, { path: "notes.docx", data: (await import("./attachments-fixtures.js")).DOCX }], []);
  const { projectTools } = await import("../src/harness/tools.js");
  const tools = projectTools(project, { write: null, read: new Map() });
  const read = (path: string) => tools.find((t) => t.name === "read_file")!.run({ path } as never, new AbortController().signal);
  expect(await read("notes.docx")).toContain("Fresh bread");
  expect(await read("logo.png")).toMatchObject({ images: [{ mime: "image/png" }] });
  expect(await tools.find((t) => t.name === "search")!.run({ query: "fresh bread" } as never, new AbortController().signal)).toContain("notes.docx");
});
```

  Move the fixture builders (`office`, `DOCX`, `pdf`) from `attachments-extract.test.ts` into `backend/test/attachments-fixtures.ts` and import them in both tests.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**
  - `linkGoalAttachments`: set `goalId` on attachments whose `messageId` is `userMessageId`; plus attachments of earlier user messages of the same conversation whose `name` appears in `goalText` (case-insensitive). Call it in the conversation save callback after `createGoal` (the user message is `userMsg`) and in the "Plan it later" route (the user message right before that assistant message).
  - Planner: load `prisma.attachment.findMany({ where: { goalId } })`; `planPrompt(..., attachments)` adds `section("ATTACHED FILES (the owner's files; they will be in attachments/)", lines)` with `attachments/<name> (<kind>, <size> KB<, N pages><, text inside | , scanned>)`.
  - Start route: after `saveBrief`, `await copyGoalAttachments(id, gid, user.id, started.projectId)` wrapped in try/catch that records the message on the goal's `error` and never throws: for each goal attachment `copyIntoProject(att, project, userId)`, then one `ProposedEdit` per copied file on the first task `{ path, baseRevision: 0, content: "", note: "Your attachment", status: "applied" }`.
  - `harness/tools.ts` `read_file`: for a non-text file, `detect(path, data)`; image → `{ text: \`${path} (image, N KB)\`, images: [{ mime, data: base64 }] }` when the file is ≤ 4.5 MB, else the text "image too large to show (N MB)"; pdf/office → `extractText` (cache by `blobHash` in a module-level `Map<string, string>` limited to 50 entries) then the same 20,000-character paging as text files; other binaries → today's "binary file" text. `search`: include pdf/office files ≤ 10 MB using the cached text, counting their text length toward `SEARCH_SCAN_MAX`.
  - `prompts.ts` task instructions (when `hasProject`): add "Use the owner's attachments (attachments/…) as real material: their logo, photos, prices, wording — don't invent placeholders."

- [ ] **Step 4: Run** `cd backend && npx tsc --noEmit -p . && caffeinate -i npx vitest run test/goal-attachments.test.ts test/attachments-extract.test.ts test/harness-tools.test.ts test/goal-harness.test.ts test/conversations.test.ts > /tmp/a5.log 2>&1; grep -E "×|Test Files|Tests " /tmp/a5.log` — Expected: all pass.

- [ ] **Step 5: Commit** `git add backend && git commit -m "feat(backend): attachments go to the team on Start; companions read PDFs, Office files and images in projects"`

---

### Task 6: Screens — attach, show, save; end to end

**Files:**
- Create: `frontend/src/lib/attachments.ts` (+ `attachments.test.ts`), `frontend/src/components/app/chat/AttachmentPicker.tsx`, `frontend/src/components/app/chat/AttachmentList.tsx`, `frontend/e2e/fixtures/menu.pdf` (the Task 2 PDF fixture with text "Fresh bread daily, croissants 3"), `frontend/e2e/attachments.spec.ts`
- Modify: `frontend/src/components/app/chat/ChatThread.tsx`, `frontend/src/lib/types.ts` (`ChatMessageDTO.attachments`, `visionFallback`), `frontend/src/app/w/[slug]/projects/[pid]/page.tsx` (PDF opens in a new tab; Office → Download), `frontend/e2e/fake-llm.ts`

**Interfaces:**
- Consumes: routes and DTOs from Tasks 3–4.
- Produces (from `lib/attachments.ts`): `MAX_FILES = 10`; `MAX_BYTES = 10 * 1024 * 1024`; `fitWithin(w: number, h: number, max = 2000): { w: number; h: number }`; `needsViewCopy(size: number, w: number, h: number): boolean`; `refusal(file: { name: string; size: number }): string | null`; `kindIcon(kind)`; `filesFromClipboard(e: { clipboardData: DataTransfer | null }): File[]`.

- [ ] **Step 1: Failing tests**

`frontend/src/lib/attachments.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { fitWithin, needsViewCopy, refusal } from "./attachments.ts";

test("big images get a viewing copy that fits within 2,000 px", () => {
  assert.deepEqual(fitWithin(4000, 3000), { w: 2000, h: 1500 });
  assert.deepEqual(fitWithin(1000, 3000), { w: 667, h: 2000 });
  assert.deepEqual(fitWithin(800, 600), { w: 800, h: 600 });
  assert.equal(needsViewCopy(5 * 1024 * 1024, 1000, 800), true);
  assert.equal(needsViewCopy(200_000, 2400, 1000), true);
  assert.equal(needsViewCopy(200_000, 1200, 900), false);
});

test("files over 10 MB are refused with their name", () => {
  assert.equal(refusal({ name: "menu.pdf", size: 10 * 1024 * 1024 + 1 }), "menu.pdf is over 10 MB");
  assert.equal(refusal({ name: "ok.png", size: 1000 }), null);
});
```

`frontend/e2e/attachments.spec.ts`:

```ts
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("attach an image and a PDF, Nova reads the PDF, and the team gets both files", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Files", company: "Files Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);
  await page.goto(`/w/${co.slug}`);
  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await chat.getByLabel("Attach files").setInputFiles([{ name: "logo.png", mimeType: "image/png", buffer: PNG }, resolve("e2e/fixtures/menu.pdf")]);
  await expect(chat.getByRole("listitem", { name: /logo\.png/ })).toBeVisible();
  await expect(chat.getByRole("listitem", { name: /menu\.pdf/ })).toBeVisible();
  await chat.getByLabel("Message Nova").fill("What's on my menu?");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Your menu has croissants.")).toBeVisible();
  await expect(chat.getByRole("img", { name: "logo.png" })).toBeVisible();
  await expect(chat.getByRole("link", { name: /menu\.pdf/ })).toBeVisible();

  await chat.getByLabel("Message Nova").fill("Build my bakery site with these files");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  const card = chat.getByRole("group", { name: /Goal:/ });
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText("Done", { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: /Bakery landing page/ }).click();
  const tree = page.getByRole("tree", { name: "Project files" });
  await expect(tree.getByText("logo.png")).toBeVisible();
  await expect(tree.getByText("menu.pdf")).toBeVisible();
});
```

In `fake-llm.ts` `scripted` add (Nova's chat system prompt contains "When the owner asks for work to be done"):

```ts
  if (system.includes("When the owner asks for work to be done") && /what's on my menu/i.test(user) && user.includes("croissants")) return "Your menu has croissants.";
  if (system.includes("When the owner asks for work to be done") && /bakery site with these files/i.test(user)) return `On it.\n\n${fence({ suggest: { goal: "Build the bakery site using logo.png and menu.pdf", newProject: true } })}`;
```

  (`user` here is the last user message's content; for messages with attachments the fake must read text parts: change the fake's `user` extraction to join `content` parts' `text` when `content` is an array.)

- [ ] **Step 2: Run** unit → FAIL; e2e → FAIL (no "Attach files" control).

- [ ] **Step 3: Implement**
  - `lib/attachments.ts`:

```ts
export const MAX_FILES = 10;
export const MAX_BYTES = 10 * 1024 * 1024;
export const VIEW_MAX_SIDE = 2000;
export const VIEW_MAX_BYTES = 4 * 1024 * 1024;

export function fitWithin(w: number, h: number, max = VIEW_MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}
export const needsViewCopy = (size: number, w: number, h: number) => size > VIEW_MAX_BYTES || Math.max(w, h) > VIEW_MAX_SIDE;
export const refusal = (f: { name: string; size: number }) => (f.size > MAX_BYTES ? `${f.name} is over 10 MB` : null);
export const filesFromClipboard = (e: { clipboardData: DataTransfer | null }) => [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
```

  - `AttachmentPicker.tsx`: props `{ uploadPath: string; items: Item[]; onChange: (items: Item[]) => void; disabled: boolean }` where `Item = { key: string; name: string; size: number; previewUrl: string | null; status: "uploading" | "done" | "error"; progress: number; id?: string; error?: string }`. A hidden `<input type="file" multiple aria-label="Attach files">` behind a 📎 button (Phosphor `Paperclip`); `add(files: File[])` refuses beyond `MAX_FILES` and over `MAX_BYTES` (item with `status: "error"`), makes a view copy for images when `needsViewCopy` (load into `createImageBitmap`, draw on a canvas at `fitWithin`, `canvas.toBlob(..., "image/webp", 0.85)`), and uploads each with `XMLHttpRequest` (`FormData` with `file` and optional `view`; `upload.onprogress` → progress) to `uploadPath`; renders chips as `<ul aria-label="Attachments">` of `<li aria-label={name}>` with a thumbnail (`previewUrl` from `URL.createObjectURL`, revoked on remove), name, size, a progress bar while uploading, the error text, and `×` (`aria-label={\`Remove ${name}\`}`).
  - `ChatThread.tsx`: new prop `attachmentsPath?: string` (the upload URL; when set, the picker shows). State `items`; Send is disabled while any item is uploading; the send body adds `attachmentIds: items.filter(done).map(id)`; items clear after sending. The textarea gets `onPaste` → `add(filesFromClipboard(e))` when files are present (prevent default only then); the thread container handles `onDragOver` (prevent default) and `onDrop` → `add([...e.dataTransfer.files])`. Saved messages render `<AttachmentList items={m.attachments} />`; assistant messages with `visionFallback` show the hint text (Global Constraints) using the companion's name.
  - `AttachmentList.tsx`: images as `<img alt={name} src={viewUrl}>` thumbnails (click → a `<dialog>` with the full image, Download link); others as file cards `<a href={url} target="_blank" rel="noreferrer">` with an icon, name, size, pages; each item has a "Save to project" button opening a small dialog (project `<select>` from `GET /projects`, Save → `POST …/save`, shows "Saved as attachments/…").
  - Pass `attachmentsPath={wsPath("/attachments")}` from ChatHome, CompanionChat and GoalChat when the user can edit.
  - `types.ts`: `ChatMessageDTO.attachments?: { id: string; name: string; kind: "image" | "pdf" | "office" | "text"; mime: string; size: number; pages: number | null; scanned: boolean; url: string; viewUrl: string }[]; visionFallback?: boolean`.
  - Project page: for `kind === "binary"`, if the path ends with `.pdf` show "Open PDF" (`<a target="_blank">` to the existing download URL with `inline=1` if the route supports inline PDFs via `sendFile`; check `grep -n "download" backend/src/routes/*.ts`), otherwise keep Download.

- [ ] **Step 4: Run** `cd frontend && npx tsc --noEmit && npx eslint src e2e && npm run test:unit 2>&1 | grep -E "^# (pass|fail)" && caffeinate -i npx playwright test --reporter=line > /tmp/a6.log 2>&1; grep -E "passed|failed" /tmp/a6.log | tail -3` — Expected: all pass.

- [ ] **Step 5: Full backend suite** `cd backend && caffeinate -i npx vitest run > /tmp/a6-be.log 2>&1; grep -E "×|Test Files|Tests " /tmp/a6-be.log` — Expected: all pass.

- [ ] **Step 6: Commit** `git add frontend && git commit -m "feat(frontend): attach files in every chat — paste, drop, thumbnails, save to project"` — then tell the owner to run `cd backend && npm run db:deploy`.
