# Website Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Companions get `look_at_website` (Jina Reader screenshot + page text) and `study_website` (frameworks, API calls, links and outside services from the page's HTML and scripts), so "make it like this site" works on Render's free plan.

**Architecture:** One new backend file, `backend/src/harness/site.ts`, holds both tools' logic and reuses `safeFetch`, `untrusted` and a page fetcher split out of `openUrl`. `webTools()` in `harness/tools.ts` adds the two tools next to `open_url`. The frontend activity line learns their labels.

**Tech Stack:** Node 22, TypeScript, Fastify backend, Vitest (backend tests with fake HTTP servers), `node --test` (frontend unit tests).

**Spec:** `docs/superpowers/specs/2026-10-13-website-study-design.md`

**Base:** branch `website-study` from `milestone-1`, after the free Exa search commit (it changes `harness/tools.ts` and `harness/web.ts`, which this plan builds on).

## Global Constraints

- Runs on Render's free plan (512 MB, 0.1 CPU): no browser on the server, no new npm dependencies, no database changes.
- Every request goes through `safeFetch` (private addresses refused, no redirects). The page URL is checked with `checkBaseUrl` before anything is sent.
- Jina base URL: `process.env.JINA_URL ?? "https://r.jina.ai"`; optional `process.env.JINA_API_KEY` sent as `Authorization: Bearer <key>`.
- Each `look_at_website` part has a 17 s deadline (the loop stops any tool at 20 s).
- Caps: lists 40 entries, sections 60 lines, Markdown 12,000 characters, scripts 5 × 1 MB, picture `MAX_IMAGE_BYTES` (3,750,000 bytes).
- Site content goes inside `untrusted(...)`; our own lines (clues line, rebuild line) come after it.
- Messages, verbatim:
  - "That address isn't allowed: only public web pages can be opened."
  - "The free page reader is busy. Try again in a minute."
  - "The page answered with an error (<status>)."
  - "That page took too long to load."
  - "Couldn't open that page through the page reader."
  - "Couldn't read the page text."
  - "No screenshot this time."
  - "Only web pages can be studied."
  - "These are clues from the page's HTML and scripts, not a full analysis."
  - "Rebuild the idea and layout in your own code. Don't copy this site's code, images, logos or wording." (`study_website`: "the idea and how it works")

## Review Focus

1. Jina answers 200 but without `content` (text part) or without `screenshotUrl` (screenshot part): treated as that part failing, never a crash. Pinned in Task 2 ("empty" page).
2. A screenshot that is too big or isn't an image: dropped with "No screenshot this time.", the text still arrives. Pinned in Task 2 ("bigshot" and "txtshot").
3. Protocol-relative and relative URLs (`//js.stripe.com/v3/`, `/s/b.js`), uppercase and single-quoted attributes (`SRC='...'`): resolved against the page URL and read. Pinned in Task 1.
4. `mailto:`, `javascript:` and other-host links: never listed as pages; image and other files skipped. Pinned in Task 1.
5. A page with more than 40 links: the list stops at 40. Pinned in Task 1 ("many").

---

### Task 1: `study_website` logic

**Files:**
- Modify: `backend/src/harness/web.ts` (split `fetchPage` out of `openUrl`; export `readBytes` and `readCapped`)
- Create: `backend/src/harness/site.ts`
- Test: `backend/test/site.test.ts`

**Interfaces:**
- Produces:
  - `web.ts`: `export async function readBytes(res: FetchResponse, max: number): Promise<{ data: Buffer; cut: boolean }>`; `export async function readCapped(res: FetchResponse): Promise<string>` (unchanged behaviour, now exported); `export async function fetchPage(url: string, signal: AbortSignal): Promise<{ body: string; type: string }>`
  - `site.ts`: `export async function studyWebsite(url: string, signal: AbortSignal): Promise<string>`; module constants `MAX_LIST = 40`, helper `list(items: Iterable<string>): string`, helper `rebuild(what: string): string` (reused by Task 2)

- [ ] **Step 1: Write the failing test**

