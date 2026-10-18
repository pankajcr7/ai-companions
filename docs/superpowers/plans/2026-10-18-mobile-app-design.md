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

Merging and pushing happen in Task 9, after part 1b.


---

## Part 1b: the Mobile App page (spec section 5)

### Task 6: Backend support for the page

**Files:**
- Modify: `backend/src/routes/goals.ts` (`POST /goals` body and `createGoal` call; `GET /goals` select and response)
- Modify: `backend/src/routes/projects.ts` (overview mapping)
- Test: `backend/test/mobile-page-api.test.ts`

**Interfaces:**
- Consumes: `isMobileDesign` (Task 1); `ownAttachments(workspaceId, userId, ids)` from `../attachments/service.js`.
- Produces: `POST /goals` accepts `attachmentIds?: string[]` (max 4); `GET /goals` items gain `parentGoalId: string | null` and `mobile: boolean`; project overview gains `screens: number`.

- [ ] **Step 1: Write the failing test** — create `backend/test/mobile-page-api.test.ts`:

```ts
import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, signUp } from "./helpers.js";
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
type Co = Awaited<ReturnType<typeof company>>;

async function attach(co: { id: string; cookie: string }, name: string) {
  const boundary = "----b" + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${name}"\r\ncontent-type: application/octet-stream\r\n\r\n`), PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const res = await app.inject({ method: "POST", url: `/api/workspaces/${co.id}/attachments`, payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: co.cookie, origin: "http://localhost:3000" } });
  return res.json().id as string;
}
const planned = (co: Co) =>
  llm.setScript((s) => (isPlan(s) ? fence({ projectName: "Trail", tasks: [{ agentId: co.others[0].id, title: "The look and the screen list", instructions: "i", deliverable: "d", criteria: ["c"], dependsOn: [] }] }) : "ok"));

