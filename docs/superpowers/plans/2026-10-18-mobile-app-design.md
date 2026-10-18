# Mobile App Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A request like "Design a mobile app for a hiking club" makes the team plan a look and a screen list, draw each screen as `screens/NN-name.html`, and the owner sees all screens side by side in phone frames.

**Architecture:** One new backend file (`goals/mobile.ts`) holds the detector and two instruction texts; the planner, task runner and Nova's review add them for mobile design goals. The frontend gets a screen-list helper and a `PhoneScreens` gallery used on the project page and in the chat's preview panel, plus a chat starter example.

**Tech Stack:** Node 22, TypeScript, Fastify, Vitest (backend), Next.js + React (frontend), `node --test` (frontend unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-10-18-mobile-app-design-design.md`

**Base:** branch `mobile-design` from `milestone-1` (spec commit `00ad78d`).

## Global Constraints

- Render free plan: no new npm packages, no database changes, no new backend routes.
- Phone size 390×844; status bar 47 px and home indicator 34 px kept clear; tap targets at least 44 px; text at least 12 px.
- Tailwind from `https://cdn.tailwindcss.com`; the same `tailwind.config` and Google Fonts link in every screen.
- Screens live at `screens/NN-name.html`; the look at `design/identity.md`, the list at `design/screens.md`.
- `MOBILE_GUIDE` stays under 2,000 characters.
- Screens load only through the existing sandboxed preview (`POST {project}/preview-token`, then `/api/preview/<token>/<path>`), iframes with `sandbox="allow-scripts allow-forms"` and `referrerPolicy="no-referrer"`.
- Detector phrases (any case): "mobile app", "iOS app", "Android app", "iPhone app", "phone app", "app screens", "app design", "app UI", "app mockups", "mobile design", "mobile screens", "mobile UI".
- Copy: button "Phone screens"; per screen "Ask for changes" (chat only); "Download screens"; chat starter "Design a mobile app" with prompt "Design a mobile app for ".

## Review Focus

1. A screen file without a number (`screens/login.html`) or in capitals (`Screens/01-Home.HTML`): listed and named ("Login", "Home"), not dropped. Pinned in Task 3.
2. Ten or more screens: `10-settings` sorts after `02-profile`, not after `01`. Pinned in Task 3.
3. Many screens loading at once: every gallery iframe has `loading="lazy"`. Pinned in Task 4's e2e test.
4. A project that has both `index.html` and screens: the chat preview opens on the screens, and the file picker still reaches `index.html`. Pinned in Task 4's e2e test.
5. Files in deeper folders (`screens/old/x.html`) or other types (`screens/notes.md`): not shown as phone screens. Pinned in Task 3.

---

### Task 1: Mobile design texts and detector

**Files:**
- Create: `backend/src/goals/mobile.ts`
- Modify: `backend/src/goals/prompts.ts` (`planInstructions`, `taskInstructions`)
- Modify: `backend/src/goals/quality.ts` (`reviewPrompt`)
- Test: `backend/test/mobile-unit.test.ts`

**Interfaces:**
- Produces: `isMobileDesign(text: string): boolean`; `MOBILE_PLAN: string` (starts with "MOBILE APP DESIGN:"); `MOBILE_GUIDE: string` (starts with "MOBILE SCREEN GUIDE"); `planInstructions(company, newProject = false, canMakeImages = false, mobile = false)`; `taskInstructions(agent, company, department, hasProject, visual = false, mobile = false)`; `reviewPrompt` input gains optional `mobile?: boolean`.

- [ ] **Step 1: Write the failing test** — create `backend/test/mobile-unit.test.ts`:

```ts
import { expect, test } from "vitest";
import { isMobileDesign, MOBILE_GUIDE, MOBILE_PLAN } from "../src/goals/mobile.js";
import { planInstructions, taskInstructions } from "../src/goals/prompts.js";
import { reviewPrompt } from "../src/goals/quality.js";

const agent = { name: "Lina", role: "Designer", workingStyle: "Clear." };

test("mobile design goals are recognised from their words", () => {
  for (const text of ["Design a mobile app for a hiking club", "Make an iOS app for my bakery", "android app for a gym", "iPhone app screens", "phone app for runners", "App UI for a budget tracker", "app mockups please", "Mobile design for our shop", "mobile screens for a quiz"]) {
    expect(isMobileDesign(text), text).toBe(true);
  }
  for (const text of ["Build a landing page for my bakery", "Write app store copy", "Research three competitors"]) {
    expect(isMobileDesign(text), text).toBe(false);
  }
});

test("planning, tasks and review get the mobile texts only for mobile goals", () => {
  expect(MOBILE_PLAN.startsWith("MOBILE APP DESIGN:")).toBe(true);
  expect(planInstructions("Co", true, false, true)).toContain(MOBILE_PLAN);
  expect(planInstructions("Co", true, false)).not.toContain("MOBILE APP DESIGN:");
  expect(taskInstructions(agent, "Co", null, true, true, true)).toContain(MOBILE_GUIDE);
  expect(taskInstructions(agent, "Co", null, true, true)).not.toContain("MOBILE SCREEN GUIDE");
  const review = (mobile?: boolean) => reviewPrompt({ goal: "g", task: { title: "t", instructions: "i", deliverable: "d", criteria: ["c"] }, brief: null, guide: true, mobile, result: "r", files: [] });
  expect(review(true)).toContain(MOBILE_GUIDE);
  expect(review()).not.toContain("MOBILE SCREEN GUIDE");
});

test("the screen guide names the phone size, Tailwind, the look file and tap targets, and stays short", () => {
  expect(MOBILE_GUIDE.startsWith("MOBILE SCREEN GUIDE")).toBe(true);
  for (const part of ["390×844", "https://cdn.tailwindcss.com", "design/identity.md", "design/screens.md", "44 px", "screens/NN-name.html"]) expect(MOBILE_GUIDE).toContain(part);
  expect(MOBILE_GUIDE.length).toBeLessThan(2000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/mobile-unit.test.ts`
Expected: FAIL, "Cannot find module '../src/goals/mobile.js'".

- [ ] **Step 3: Create `backend/src/goals/mobile.ts`**

```ts
// Words that make a goal a mobile app design (spec 2.1 item 2).
const MOBILE = /\b(?:mobile|ios|android|iphone|phone)\s+app\b|\bapp\s+(?:screens?|design|ui|mockups?)\b|\bmobile\s+(?:design|screens?|ui)\b/i;

export const isMobileDesign = (text: string) => MOBILE.test(text);

/** Added to Nova's planning instructions for a mobile design goal. */
export const MOBILE_PLAN =
  'MOBILE APP DESIGN: this goal designs a mobile app. The first task is "The look and the screen list": it writes design/identity.md (app name, audience, feeling, colours as hex values, fonts from Google Fonts, spacing scale, corner radius, and the shared header, tab bar, buttons, cards and inputs) and design/screens.md (the numbered screens: file name screens/NN-name.html, purpose, key content, how it is reached). If the owner attached a screenshot, the look matches it. Every other task draws 3 or 4 screens from that list, saved as screens/NN-name.html, and depends on the first task. Plan 6 to 10 screens unless the owner asked for a number. The brief is a short summary of the look.';

/** Added to the instructions of every task in a mobile design goal, and to Nova's review of them. */
export const MOBILE_GUIDE = `MOBILE SCREEN GUIDE (this goal designs a mobile app):
Read design/identity.md and design/screens.md first, and draw exactly the screens your task names.
Each screen is one standalone HTML file, screens/NN-name.html, with <title> set to the screen's name and <meta name="viewport" content="width=390, initial-scale=1">, laid out for a 390×844 phone.
Use Tailwind from https://cdn.tailwindcss.com with the same tailwind.config (colours, fonts) and the same Google Fonts link in every screen.
Keep the top 47 px (status bar) and the bottom 34 px (home indicator) clear of content. Use native patterns: the tab bar or navigation bar from design/screens.md, and the same header, tab bar and buttons on every screen.
Tap targets at least 44 px; text at least 12 px; real content, no placeholders; icons as inline SVG, no emoji or icon fonts; pictures from generate_image only where they matter (about 6 free a day), otherwise colour and shape.
It must look like a real app, not a website squeezed into a phone.`;
```

- [ ] **Step 4: Add the texts to the instruction builders**

In `backend/src/goals/prompts.ts`, import them next to the `DESIGN_GUIDE` import:

```ts
import { MOBILE_GUIDE, MOBILE_PLAN } from "./mobile.js";
```

Change `planInstructions`'s signature to `(company: string, newProject = false, canMakeImages = false, mobile = false)` and add, right after the `canMakeImages ? … : ""` entry:

```ts
    mobile ? MOBILE_PLAN : "",
```

Change `taskInstructions`'s signature to `(agent: { name: string; role: string; workingStyle: string }, company: string, department: string | null, hasProject: boolean, visual = false, mobile = false)` and after `visual ? DESIGN_GUIDE : "",` add:

```ts
    mobile ? MOBILE_GUIDE : "",
```

In `backend/src/goals/quality.ts`, import `import { MOBILE_GUIDE } from "./mobile.js";`, add `mobile?: boolean` to `reviewPrompt`'s input type (after `guide: boolean;`), and after `o.guide ? DESIGN_GUIDE : "",` add:

```ts
    o.mobile ? MOBILE_GUIDE : "",
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd backend && npx vitest run test/mobile-unit.test.ts test/quality-unit.test.ts && npm run typecheck`
Expected: all tests pass; typecheck prints no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/goals/mobile.ts backend/src/goals/prompts.ts backend/src/goals/quality.ts backend/test/mobile-unit.test.ts
git commit -m "feat(backend): mobile design detector, planning text and screen guide"
```

### Task 2: Planner, runner and review use them

**Files:**
- Modify: `backend/src/goals/planner.ts` (the `completeJson(... planInstructions(...) ...)` call)
- Modify: `backend/src/goals/runner.ts` (`visual`, `taskInstructions(...)`, `reviewTask(...)`)
- Test: `backend/test/goal-mobile.test.ts`

**Interfaces:**
- Consumes: `isMobileDesign`, `planInstructions(..., mobile)`, `taskInstructions(..., visual, mobile)`, `reviewPrompt({ ..., mobile })` from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test** — create `backend/test/goal-mobile.test.ts`:

```ts
import { afterAll, expect, test, vi } from "vitest";
import { makeApp } from "./helpers.js";
import { company, fakeLLM, fence, systemOf, userOf, waitFor } from "./goal-helpers.js";

// Each test builds whole companies at remote-database latency.
vi.setConfig({ testTimeout: 240_000 });
const llm = await fakeLLM();
const app = await makeApp();
afterAll(async () => {
  await llm.close();
  await app.close();
});

const isPlan = (s: string) => s.includes("Turn the owner's goal into a plan");
const isTask = (s: string) => s.includes("Nova assigned you a task");
const isReview = (s: string) => s.includes("Review a teammate's finished task");
const isSummary = (s: string) => s.includes("Review each task result");

/** Runs a one-task goal with Nova's check on and returns the instructions each step was sent. */
async function run(text: string) {
  const co = await company(app, llm, "starter", { qualityChecks: true });
  llm.setScript((s) => {
    if (isPlan(s)) return fence({ projectName: "Trail", tasks: [{ agentId: co.others[0].id, title: "The look and the screen list", instructions: "Plan the look.", deliverable: "design/identity.md", criteria: ["c"], dependsOn: [] }] });
    if (isReview(s)) return fence({ approved: true, fixes: [] });
    if (isSummary(s)) return fence({ summary: "Done.", verdicts: [] });
    if (isTask(s)) return "Done.";
    return "ok";
  });
  const sent = llm.requests.length;
  const gid = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text, newProject: true })).json().id as string;
  const get = async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal;
  await waitFor(get, (g) => g.status === "awaiting_approval");
  expect((await co.req("POST", `/api/workspaces/${co.id}/goals/${gid}/start`)).statusCode).toBe(200);
  expect((await waitFor(get, (g) => g.status === "done" || g.status === "failed")).status).toBe("done");
  const calls = llm.requests.slice(sent).filter((q) => q.path === "/v1/chat/completions");
  const of = (is: (s: string) => boolean) => calls.filter((q) => is(systemOf(q)));
  return { plan: of(isPlan).map(systemOf).join("\n"), task: of(isTask).map(systemOf).join("\n"), review: of(isReview).map(userOf).join("\n") };
}