Create `backend/test/site.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { studyWebsite } from "../src/harness/site.js";
import { fakeServer } from "./fake-provider.js";

const html = (body: string) => (_q: unknown, res: import("node:http").ServerResponse) => void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
const js = (body: string, status = 200) => (_q: unknown, res: import("node:http").ServerResponse) => void res.writeHead(status, { "content-type": "application/javascript" }).end(body);

const SHOP = `<html><head><title>Shop &amp; Co</title>
<meta content="WordPress 6.5" name="generator">
<link rel="stylesheet" href="https://cdn.example.net/bootstrap.min.css">
<script src="/_next/static/a.js"></script>
<script SRC='/s/b.js'></script>
<script src="//js.stripe.com/v3/"></script>
<script src="/s/c.js"></script><script src="/s/d.js"></script><script src="/s/e.js"></script><script src="/s/f.js"></script>
</head><body>
<script>fetch("/api/cart").then((r) => r.json())</script>
<a href="/pricing">Pricing</a><a href="/about?x=1#team">About</a><a href="/logo.png">Logo</a>
<a href="mailto:a@b.c">Mail</a><a href="javascript:void(0)">JS</a><a href="https://elsewhere.example/x">Out</a>
<img src="https://images.example.org/hero.webp">
<p>We bootstrap small teams.</p>
</body></html>`;

const site = await fakeServer({
  "GET /shop": html(SHOP),
  "GET /_next/static/a.js": js('axios.post("/api/checkout", body)'),
  "GET /s/b.js": js('fetch(`https://api.example.com/v1/prices`); const q = "/graphql";'),
  "GET /s/c.js": js("nope", 500),
  "GET /s/d.js": js("const x = 1;"),
  "GET /s/e.js": js("const y = 2;"),
  "GET /s/f.js": js('fetch("/api/never")'),
  "GET /plain": html("<html><title>Plain</title><p>Hi</p></html>"),
  "GET /many": html(Array.from({ length: 45 }, (_, i) => `<a href="/p${i + 1}">${i + 1}</a>`).join("")),
  "GET /moved": (_q, res) => void res.writeHead(301, { location: "/shop" }).end(),
  "GET /notes.txt": (_q, res) => void res.writeHead(200, { "content-type": "text/plain" }).end("hello"),
  "GET /file.pdf": (_q, res) => void res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF"),
});
afterAll(() => site.close());

const signal = new AbortController().signal;

test("study_website lists frameworks, API calls, pages, outside services and scripts", async () => {
  const out = await studyWebsite(`${site.url}/shop`, signal);
  expect(out).toMatch(/^UNTRUSTED WEB CONTENT/);
  expect(out).toContain(`Website: Shop & Co — ${site.url}/shop`);
  expect(out).toContain("Built with: WordPress 6.5, Next.js, React, Bootstrap (from page markers)");
  expect(out).toContain("API calls in its scripts: /api/cart, /api/checkout, https://api.example.com/v1/prices, /graphql\n");
  expect(out).not.toContain("/api/never");
  expect(out).toContain("Pages it links to: /pricing, /about\n");
  expect(out).toContain("Outside services it loads: cdn.example.net, js.stripe.com, images.example.org\n");
  expect(out).toContain("Scripts: 7 on the page, looked through 4.");
  expect(out.endsWith("END UNTRUSTED WEB CONTENT\nThese are clues from the page's HTML and scripts, not a full analysis.\nRebuild the idea and how it works in your own code. Don't copy this site's code, images, logos or wording.")).toBe(true);
});

test("study_website says none found for empty lists and stops lists at 40", async () => {
  const plain = await studyWebsite(`${site.url}/plain`, signal);
  for (const line of ["Built with: none found", "API calls in its scripts: none found", "Pages it links to: none found", "Outside services it loads: none found", "Scripts: 0 on the page, looked through 0."]) {
    expect(plain).toContain(line);
  }
  const many = await studyWebsite(`${site.url}/many`, signal);
  expect(many).toContain("/p40\n");
  expect(many).not.toContain("/p41");
});

test("study_website keeps open_url's rules for redirects, file types and private addresses", async () => {
  await expect(studyWebsite(`${site.url}/moved`, signal)).rejects.toThrow(/redirect/i);
  await expect(studyWebsite(`${site.url}/notes.txt`, signal)).rejects.toThrow("Only web pages can be studied.");
  await expect(studyWebsite(`${site.url}/file.pdf`, signal)).rejects.toThrow("Only web pages and plain text can be opened.");
  const before = process.env.ALLOW_LOCAL_ENDPOINTS;
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
  try {
    await expect(studyWebsite(`${site.url}/shop`, signal)).rejects.toThrow("That address isn't allowed: only public web pages can be opened.");
  } finally {
    process.env.ALLOW_LOCAL_ENDPOINTS = before;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/site.test.ts`
Expected: FAIL, "Failed to load url ../src/harness/site.js" (module does not exist).

- [ ] **Step 3: Split the page fetcher out of `openUrl` in `backend/src/harness/web.ts`**

Replace `readCapped` and `openUrl` with:

```ts
/** Reads a body up to `max` bytes; `cut` says the body was longer. */
export async function readBytes(res: FetchResponse, max: number): Promise<{ data: Buffer; cut: boolean }> {
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done || !value) return { data: Buffer.concat(chunks), cut: false };
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return { data: Buffer.concat(chunks), cut: true };
    }
    chunks.push(value);
  }
}