test("a goal made with a screenshot links it before planning; someone else's screenshot is refused", async () => {
  const co = await company(app, llm);
  planned(co);
  const shot = await attach(co, "inspiration.png");
  const res = await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Design a mobile app: hiking trails", newProject: true, attachmentIds: [shot] });
  expect(res.statusCode).toBe(201);
  const gid = res.json().id as string;
  await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${gid}`)).json().goal, (g) => g.status === "awaiting_approval");
  expect((await prisma.attachment.findUniqueOrThrow({ where: { id: shot } })).goalId).toBe(gid);
  const plan = llm.requests.filter((q) => q.path === "/v1/chat/completions" && isPlan(systemOf(q))).at(-1)!;
  expect(userOf(plan)).toContain("attachments/inspiration.png");

  const other = await signUp(app);
  const oid = (await client(app, other.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: co.id, userId: oid, role: "member" } });
  const theirs = await attach({ id: co.id, cookie: other.cookie }, "theirs.png");
  await co.req("POST", `/api/workspaces/${co.id}/goals/${gid}/cancel`);
  expect((await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Design a mobile app: quiz", newProject: true, attachmentIds: [theirs] })).statusCode).toBe(404);
});

test("the goals list says which goals are app designs and which follow another; the overview counts screens", async () => {
  const co = await company(app, llm);
  planned(co);
  const pid = (await co.req("POST", `/api/workspaces/${co.id}/projects`, { name: "Trail" })).json().id as string;
  for (const path of ["screens/01-home.html", "screens/02-map.html", "screens/old/x.html", "index.html", "screens/notes.md"]) {
    await co.req("PUT", `/api/workspaces/${co.id}/projects/${pid}/files`, { path, content: "<p>x</p>", baseRevision: 0 });
  }
  const first = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Design a mobile app: trails", projectId: pid })).json().id as string;
  await waitFor(async () => (await co.req("GET", `/api/workspaces/${co.id}/goals/${first}`)).json().goal, (g) => g.status === "awaiting_approval");
  await co.req("POST", `/api/workspaces/${co.id}/goals/${first}/cancel`);
  const second = (await co.req("POST", `/api/workspaces/${co.id}/goals`, { text: "Write a welcome note", projectId: pid, parentGoalId: first })).json().id as string;
  const goals = (await co.req("GET", `/api/workspaces/${co.id}/goals`)).json().goals as { id: string; mobile: boolean; parentGoalId: string | null }[];
  expect(goals.find((g) => g.id === first)).toMatchObject({ mobile: true, parentGoalId: null });
  expect(goals.find((g) => g.id === second)).toMatchObject({ mobile: false, parentGoalId: first });
  const projects = (await co.req("GET", `/api/workspaces/${co.id}/projects?overview=1`)).json().projects as { id: string; overview: { screens: number } }[];
  expect(projects.find((p) => p.id === pid)!.overview.screens).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/mobile-page-api.test.ts`
Expected: both tests FAIL (the attachment isn't linked: `goalId` is `null`; `mobile` is undefined; `screens` is undefined).

- [ ] **Step 3: Accept screenshots when creating a goal** — in `backend/src/routes/goals.ts`:

Import `ownAttachments` (add it to the existing `../attachments/service.js` import, or add `import { ownAttachments } from "../attachments/service.js";`) and `import { isMobileDesign } from "../goals/mobile.js";`.

In the `POST /api/workspaces/:id/goals` handler, add `attachmentIds: z.array(z.string().min(1).max(64)).max(4).default([])` to the body schema, and replace the `createGoal` call with:

```ts
    // The owner's files for this goal (a screenshot to match, from the Mobile App page): theirs, not yet sent anywhere.
    const atts = await ownAttachments(id, user.id, body.attachmentIds);
    const { id: goalId } = await createGoal({
      workspaceId: id,
      userId: user.id,
      text: body.text,
      projectId: body.projectId,
      parentGoalId: body.parentGoalId,
      newProject: body.newProject,
      log: (e) => req.log.error(e),
      beforePlan: atts.length ? async (gid) => void (await prisma.attachment.updateMany({ where: { id: { in: atts.map((a) => a.id) } }, data: { goalId: gid } })) : undefined,
    });
```

- [ ] **Step 4: Say which goals are app designs** — in the `GET /api/workspaces/:id/goals` handler, add `parentGoalId: true` to the `select` and return:

```ts
    return { goals: goals.map((g) => ({ ...g, mobile: isMobileDesign(g.text) })) };
```

- [ ] **Step 5: Count screens in the overview** — in `backend/src/routes/projects.ts`, in the overview object add `screens` next to `cover`:

```ts
overview: { cover: projectCover(p.entries), screens: p.entries.filter((e) => /^screens\/[^/]+\.html?$/i.test(e.path)).length, goal: …unchanged… }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `cd backend && npx vitest run test/mobile-page-api.test.ts && npm run typecheck`
Expected: both tests pass; no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/goals.ts backend/src/routes/projects.ts backend/test/mobile-page-api.test.ts
git commit -m "feat(backend): goals can carry a screenshot; goals list marks app designs and follow-ups; overview counts screens"
```

### Task 7: Sidebar item and the Mobile App start page

**Files:**
- Create: `frontend/src/lib/mobile.ts`, `frontend/src/lib/mobile.test.ts`
- Create: `frontend/src/app/w/[slug]/mobile/page.tsx`
- Modify: `frontend/src/components/app/AppShell.tsx` (nav list)
- Test: `frontend/e2e/mobile-page.spec.ts` (first test)

**Interfaces:**
- Consumes: `POST /goals` with `attachmentIds`, `GET /goals` (`mobile`, `parentGoalId`), overview `screens` (Task 6); `useAttachments(path)` from `@/components/app/chat/AttachmentPicker` (`{ items, add, remove, uploading, ids }`).
- Produces: `APP_PREFIX = "Design a mobile app: "`, `CHANGES_PREFIX = "Mobile app design changes: "`, `appName(text: string): string`, `appStatus(status: string): string`, `isActive(status: string): boolean` from `@/lib/mobile`.

- [ ] **Step 1: Write the failing unit test** — create `frontend/src/lib/mobile.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { appName, appStatus, isActive } from "./mobile.ts";

test("app names drop the request prefix and stay short; statuses read plainly", () => {
  assert.equal(appName("Design a mobile app: A hiking trails app"), "A hiking trails app");
  assert.equal(appName("Make an iOS app for my bakery"), "Make an iOS app for my bakery");
  assert.equal(appName(`Design a mobile app: ${"x".repeat(80)}`), `${"x".repeat(57)}...`);
  assert.deepEqual(["planning", "awaiting_approval", "running", "reviewing", "done", "failed", "cancelled"].map(appStatus), ["Planning", "Ready to start", "Working", "Working", "Done", "Needs a fix", "Stopped"]);
  assert.deepEqual(["planning", "awaiting_approval", "running", "reviewing", "done", "failed", "cancelled"].map(isActive), [true, true, true, true, false, false, false]);
});
```

- [ ] **Step 2: Write the failing e2e test** — create `frontend/e2e/mobile-page.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("the sidebar's Mobile App starts an app design and lists it", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobilePage", company: "Trail Club", template: /Just the head agent/ });
  await connectFakeLLM(page, c.id);
  await page.getByRole("link", { name: "Mobile App" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${c.slug}/mobile$`));
  await expect(page.getByRole("heading", { name: "Mobile App" })).toBeVisible();
  await expect(page.getByText("Your app designs will appear here.")).toBeVisible();
  await page.getByRole("button", { name: "Hiking trails" }).click();
  await expect(page.getByLabel("Describe your app, or paste your spec")).toHaveValue("A hiking trails app: saved trails, a trail map and a trip log");
  await page.getByRole("button", { name: "Design it" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${c.slug}/mobile/[^/]+$`));
  await expect(page.getByRole("heading", { name: "A hiking trails app: saved trails, a trail map and a trip log" })).toBeVisible();
  await page.getByRole("link", { name: "Mobile App" }).click();
  await expect(page.getByRole("link", { name: /A hiking trails app/ })).toBeVisible();
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm --prefix frontend run test:unit` → FAIL, "Cannot find module … mobile.ts".
Run: `cd frontend && npx playwright test e2e/mobile-page.spec.ts` → FAIL, no "Mobile App" link.

- [ ] **Step 4: Create `frontend/src/lib/mobile.ts`**

```ts
export const APP_PREFIX = "Design a mobile app: ";
export const CHANGES_PREFIX = "Mobile app design changes: ";

/** The app's name: the request without "Design a mobile app: ", at most 60 characters. */
export function appName(text: string): string {
  const name = text.startsWith(APP_PREFIX) ? text.slice(APP_PREFIX.length) : text;
  return name.length > 60 ? `${name.slice(0, 57)}...` : name;
}

const STATUS: Record<string, string> = { planning: "Planning", awaiting_approval: "Ready to start", running: "Working", reviewing: "Working", done: "Done", failed: "Needs a fix", cancelled: "Stopped" };
export const appStatus = (status: string) => STATUS[status] ?? status;
export const isActive = (status: string) => ["planning", "awaiting_approval", "running", "reviewing"].includes(status);
```

- [ ] **Step 5: Add the sidebar item** — in `frontend/src/components/app/AppShell.tsx`, add `DeviceMobile` to the `@phosphor-icons/react` import and, right after the Chat entry in the nav list, add:

```ts
    { href: `${base}/mobile`, label: "Mobile App", icon: DeviceMobile },
```

The nav's active rule (`href === base ? isChat : pathname.startsWith(href)`) already marks it current on `/mobile` and `/mobile/<id>`.

- [ ] **Step 6: Create the start page** — `frontend/src/app/w/[slug]/mobile/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DeviceMobile, ImageSquare, PaperPlaneRight, X } from "@phosphor-icons/react";
import { useAttachments } from "@/components/app/chat/AttachmentPicker";
import { api, ApiError } from "@/lib/api";
import { APP_PREFIX, appName, appStatus } from "@/lib/mobile";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

type GoalRow = { id: string; text: string; status: string; projectId: string | null; parentGoalId: string | null; mobile: boolean };
type ProjectRow = { id: string; overview?: { screens?: number } };

const EXAMPLES = [
  { label: "Hiking trails", text: "A hiking trails app: saved trails, a trail map and a trip log" },
  { label: "Cycle tracker", text: "A cycle tracker app: rides, weekly goals and a ride map" },
  { label: "Recipe planner", text: "A recipe planner app: weekly meal plan, recipes and a shopping list" },
];
const BUSY = "Your team is busy with another goal. Try again when it finishes.";

export default function MobileAppPage() {
  const { snapshot, wsPath } = useWorkspace();
  const router = useRouter();
  const editable = canEdit(snapshot.role);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [apps, setApps] = useState<{ goal: GoalRow; screens: number | null }[] | null>(null);
  const att = useAttachments(editable ? wsPath("/attachments") : undefined);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([api<{ goals: GoalRow[] }>(wsPath("/goals")), api<{ projects: ProjectRow[] }>(wsPath("/projects?overview=1"))]).then(([g, p]) => {
      const screens = new Map(p.projects.map((x) => [x.id, x.overview?.screens ?? 0]));
      setApps(g.goals.filter((x) => x.mobile && !x.parentGoalId).map((goal) => ({ goal, screens: goal.projectId ? (screens.get(goal.projectId) ?? 0) : null })));
    }, (e: Error) => setError(e.message));
  }, [wsPath]);

  async function design() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string }>(wsPath("/goals"), { method: "POST", body: { text: `${APP_PREFIX}${text.trim()}`, newProject: true, attachmentIds: att.ids } });
      router.push(`/w/${snapshot.workspace.slug}/mobile/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? BUSY : (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Mobile App</h1>
        <p className="mt-1 text-muted">Make your app look designed.</p>
      </header>
      {editable && (
        <section aria-label="Design a new app" className="rounded-[16px] border border-line bg-paper p-4">
          <label htmlFor="mobile-brief" className="sr-only">Describe your app, or paste your spec</label>
          <textarea id="mobile-brief" aria-label="Describe your app, or paste your spec" value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe your app, or paste your spec" rows={4} maxLength={3900} className="w-full resize-y rounded-[10px] bg-bg p-3 text-base" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { att.items.forEach((i) => att.remove(i.key)); att.add([f]); } e.target.value = ""; }} />
            <button onClick={() => file.current?.click()} className="studio-secondary"><ImageSquare size={16} />Add screenshot</button>
            {att.items.map((i) => <span key={i.key} className="flex items-center gap-1 rounded-full bg-bg px-3 py-1 text-sm">{i.name}{i.status === "uploading" ? " (uploading…)" : i.status === "error" ? ` (${i.error})` : ""}<button aria-label={`Remove ${i.name}`} onClick={() => att.remove(i.key)}><X size={13} /></button></span>)}
            <button onClick={design} disabled={!text.trim() || att.uploading || busy} className="studio-primary ml-auto"><PaperPlaneRight size={16} />Design it</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{EXAMPLES.map((x) => <button key={x.label} onClick={() => setText(x.text)} className="rounded-full border border-line px-3 py-1 text-sm">{x.label}</button>)}</div>
        </section>
      )}
      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
      <section aria-label="Your apps">
        <h2 className="mb-3 font-semibold">Your apps</h2>
        {!apps ? <p className="text-sm text-muted">Loading…</p> : !apps.length ? <p className="text-sm text-muted">Your app designs will appear here.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map(({ goal, screens }) => (
              <li key={goal.id}>
                <Link href={`/w/${snapshot.workspace.slug}/mobile/${goal.id}`} className="flex items-center gap-3 rounded-[14px] border border-line bg-paper p-3 hover:bg-bg">
                  <DeviceMobile size={28} />
                  <span className="min-w-0"><span className="block truncate font-semibold">{appName(goal.text)}</span><span className="text-sm text-muted">{appStatus(goal.status)}{screens ? ` · ${screens} screen${screens === 1 ? "" : "s"}` : ""}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

`canEdit` comes from `@/lib/types` and failed requests throw `ApiError` with the HTTP `status` (`frontend/src/lib/api.ts`); the team being busy is a 409.

- [ ] **Step 7: Run the unit test and the e2e test's first part**

Run: `npm --prefix frontend run test:unit` → PASS.
Run: `cd frontend && npx playwright test e2e/mobile-page.spec.ts` → still FAILS at the app page heading (Task 8 builds that page); every step before it passes.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/mobile.ts frontend/src/lib/mobile.test.ts "frontend/src/app/w/[slug]/mobile/page.tsx" frontend/src/components/app/AppShell.tsx frontend/e2e/mobile-page.spec.ts
git commit -m "feat(frontend): Mobile App in the sidebar — describe an app, add a screenshot, Design it; your apps"
```

### Task 8: The app page

**Files:**
- Create: `frontend/src/app/w/[slug]/mobile/[goalId]/page.tsx`
- Modify: `frontend/e2e/mobile-page.spec.ts` (second test)

**Interfaces:**
- Consumes: `appName`, `isActive`, `CHANGES_PREFIX` (Task 7); the busy message is repeated as a constant (Next.js pages can't export extra values); `GoalCard({ goalId, onStatus })`; `PhoneScreens({ base, screens, onAsk })` and `phoneScreens(paths)` (Tasks 3–4); `GET /goals/:id` (`goal.text`, `goal.projectId`, `goal.status`), `GET /goals` (`projectId`, `parentGoalId`), `GET /projects/:pid/tree`.

- [ ] **Step 1: Add the failing e2e test** — append to `frontend/e2e/mobile-page.spec.ts`:

```ts
const headers = { origin: "http://localhost:3100" };
const screen = (title: string) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title} screen</h1></body></html>`;

test("an app page shows the plan, its phone screens, and Ask for changes makes a follow-up", async ({ page }) => {
  const c = await newCompany(page, { prefix: "MobileApp", company: "Quiz Club", template: /Just the head agent/ });
  await connectFakeLLM(page, c.id);
  const pid = (await (await page.request.post(`/api/workspaces/${c.id}/projects`, { headers, data: { name: "Quiz app" } })).json()).id as string;
  await page.request.put(`/api/workspaces/${c.id}/projects/${pid}/files`, { headers, data: { path: "screens/01-home.html", content: screen("Home"), baseRevision: 0 } });
  const gid = (await (await page.request.post(`/api/workspaces/${c.id}/goals`, { headers, data: { text: "Design a mobile app: A quiz app", projectId: pid } })).json()).id as string;
  await page.goto(`/w/${c.slug}/mobile/${gid}`);
  await expect(page.getByRole("heading", { name: "A quiz app" })).toBeVisible();
  await expect(page.getByRole("figure")).toHaveCount(1);
  await expect(page.getByText(/Ready to start|Planning/).first()).toBeVisible();
  await page.request.post(`/api/workspaces/${c.id}/goals/${gid}/cancel`, { headers });
  await page.getByLabel("What should change?").fill("Bigger title on the Home screen");
  await page.getByRole("button", { name: "Send changes" }).click();
  await expect.poll(async () => {
    const goals = (await (await page.request.get(`/api/workspaces/${c.id}/goals`)).json()).goals as { text: string; parentGoalId: string | null }[];
    return goals.find((g) => g.parentGoalId === gid)?.text ?? "";
  }).toBe("Mobile app design changes: Bigger title on the Home screen");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx playwright test e2e/mobile-page.spec.ts`
Expected: both tests FAIL at the app page (no heading).

- [ ] **Step 3: Create the app page** — `frontend/src/app/w/[slug]/mobile/[goalId]/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GoalCard } from "@/components/app/goals/GoalCard";
import { PhoneScreens } from "@/components/app/files/PhoneScreens";
import { api, ApiError } from "@/lib/api";
import { appName, CHANGES_PREFIX, isActive } from "@/lib/mobile";
import type { TreeEntry } from "@/lib/projects";
import { canEdit } from "@/lib/types";
import { phoneScreens } from "@/lib/screens";
import { useWorkspace } from "@/lib/workspace";

const BUSY = "Your team is busy with another goal. Try again when it finishes.";
type GoalRow = { id: string; text: string; status: string; projectId: string | null; parentGoalId: string | null; createdAt: string };

export default function MobileAppDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { snapshot, wsPath } = useWorkspace();
  const editable = canEdit(snapshot.role);
  const [root, setRoot] = useState<GoalRow | null>(null);
  const [current, setCurrent] = useState<GoalRow | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [ask, setAsk] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  // The app: the given goal, its project, and the newest goal on that project.
  const load = useCallback(async () => {
    const goal = (await api<{ goal: GoalRow }>(wsPath(`/goals/${goalId}`))).goal;
    const all = (await api<{ goals: GoalRow[] }>(wsPath("/goals"))).goals;
    const newest = goal.projectId ? all.find((g) => g.projectId === goal.projectId) ?? goal : goal;
    setRoot(goal);
    setCurrent(newest);
    if (goal.projectId) setPaths((await api<{ entries: TreeEntry[] }>(wsPath(`/projects/${goal.projectId}/tree`))).entries.filter((e) => e.kind === "file").map((e) => e.path));
  }, [goalId, wsPath]);

  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load, tick]);
  // Refresh while the team works on it.
  useEffect(() => {
    if (!current || !isActive(current.status)) return;
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [current]);

  async function sendChanges() {
    if (!root?.projectId || !current) return;
    setError("");
    try {
      await api(wsPath("/goals"), { method: "POST", body: { text: `${CHANGES_PREFIX}${ask.trim()}`, projectId: root.projectId, parentGoalId: current.id } });
      setAsk("");
      setTick((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? BUSY : (e as Error).message);
    }
  }

  const screens = phoneScreens(paths);
  if (!root) return <p className="p-6 text-sm text-muted">{error || "Loading…"}</p>;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
      <Link href={`/w/${snapshot.workspace.slug}/mobile`} className="text-sm text-muted hover:underline">← Mobile App</Link>
      <h1 className="text-xl font-semibold">{appName(root.text)}</h1>
      {current && <GoalCard key={current.id} goalId={current.id} onStatus={(g) => setCurrent((c) => (c && c.status !== g.status ? { ...c, status: g.status } : c))} />}
      <section aria-label="Phone screens" className="rounded-[16px] border border-line bg-paper">
        {root.projectId && screens.length ? <PhoneScreens base={wsPath(`/projects/${root.projectId}`)} screens={screens} /> : <p className="p-4 text-sm text-muted">Screens will appear here as the team draws them.</p>}
      </section>
      {editable && root.projectId && (
        <section aria-label="Ask for changes" className="flex flex-col gap-2">
          <label htmlFor="mobile-changes" className="font-semibold">What should change?</label>
          <textarea id="mobile-changes" value={ask} onChange={(e) => setAsk(e.target.value)} rows={3} maxLength={3900} className="rounded-[10px] border border-line bg-paper p-3" />
          <button onClick={sendChanges} disabled={!ask.trim()} className="studio-primary self-start">Send changes</button>
        </section>
      )}
      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
    </div>
  );
}
```

`GoalCard`'s `onStatus` receives the goal DTO (with `status`); `GET /goals/:id` returns `{ goal }` with `text`, `status` and `projectId`.

- [ ] **Step 4: Run the e2e tests, unit tests, typecheck and lint**

Run: `cd frontend && npx playwright test e2e/mobile-page.spec.ts e2e/mobile.spec.ts && npm run test:unit && npx tsc --noEmit && npx eslint "src/app/w/[slug]/mobile" src/lib/mobile.ts src/components/app/AppShell.tsx`
Expected: 4 e2e tests pass; unit tests pass; no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/w/[slug]/mobile/[goalId]/page.tsx" frontend/e2e/mobile-page.spec.ts
git commit -m "feat(frontend): app page — plan card, live phone screens, Ask for changes as a follow-up goal"
```

### Task 9: Verify everything and ship

- [ ] **Step 1: Backend tests for both parts**

Run: `cd backend && npx vitest run test/mobile-unit.test.ts test/goal-mobile.test.ts test/mobile-page-api.test.ts test/quality-unit.test.ts test/quality-fixes.test.ts test/goal-reference.test.ts test/goals.test.ts test/conversations.test.ts`
Expected: all pass.

- [ ] **Step 2: Frontend build and browser tests**

Run: `cd frontend && NEXT_DIST_DIR=.next-check npx next build && npx playwright test e2e/mobile.spec.ts e2e/mobile-page.spec.ts e2e/projects.spec.ts e2e/studio.spec.ts e2e/goals.spec.ts`
Expected: build succeeds; tests pass.

- [ ] **Step 3: Merge and push**

Fast-forward `milestone-1` to `mobile-design` in the main working tree (stop and ask if uncommitted changes there touch the same files), then `git push origin milestone-1 milestone-1:main`.