test("a mobile design goal plans the look first and its tasks and review get the screen guide", async () => {
  const r = await run("Design a mobile app for a hiking club");
  expect(r.plan).toContain("MOBILE APP DESIGN:");
  expect(r.task).toContain("MOBILE SCREEN GUIDE");
  expect(r.review).toContain("MOBILE SCREEN GUIDE");
});

test("an ordinary goal gets none of the mobile texts", async () => {
  const r = await run("Build a landing page for a hiking club");
  expect(r.plan).not.toContain("MOBILE APP DESIGN:");
  expect(r.task).not.toContain("MOBILE SCREEN GUIDE");
  expect(r.review).not.toContain("MOBILE SCREEN GUIDE");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/goal-mobile.test.ts`
Expected: the first test FAILS (`expected … to contain 'MOBILE APP DESIGN:'`); the second passes.

- [ ] **Step 3: Pass the flag in `planner.ts`**

Add `import { isMobileDesign } from "./mobile.js";` and change the call to:

```ts
    const { value, calls } = await completeJson(nova, planInstructions(goal.workspace.name, goal.newProject, canMakeImages, isMobileDesign(goal.text)), planPrompt(
```

(the rest of that line unchanged).

- [ ] **Step 4: Pass it in `runner.ts`**

Add `import { isMobileDesign } from "./mobile.js";`. Replace the two lines that set `visual` and `instructions` with:

```ts
    const mobile = isMobileDesign(goal.text);
    const visual = !!goal.project || isVisualTask(task) || mobile;
    const instructions = taskInstructions(agent, goal.workspace.name, agent.department?.name ?? null, !!goal.project, visual, mobile);
```

and in the `reviewTask(...)` call change `guide: visual,` to `guide: visual, mobile,`.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd backend && npx vitest run test/goal-mobile.test.ts test/mobile-unit.test.ts && npm run typecheck`
Expected: all pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/goals/planner.ts backend/src/goals/runner.ts backend/test/goal-mobile.test.ts
git commit -m "feat(backend): mobile design goals plan the look first; their tasks and Nova's check use the screen guide"
```

### Task 3: The screen list helper

**Files:**
- Create: `frontend/src/lib/screens.ts`
- Test: `frontend/src/lib/screens.test.ts`

**Interfaces:**
- Produces: `export type PhoneScreen = { path: string; name: string }`; `export function phoneScreens(paths: string[]): PhoneScreen[]`.

- [ ] **Step 1: Write the failing test** — create `frontend/src/lib/screens.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { phoneScreens } from "./screens.ts";

test("only screens/*.html are phone screens, in number order, named from the file name", () => {
  const paths = ["screens/10-settings.html", "index.html", "screens/02-profile.html", "screens/01-home.html", "screens/03-order-history.html", "screens/notes.md", "design/screens.md", "screens/old/x.html", "screens/login.html", "Screens/04-Map.HTML"];
  assert.deepEqual(phoneScreens(paths), [
    { path: "screens/01-home.html", name: "Home" },
    { path: "screens/02-profile.html", name: "Profile" },
    { path: "screens/03-order-history.html", name: "Order history" },
    { path: "Screens/04-Map.HTML", name: "Map" },
    { path: "screens/10-settings.html", name: "Settings" },
    { path: "screens/login.html", name: "Login" },
  ]);
  assert.deepEqual(phoneScreens(["index.html"]), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:unit`
Expected: FAIL, "Cannot find module … screens.ts".

- [ ] **Step 3: Create `frontend/src/lib/screens.ts`**

```ts
export type PhoneScreen = { path: string; name: string };

/** The app screens in a project: HTML files directly in screens/, in number order, named from the file name ("01-order-history.html" → "Order history"). */
export function phoneScreens(paths: string[]): PhoneScreen[] {
  return paths
    .filter((p) => /^screens\/[^/]+\.html?$/i.test(p))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), undefined, { numeric: true }))
    .map((path) => {
      const words = path.replace(/^screens\//i, "").replace(/\.html?$/i, "").replace(/^\d+[-_ ]*/, "").replace(/[-_]+/g, " ").trim().toLowerCase();
      return { path, name: words ? words[0].toUpperCase() + words.slice(1) : path };
    });
}
```

- [ ] **Step 4: Run tests**

Run: `npm --prefix frontend run test:unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/screens.ts frontend/src/lib/screens.test.ts
git commit -m "feat(frontend): list a project's phone screens in order with readable names"
```

### Task 4: Phone screens gallery, project page, chat preview and starter

**Files:**
- Create: `frontend/src/components/app/files/PhoneScreens.tsx`
- Modify: `frontend/src/app/w/[slug]/projects/[pid]/page.tsx` (header buttons, dialog)
- Modify: `frontend/src/components/app/files/ProjectPreview.tsx` (picker and body)
- Modify: `frontend/src/components/app/home/ChatHome.tsx` (`EXAMPLES`)
- Test: `frontend/e2e/mobile.spec.ts`

**Interfaces:**
- Consumes: `phoneScreens(paths)`, `PhoneScreen` from Task 3.
- Produces: `PhoneScreens({ base, screens, onAsk })` (inline gallery) and `PhoneScreensDialog({ base, screens, onClose })`, where `base` is the project API path (`wsPath('/projects/<id>')`) and `onAsk?: (path: string) => void`.

- [ ] **Step 1: Write the failing e2e test** — create `frontend/e2e/mobile.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";
import { newCompany } from "./setup";

const headers = { origin: "http://localhost:3100" };
const screen = (title: string) => `<!doctype html><html><head><title>${title}</title><meta name="viewport" content="width=390, initial-scale=1"></head><body><h1>${title} screen</h1></body></html>`;

async function project(page: Page, id: string, name: string, files: [string, string][]) {
  const res = await page.request.post(`/api/workspaces/${id}/projects`, { headers, data: { name } });
  expect(res.ok()).toBe(true);
  const pid = (await res.json()).id as string;
  for (const [path, content] of files) expect((await page.request.put(`/api/workspaces/${id}/projects/${pid}/files`, { headers, data: { path, content, baseRevision: 0 } })).ok()).toBe(true);
  return pid;
}

test("a project with app screens shows them in phone frames; a plain site doesn't offer them", async ({ page }) => {
  const c = await newCompany(page, { prefix: "Mobile", company: "Trail Club", template: /Just the head agent/ });
  const app = await project(page, c.id, "Trail app", [["screens/02-profile.html", screen("Profile")], ["screens/01-home.html", screen("Home")]]);
  const site = await project(page, c.id, "Plain site", [["index.html", "<h1>Hi</h1>"]]);

  await page.goto(`/w/${c.slug}/projects/${site}`);
  await expect(page.getByRole("heading", { name: "Plain site" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Phone screens" })).toHaveCount(0);

  await page.goto(`/w/${c.slug}/projects/${app}`);
  await page.getByRole("button", { name: "Phone screens" }).click();
  const gallery = page.getByRole("dialog", { name: "Phone screens" });
  await expect(gallery.getByRole("figure")).toHaveCount(2);
  await expect(gallery.getByRole("figure").nth(0)).toContainText("Home");
  await expect(gallery.getByRole("figure").nth(1)).toContainText("Profile");
  await expect(gallery.locator('iframe[title="Home screen"]')).toHaveAttribute("loading", "lazy");
  await expect(gallery.frameLocator('iframe[title="Home screen"]').getByRole("heading", { name: "Home screen" })).toBeVisible();
  await expect(gallery.getByRole("link", { name: "Download screens" })).toHaveAttribute("href", /download\.zip$/);
  await gallery.getByRole("button", { name: "Open Home full size" }).click();
  const full = page.getByRole("dialog", { name: "Home" });
  await expect(full.locator('iframe[title="Home screen, full size"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(full).toHaveCount(0);
  await expect(gallery).toBeVisible();
});

test("in chat, the preview opens on the screens and Ask for changes fills the message", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobileChat", company: "Quiz Club", template: /Just the head agent/ });
  await project(page, c.id, "Quiz app", [["index.html", "<h1>Site</h1>"], ["screens/01-home.html", screen("Home")]]);
  await page.goto(`/w/${c.slug}`);
  await page.getByRole("button", { name: "Preview" }).click();
  const panel = page.getByRole("region", { name: "Work preview" });
  await expect(panel.getByRole("figure")).toHaveCount(1);
  await expect(panel.getByLabel("Preview file")).toContainText("index.html");
  await panel.getByRole("button", { name: "Ask for changes to Home" }).click();
  await expect(page.getByLabel("Message Nova")).toHaveValue(/^Please update screens\/01-home\.html in Quiz app: /);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx playwright test e2e/mobile.spec.ts`
Expected: FAIL: no "Phone screens" button.

- [ ] **Step 3: Create `frontend/src/components/app/files/PhoneScreens.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadSimple, PencilLine, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { PhoneScreen } from "@/lib/screens";

const W = 390;
const H = 844;
const SCALE = 0.5;

/** The project's preview address up to its token, so every screen can share one link. */
function usePreviewPrefix(base: string, first: string | undefined) {
  const [prefix, setPrefix] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!first) return;
    let cancelled = false;
    api<{ url: string }>(`${base}/preview-token`, { method: "POST", body: { path: first } }).then(
      (r) => { if (!cancelled) setPrefix(`${r.url.split("/").slice(0, 4).join("/")}/`); },
      (e: Error) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [base, first]);
  return { prefix, error };
}

const src = (prefix: string, path: string) => prefix + path.split("/").map(encodeURIComponent).join("/");

function Phone({ url, title, scale }: { url: string; title: string; scale: number }) {
  return (
    <div style={{ width: W * scale, height: H * scale }} className="overflow-hidden rounded-[28px] border-[3px] border-[#1f2328] bg-white shadow-sm">
      <iframe src={url} title={title} loading="lazy" sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }} />
    </div>
  );
}

/** Every app screen side by side in a phone frame; click one for full size. */
export function PhoneScreens({ base, screens, onAsk }: { base: string; screens: PhoneScreen[]; onAsk?: (path: string) => void }) {
  const { prefix, error } = usePreviewPrefix(base, screens[0]?.path);
  const [open, setOpen] = useState<PhoneScreen | null>(null);
  if (error) return <p role="alert" className="p-4 text-sm">{error}</p>;
  if (!prefix) return <div className="studio-preview-loading" aria-busy="true" aria-label="Loading screens" />;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${W * SCALE}px, 1fr))` }}>
        {screens.map((s) => (
          <figure key={s.path} className="flex flex-col items-center gap-2">
            <figcaption className="text-sm font-semibold">{s.name}</figcaption>
            <button onClick={() => setOpen(s)} aria-label={`Open ${s.name} full size`} className="rounded-[30px]">
              <Phone url={src(prefix, s.path)} title={`${s.name} screen`} scale={SCALE} />
            </button>
            {onAsk && <button onClick={() => onAsk(s.path)} aria-label={`Ask for changes to ${s.name}`} className="studio-secondary text-xs"><PencilLine size={13} />Ask for changes</button>}
          </figure>
        ))}
      </div>
      <a href={`${base}/download.zip`} className="studio-secondary self-start"><DownloadSimple size={15} />Download screens</a>
      {open && <FullSize url={src(prefix, open.path)} name={open.name} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FullSize({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const scale = typeof window === "undefined" ? 1 : Math.min(1, (window.innerHeight - 120) / H);
  return (
    <dialog ref={dialog} aria-label={name} onClose={onClose} className="rounded-[16px] bg-paper p-4 backdrop:bg-black/50">
      <div className="mb-3 flex items-center justify-between gap-4"><h2 className="font-semibold">{name}</h2><button onClick={() => dialog.current?.close()} aria-label="Close" className="studio-icon-button"><X size={18} /></button></div>
      <Phone url={url} title={`${name} screen, full size`} scale={scale} />
    </dialog>
  );
}

/** The gallery in its own dialog, for the project page. */
export function PhoneScreensDialog({ base, screens, onClose }: { base: string; screens: PhoneScreen[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} aria-label="Phone screens" onClose={onClose} className="w-[min(1100px,95vw)] rounded-[16px] bg-paper p-0 backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-semibold">Phone screens</h2><button onClick={() => dialog.current?.close()} aria-label="Close" className="studio-icon-button"><X size={18} /></button></div>
      <PhoneScreens base={base} screens={screens} />
    </dialog>
  );
}
```

Note: Escape on the full-size dialog closes only that dialog (the browser closes the topmost modal); its `onClose` clears `open`, and the gallery dialog stays.

- [ ] **Step 4: Add "Phone screens" to the project page** — in `frontend/src/app/w/[slug]/projects/[pid]/page.tsx`:

Add imports:

```tsx
import { PhoneScreensDialog } from "@/components/app/files/PhoneScreens";
import { phoneScreens } from "@/lib/screens";
```

Next to `const [previewing, setPreviewing] = useState(false);` add:

```tsx
  const [showingScreens, setShowingScreens] = useState(false);
  const screens = phoneScreens(entries.filter((e) => e.kind === "file").map((e) => e.path));
```

Right before the `Preview` button's `{entries.some(...) && (` block, add:

```tsx
        {screens.length > 0 && (
          <button onClick={() => setShowingScreens(true)} className="btn-dark rounded-[10px] px-3 py-2 text-sm font-semibold">Phone screens</button>
        )}
```

Next to `{previewing && <PreviewDialog … />}` add:

```tsx
      {showingScreens && <PhoneScreensDialog base={base} screens={screens} onClose={() => setShowingScreens(false)} />}
```

- [ ] **Step 5: Open the chat preview on the screens** — in `frontend/src/components/app/files/ProjectPreview.tsx`:

Add imports `import { phoneScreens } from "@/lib/screens";` and `import { PhoneScreens } from "./PhoneScreens";`.

The chat's Preview button always passes a file (the project's cover), so the rule is: a project with screens opens on the gallery until the owner picks a file in the picker.

Next to the `picked` state add:

```tsx
  const [userPicked, setUserPicked] = useState(false);
```

After the `entries` effect, add:

```tsx
  const SCREENS = "__screens__";
  const screens = phoneScreens((entries ?? []).map((e) => e.path));
  const showScreens = screens.length > 0 && (!userPicked || picked === SCREENS);
```

Replace the line computing `path` with:

```tsx
  const path = showScreens ? undefined : entries?.some((e) => e.path === picked) ? picked : primary?.path;
```

In the toolbar `<select>`, change `value` and `onChange` to:

```tsx
value={showScreens ? SCREENS : (path ?? "")} onChange={(e) => { setPicked(e.target.value); setUserPicked(true); }}
```

and put this option before the file options:

```tsx
{screens.length > 0 && <option value={SCREENS}>Phone screens ({screens.length})</option>}
```

The footer's Download and Request changes buttons use `path`; with the gallery showing, `path` is undefined, so Download gives the project ZIP and Request changes asks about the whole project, as they do today for a project without a picked file.

In the body, before the `path ?` branch, add a branch:

```tsx
        : showScreens ? <PhoneScreens base={base} screens={screens} onAsk={onRequestChanges ? (p) => onRequestChanges(p) : undefined} />
```

- [ ] **Step 6: Add the chat starter** — in `frontend/src/components/app/home/ChatHome.tsx`, add `DeviceMobile` to the `@phosphor-icons/react` import and append to `EXAMPLES`:

```tsx
  { title: "Design a mobile app", prompt: "Design a mobile app for ", icon: <DeviceMobile size={19} /> },
```

- [ ] **Step 7: Run the e2e test, unit tests, typecheck and lint**

Run: `cd frontend && npx playwright test e2e/mobile.spec.ts && npm run test:unit && npx tsc --noEmit && npx eslint src/components/app/files/PhoneScreens.tsx src/components/app/files/ProjectPreview.tsx "src/app/w/[slug]/projects/[pid]/page.tsx" src/components/app/home/ChatHome.tsx src/lib/screens.ts`
Expected: 2 e2e tests pass; unit tests pass; no type or lint errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/app/files/PhoneScreens.tsx frontend/src/components/app/files/ProjectPreview.tsx "frontend/src/app/w/[slug]/projects/[pid]/page.tsx" frontend/src/components/app/home/ChatHome.tsx frontend/e2e/mobile.spec.ts
git commit -m "feat(frontend): phone screens gallery on the project page and in the chat preview; Design a mobile app starter"
```

### Task 5: Verify and ship

- [ ] **Step 1: Backend tests for the touched flow**

Run: `cd backend && npx vitest run test/mobile-unit.test.ts test/goal-mobile.test.ts test/quality-unit.test.ts test/quality-fixes.test.ts test/goal-reference.test.ts test/goals.test.ts`
Expected: all pass.

- [ ] **Step 2: Frontend production build and the existing e2e tests that touch the changed screens**

Run: `cd frontend && NEXT_DIST_DIR=.next-check npx next build && npx playwright test e2e/mobile.spec.ts e2e/projects.spec.ts e2e/studio.spec.ts`
Expected: build succeeds; tests pass.

- [ ] **Step 3: Manual check**

On the owner's Mac: in chat, "Design a mobile app for a hiking club" plans "The look and the screen list" first; after Start, `design/identity.md`, `design/screens.md` and `screens/*.html` appear; Phone screens shows them in phone frames.

- [ ] **Step 4: Merge and push**

Fast-forward `milestone-1` to `mobile-design` in the main working tree (stop and ask if uncommitted changes there touch the same files), then `git push origin milestone-1 milestone-1:main`.