export async function readCapped(res: FetchResponse): Promise<string> {
  return (await readBytes(res, MAX_DOWNLOAD)).data.toString("utf8");
}

/** Fetches a public page with open_url's rules: no redirects, web pages and plain text only, 2 MB at most. */
export async function fetchPage(url: string, signal: AbortSignal): Promise<{ body: string; type: string }> {
  let res: FetchResponse;
  try {
    res = await safeFetch(url, { signal, headers: { accept: "text/html, text/plain" } });
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new ToolError("That address isn't allowed: only public web pages can be opened.");
    if (signal.aborted) throw e;
    const cause = String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
    if (/redirect/i.test(cause)) throw new ToolError("That page redirects somewhere else. Open the final address instead (for example https:// instead of http://).");
    throw new ToolError("Couldn't open that page.");
  }
  if (res.status >= 300 && res.status < 400) throw new ToolError("That page redirects somewhere else. Open the final address instead (for example https:// instead of http://).");
  if (!res.ok) throw new ToolError(`The page answered with an error (${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/(html|plain)/i.test(type)) throw new ToolError("Only web pages and plain text can be opened.");
  return { body: await readCapped(res), type };
}

export async function openUrl(url: string, signal: AbortSignal): Promise<string> {
  const { body, type } = await fetchPage(url, signal);
  const text = /html/i.test(type) ? htmlToText(body) : body;
  const capped = text.length > PAGE_CHARS ? `${text.slice(0, PAGE_CHARS)}\n[truncated]` : text;
  return untrusted(`${url}\n\n${capped}`);
}
```

- [ ] **Step 4: Write `backend/src/harness/site.ts` with `studyWebsite`**

```ts
import { safeFetch } from "../safe-fetch.js";
import { ToolError } from "./loop.js";
import { fetchPage, htmlToText, readBytes, untrusted } from "./web.js";

const MAX_LIST = 40;
const SCRIPTS = 5;
const SCRIPT_BYTES = 1024 * 1024;

/** De-duplicated, first 40, or "none found". */
export const list = (items: Iterable<string>) => {
  const all = [...new Set(items)].slice(0, MAX_LIST);
  return all.length ? all.join(", ") : "none found";
};
export const rebuild = (what: string) => `Rebuild ${what} in your own code. Don't copy this site's code, images, logos or wording.`;

// Narrow on purpose: a word like "bootstrap" in page code isn't enough.
const MARKERS: [string, RegExp][] = [
  ["Next.js", /\/_next\/|__NEXT_DATA__/],
  ["Nuxt", /\/_nuxt\/|__NUXT__/],
  ["Gatsby", /___gatsby/],
  ["Remix", /__remixContext/],
  ["SvelteKit", /__sveltekit/],
  ["Astro", /astro-island/],
  ["Angular", /ng-version=/],
  ["Vue", /data-v-[0-9a-f]{8}/],
  ["React", /data-reactroot|react-dom/],
  ["WordPress", /wp-content/],
  ["Shopify", /cdn\.shopify\.com/],
  ["Webflow", /data-wf-page/],
  ["Framer", /framerusercontent\.com/],
  ["Wix", /wixstatic\.com/],
  ["Squarespace", /static1\.squarespace\.com/],
  ["Bootstrap", /bootstrap[\w.-]*\.(?:css|js)\b/i],
  ["jQuery", /jquery[\w.-]*\.js\b/i],
];
const REACT_BASED = ["Next.js", "Gatsby", "Remix"];

const API_CALLS = [
  /\bfetch\(\s*(["'`])((?:\/|https?:\/\/)[^"'`\s]*)\1/g,
  /\baxios\.(?:get|post|put|patch|delete)\(\s*(["'`])((?:\/|https?:\/\/)[^"'`\s]*)\1/g,
  /(["'`])(\/(?:api|graphql)\b[^"'`\s]*)\1/g,
];
const FILE = /\.(?:png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|css|m?js|json|xml|txt|woff2?|ttf|otf|mp4|webm|mp3)$/i;

async function script(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await safeFetch(url, { signal });
    return res.ok ? (await readBytes(res, SCRIPT_BYTES)).data.toString("utf8") : null;
  } catch (e) {
    if (signal.aborted) throw e;
    return null;
  }
}

/** Clues about how a page is built, read from its HTML and up to 5 of its own scripts. */
export async function studyWebsite(url: string, signal: AbortSignal): Promise<string> {
  const page = await fetchPage(url, signal);
  if (!/html/i.test(page.type)) throw new ToolError("Only web pages can be studied.");
  const html = page.body;
  const base = new URL(url);
  const urls = (re: RegExp) =>
    [...html.matchAll(re)].flatMap((m) => {
      try {
        const u = new URL(m[1], base);
        return /^https?:$/.test(u.protocol) ? [u] : [];
      } catch {
        return [];
      }
    });

  const scripts = urls(/<script\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi);
  const fetched = (await Promise.all(scripts.filter((u) => u.host === base.host).slice(0, SCRIPTS).map((u) => script(u.href, signal)))).filter((s): s is string => s !== null);
  const inline = [...html.matchAll(/<script\b(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

  const generator = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\sname\s*=\s*["']generator["']/i.test(t))?.match(/\scontent\s*=\s*["']([^"']+)["']/i)?.[1];
  const hay = [html, ...scripts.map((u) => u.href)].join("\n");
  const built: string[] = generator ? [htmlToText(generator)] : [];
  for (const [name, re] of MARKERS) if (re.test(hay) || (name === "React" && built.some((n) => REACT_BASED.includes(n)))) built.push(name);

  const api = [...inline, ...fetched].flatMap((code) => API_CALLS.flatMap((re) => [...code.matchAll(re)].map((m) => m[2])));
  const pages = urls(/<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi).filter((u) => u.host === base.host && !FILE.test(u.pathname)).map((u) => u.pathname);
  const outside = urls(/<(?:script|link|img|iframe|source)\b[^>]*?\s(?:src|href)\s*=\s*["']([^"']+)["']/gi).filter((u) => u.host !== base.host).map((u) => u.host);
  const title = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");

  const body = [
    `Website: ${title || "(no title)"} — ${url}`,
    `Built with: ${built.length ? `${list(built)} (from page markers)` : "none found"}`,
    `API calls in its scripts: ${list(api)}`,
    `Pages it links to: ${list(pages)}`,
    `Outside services it loads: ${list(outside)}`,
    `Scripts: ${scripts.length} on the page, looked through ${fetched.length}.`,
  ].join("\n");
  return `${untrusted(body)}\nThese are clues from the page's HTML and scripts, not a full analysis.\n${rebuild("the idea and how it works")}`;
}
```

- [ ] **Step 5: Run the new tests and the existing `open_url` tests**

Run: `cd backend && npx vitest run test/site.test.ts test/harness-tools.test.ts`
Expected: PASS (all tests in both files; `open_url` behaves exactly as before).

- [ ] **Step 6: Typecheck**

Run: `npm --prefix backend run typecheck`
Expected: no output after the script header.

- [ ] **Step 7: Commit**

```bash
git add backend/src/harness/web.ts backend/src/harness/site.ts backend/test/site.test.ts
git commit -m "feat(backend): study_website logic — frameworks, API calls, links and outside services from a page's HTML and scripts"
```

### Task 2: `look_at_website` logic

**Files:**
- Modify: `backend/src/harness/site.ts`
- Test: `backend/test/site.test.ts`

**Interfaces:**
- Consumes: `list`, `rebuild` (Task 1, same file); `readBytes`, `readCapped`, `untrusted` from `web.ts`; `MAX_IMAGE_BYTES` from `../attachments/parts.js`; `ToolOutput` from `./loop.js`
- Produces: `export async function lookAtWebsite(url: string, signal: AbortSignal): Promise<ToolOutput>`

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/site.test.ts` (merge the import into the existing one: `import { lookAtWebsite, studyWebsite } from "../src/harness/site.js";`):

```ts
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const MD = "# [](https://shop.example/)\n\n# Pricing for [every](https://shop.example/teams) team\nPick a plan.\n## Plans\n#### Tiny print\n";
const json = (res: import("node:http").ServerResponse, status: number, data?: object) => void res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ code: status, data }));
// One fake Jina: the path is the page URL; the x-respond-with header picks text or screenshot.
const reader = (text: (res: import("node:http").ServerResponse) => void, shot: (res: import("node:http").ServerResponse) => void) => (q: { headers: Record<string, unknown> }, res: import("node:http").ServerResponse) => (q.headers["x-respond-with"] === "screenshot" ? shot(res) : text(res));
const okText = (res: import("node:http").ServerResponse) => json(res, 200, { title: "Pricing", content: MD });
const okShot = (path: string) => (res: import("node:http").ServerResponse) => json(res, 200, { title: "Pricing", screenshotUrl: `${jina.url}${path}` });

const jina = await fakeServer({
  "GET /https://shop.example/pricing": reader(okText, okShot("/shot.png")),
  "GET /https://noshot.example/": reader(okText, (res) => json(res, 500)),
  "GET /https://notext.example/": reader((res) => json(res, 500), okShot("/shot.png")),
  "GET /https://busy.example/": reader((res) => json(res, 429), (res) => json(res, 429)),
  "GET /https://gone.example/": reader((res) => json(res, 200, { httpStatus: 404 }), (res) => json(res, 200, { httpStatus: 404 })),
  "GET /https://empty.example/": reader((res) => json(res, 200, { title: "E" }), (res) => json(res, 200, { title: "E" })),
  "GET /https://bigshot.example/": reader(okText, okShot("/big.png")),
  "GET /https://txtshot.example/": reader(okText, okShot("/shot.txt")),
  "GET /shot.png": (_q, res) => void res.writeHead(200, { "content-type": "image/png" }).end(PNG),
  "GET /big.png": (_q, res) => void res.writeHead(200, { "content-type": "image/png" }).end(Buffer.alloc(3_750_001)),
  "GET /shot.txt": (_q, res) => void res.writeHead(200, { "content-type": "text/plain" }).end("not an image"),
});
process.env.JINA_URL = jina.url;
afterAll(() => jina.close());

test("look_at_website returns the screenshot, sections and page text", async () => {
  const out = await lookAtWebsite("https://shop.example/pricing", signal);
  expect(out.images).toEqual([{ mime: "image/png", data: PNG.toString("base64") }]);
  expect(out.text).toMatch(/^UNTRUSTED WEB CONTENT/);
  expect(out.text).toContain("Website: Pricing — https://shop.example/pricing\nScreenshot: top of the page.\nSections:\n- # Pricing for every team\n- ## Plans\nPage text (Markdown):\n# [](https://shop.example/)");
  expect(out.text).not.toContain("- #### Tiny print");
  expect(out.text.endsWith("END UNTRUSTED WEB CONTENT\nRebuild the idea and layout in your own code. Don't copy this site's code, images, logos or wording.")).toBe(true);
});

test("look_at_website sends the Jina key only when one is set", async () => {
  const auth = () => jina.requests.filter((r) => r.path === "/https://shop.example/pricing").map((r) => r.headers.authorization);
  await lookAtWebsite("https://shop.example/pricing", signal);
  expect(auth().every((a) => a === undefined)).toBe(true);
  process.env.JINA_API_KEY = "jina-test-key";
  try {
    await lookAtWebsite("https://shop.example/pricing", signal);
  } finally {
    delete process.env.JINA_API_KEY;
  }
  expect(auth().slice(-2)).toEqual(["Bearer jina-test-key", "Bearer jina-test-key"]);
});

test("look_at_website returns what it got when one part fails", async () => {
  const noShot = await lookAtWebsite("https://noshot.example/", signal);
  expect(noShot.images).toEqual([]);
  expect(noShot.text).toContain("No screenshot this time.");
  expect(noShot.text).toContain("- ## Plans");
  for (const page of ["https://bigshot.example/", "https://txtshot.example/"]) {
    const out = await lookAtWebsite(page, signal);
    expect(out.images).toEqual([]);
    expect(out.text).toContain("No screenshot this time.");
  }
  const noText = await lookAtWebsite("https://notext.example/", signal);
  expect(noText.images).toHaveLength(1);
  expect(noText.text).toContain("Couldn't read the page text.");
  expect(noText.text).not.toContain("Sections:");
});

test("look_at_website explains why it failed when nothing came back", async () => {
  await expect(lookAtWebsite("https://busy.example/", signal)).rejects.toThrow("The free page reader is busy. Try again in a minute.");
  await expect(lookAtWebsite("https://gone.example/", signal)).rejects.toThrow("The page answered with an error (404).");
  await expect(lookAtWebsite("https://empty.example/", signal)).rejects.toThrow("Couldn't open that page through the page reader.");
});

test("look_at_website refuses a private address before asking the reader", async () => {
  const before = process.env.ALLOW_LOCAL_ENDPOINTS;
  const sent = jina.requests.length;
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
  try {
    await expect(lookAtWebsite("http://127.0.0.1:9/admin", signal)).rejects.toThrow("That address isn't allowed: only public web pages can be opened.");
  } finally {
    process.env.ALLOW_LOCAL_ENDPOINTS = before;
  }
  expect(jina.requests.length).toBe(sent);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/site.test.ts`
Expected: FAIL, "lookAtWebsite is not a function" / "does not provide an export named 'lookAtWebsite'"; the Task 1 tests still pass.

- [ ] **Step 3: Add `lookAtWebsite` to `backend/src/harness/site.ts`**

Change the imports at the top to:

```ts
import { MAX_IMAGE_BYTES } from "../attachments/parts.js";
import { checkBaseUrl, safeFetch } from "../safe-fetch.js";
import { ToolError, type ToolOutput } from "./loop.js";
import { fetchPage, htmlToText, readBytes, readCapped, untrusted } from "./web.js";
```

Append:

```ts
const PART_MS = 17_000;
const MARKDOWN_CHARS = 12_000;
const MAX_SECTIONS = 60;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const READER_FAILED = "Couldn't open that page through the page reader.";

type ReaderData = { title?: string; content?: string; screenshotUrl?: string; httpStatus?: number };

/** One Jina Reader request: the page's title and Markdown, or (screenshot) a link to its picture. */
async function reader(url: string, screenshot: boolean, signal: AbortSignal): Promise<ReaderData> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (screenshot) headers["x-respond-with"] = "screenshot";
  if (process.env.JINA_API_KEY) headers.authorization = `Bearer ${process.env.JINA_API_KEY}`;
  const res = await safeFetch(`${process.env.JINA_URL ?? "https://r.jina.ai"}/${url}`, { signal, headers });
  if (res.status === 429) throw new ToolError("The free page reader is busy. Try again in a minute.");
  if (!res.ok) throw new ToolError(READER_FAILED);
  let data: ReaderData | undefined;
  try {
    data = (JSON.parse(await readCapped(res)) as { data?: ReaderData }).data;
  } catch {
    throw new ToolError(READER_FAILED);
  }
  if (!data) throw new ToolError(READER_FAILED);
  if (data.httpStatus && data.httpStatus >= 400) throw new ToolError(`The page answered with an error (${data.httpStatus}).`);
  return data;
}

/** Runs one part with its own deadline and turns any failure into a message the companion can use. */
async function part<T>(signal: AbortSignal, run: (s: AbortSignal) => Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(PART_MS);
  try {
    return await run(AbortSignal.any([signal, deadline]));
  } catch (e) {
    if (signal.aborted) throw e;
    if (e instanceof ToolError) throw e;
    if (deadline.aborted) throw new ToolError("That page took too long to load.");
    throw new ToolError(READER_FAILED);
  }
}

const sectionsOf = (md: string) =>
  md
    .split("\n")
    .filter((l) => /^#{1,3} /.test(l))
    .map((l) => l.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").trim())
    .filter((l) => l.replace(/^#+/, "").trim())
    .slice(0, MAX_SECTIONS);

/** A screenshot and the Markdown of a public page, both from Jina Reader, which renders the page in its own browser. */
export async function lookAtWebsite(url: string, signal: AbortSignal): Promise<ToolOutput> {
  try {
    checkBaseUrl(url);
  } catch {
    throw new ToolError("That address isn't allowed: only public web pages can be opened.");
  }
  const [text, shot] = await Promise.allSettled([
    part(signal, async (s) => {
      const d = await reader(url, false, s);
      if (!d.content?.trim()) throw new ToolError(READER_FAILED);
      return { title: d.title, markdown: d.content };
    }),
    part(signal, async (s) => {
      const d = await reader(url, true, s);
      if (!d.screenshotUrl) throw new ToolError(READER_FAILED);
      const res = await safeFetch(d.screenshotUrl, { signal: s });
      const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!res.ok || !IMAGE_TYPES.includes(mime)) throw new ToolError(READER_FAILED);
      const { data, cut } = await readBytes(res, MAX_IMAGE_BYTES);
      if (cut) throw new ToolError(READER_FAILED);
      return { title: d.title, image: { mime, data: data.toString("base64") } };
    }),
  ]);
  if (text.status === "rejected" && shot.status === "rejected") throw text.reason;
  const title = (text.status === "fulfilled" && text.value.title) || (shot.status === "fulfilled" && shot.value.title) || "(no title)";
  const lines = [`Website: ${title} — ${url}`, shot.status === "fulfilled" ? "Screenshot: top of the page." : "No screenshot this time."];
  if (text.status === "fulfilled") {
    const md = text.value.markdown;
    const sections = sectionsOf(md);
    lines.push(sections.length ? `Sections:\n${sections.map((s) => `- ${s}`).join("\n")}` : "Sections: none found");
    lines.push(`Page text (Markdown):\n${md.length > MARKDOWN_CHARS ? `${md.slice(0, MARKDOWN_CHARS)}\n[truncated]` : md.trim()}`);
  } else {
    lines.push("Couldn't read the page text.");
  }
  return {
    text: `${untrusted(lines.join("\n"))}\n${rebuild("the idea and layout")}`,
    images: shot.status === "fulfilled" ? [shot.value.image] : [],
  };
}
```

`htmlToText` stays imported for Task 1's use.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/site.test.ts`
Expected: PASS (all study and look tests).

- [ ] **Step 5: Typecheck**

Run: `npm --prefix backend run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/harness/site.ts backend/test/site.test.ts
git commit -m "feat(backend): look_at_website logic — Jina Reader screenshot and page text, partial results, busy and error messages"
```

### Task 3: Give companions the two tools

**Files:**
- Modify: `backend/src/harness/tools.ts` (`webTools`)
- Test: `backend/test/harness-tools.test.ts`, `backend/test/chat-harness.test.ts`

**Interfaces:**
- Consumes: `lookAtWebsite(url, signal): Promise<ToolOutput>`, `studyWebsite(url, signal): Promise<string>` from `./site.js`
- Produces: `webTools(searchKey)` returns, in order, `open_url`, `look_at_website`, `study_website`, `web_search`

- [ ] **Step 1: Update the tests to expect the new tools**

In `backend/test/harness-tools.test.ts`, change both
`expect(tools.map((t) => t.name)).toEqual(["open_url", "web_search"]);`
to
`expect(tools.map((t) => t.name)).toEqual(["open_url", "look_at_website", "study_website", "web_search"]);`

and add this test after them:

```ts
test("the website tools are labelled with the host", () => {
  const tools = webTools(null);
  for (const name of ["look_at_website", "study_website"]) {
    expect(tools.find((t) => t.name === name)!.label({ url: "https://stripe.com/pricing" })).toBe("stripe.com");
  }
});
```

In `backend/test/chat-harness.test.ts`, in the test "without a project only web tools are offered; one-to-one chats get web tools", add inside the `for (const s of seen)` loop:

```ts
    expect(s).toContain("- look_at_website:");
    expect(s).toContain("- study_website:");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/harness-tools.test.ts test/chat-harness.test.ts`
Expected: FAIL: the tool list is `["open_url", "web_search"]` and the prompts lack `- look_at_website:`.

- [ ] **Step 3: Add the tools in `backend/src/harness/tools.ts`**

Add the import next to the `./web.js` one:

```ts
import { lookAtWebsite, studyWebsite } from "./site.js";
```

Above `webTools`, add a shared label helper:

```ts
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 60);
  }
};
```

In `webTools`, use it for `open_url` (replace its inline `label` with `label: (a) => hostOf(a.url),`) and add after the `open_url` entry, inside the same array:

```ts
    {
      name: "look_at_website",
      purpose: "Shows a screenshot of a public web page and its text. Use it when asked to build something like an existing site.",
      argsHelp: '{"url": "https://..."}',
      args: z.object({ url: z.string().url().max(2000) }),
      label: (a) => hostOf(a.url),
      run: (a, signal) => lookAtWebsite(a.url, signal),
    },
    {
      name: "study_website",
      purpose: "Checks how a public web page is built: frameworks, API calls in its scripts, pages it links to and outside services.",
      argsHelp: '{"url": "https://..."}',
      args: z.object({ url: z.string().url().max(2000) }),
      label: (a) => hostOf(a.url),
      run: (a, signal) => studyWebsite(a.url, signal),
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/harness-tools.test.ts test/chat-harness.test.ts test/site.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm --prefix backend run typecheck` (expected: no errors), then:

```bash
git add backend/src/harness/tools.ts backend/test/harness-tools.test.ts backend/test/chat-harness.test.ts
git commit -m "feat(backend): companions get look_at_website and study_website wherever they can open pages"
```

### Task 4: Activity line labels

**Files:**
- Modify: `frontend/src/lib/activity.ts`
- Test: `frontend/src/lib/activity.test.ts`

**Interfaces:**
- Consumes: tool names `look_at_website`, `study_website` (Task 3)
- Produces: nothing new; `activitySummary` and `liveLabel` keep their signatures

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/activity.test.ts`:

```ts
test("website tools read plainly in the activity line", () => {
  assert.equal(liveLabel({ name: "look_at_website", label: "stripe.com" }), "🖼️ Looking at stripe.com…");
  assert.equal(liveLabel({ name: "study_website", label: "stripe.com" }), "🔎 Studying stripe.com…");
  assert.equal(activitySummary([u("look_at_website"), u("study_website"), u("study_website", "b")], 0), "Looked at 1 website · Studied 2 websites");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:unit`
Expected: FAIL: `"Using stripe.com…" !== "🖼️ Looking at stripe.com…"`.

- [ ] **Step 3: Add the labels in `frontend/src/lib/activity.ts`**

In `activitySummary`'s `parts`, after the `open_url` line:

```ts
    count("look_at_website") ? `Looked at ${plural(count("look_at_website"), "website", "websites")}` : "",
    count("study_website") ? `Studied ${plural(count("study_website"), "website", "websites")}` : "",
```

In `liveLabel`'s `what` map, add `look_at_website: "🖼️ Looking at", study_website: "🔎 Studying"`.

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npm --prefix frontend run test:unit && (cd frontend && npx tsc --noEmit && npx eslint src/lib/activity.ts src/lib/activity.test.ts)`
Expected: all unit tests pass; no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/activity.ts frontend/src/lib/activity.test.ts
git commit -m "feat(frontend): activity line shows companions looking at and studying websites"
```

### Task 5: Verify against the real web and ship

No new files; the real-world check uses a throwaway script outside the repo.

- [ ] **Step 1: Full backend suite**

Run from the worktree root: `npm --prefix backend test > "$TMPDIR/website-study-tests.log" 2>&1; echo exit=$?; tail -15 "$TMPDIR/website-study-tests.log"`
Expected: `exit=0`, every test file passed.

- [ ] **Step 2: Real-world check (internet, real Jina, no key)**

Run from the worktree root (the heredoc is unquoted so `$PWD` expands):

```bash
cat > "$TMPDIR/try-site.mts" <<EOF
import { lookAtWebsite, studyWebsite } from "$PWD/backend/src/harness/site.ts";
const s = new AbortController().signal;
const look = await lookAtWebsite("https://stripe.com/pricing", s);
console.log(look.images.map((i) => i.mime + " " + i.data.length + " base64 chars"));
console.log(look.text.slice(0, 600));
console.log((await studyWebsite("https://vercel.com/pricing", s)).slice(0, 1200));
EOF
(cd backend && npx tsx "$TMPDIR/try-site.mts")
```

Expected: one `image/png` picture; a "Website: Pricing & Fees — https://stripe.com/pricing" line, then sections and Markdown; for vercel.com, "Built with:" includes Next.js and React. If vercel.com redirects, that is today's `open_url` rule; use the address it names.

- [ ] **Step 3: Merge and push**

In the main working tree (on `milestone-1`), run `git merge --ff-only website-study`. That tree holds other people's uncommitted work: if git refuses because those changes touch the same files, stop and ask the owner. Then `git push origin milestone-1 milestone-1:main` (origin `main` is an ancestor of `milestone-1`, so this is a fast-forward). Render and Vercel deploy from `main` on their own.

- [ ] **Step 4: Owner check on the live site**

Ask the owner to open a companion chat and send "make a pricing page like https://stripe.com/pricing", and confirm the activity line shows "🖼️ Looking at stripe.com…" and the companion describes the page.
