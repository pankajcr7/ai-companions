import { expect, test, type Page } from "@playwright/test";
import type { Snapshot, ChatMessageDTO } from "../src/lib/types";
import type { GoalDTO } from "../src/lib/goals";

const website = `<html><head><style>body{margin:0;background:#f4eee2;color:#34433a;font-family:Georgia;padding:65px}nav{font:14px Arial;letter-spacing:3px}h1{font-size:68px;max-width:640px;line-height:1.05;font-weight:400}p{font:18px/1.7 Arial;max-width:490px}button{background:#34433a;color:white;border:0;padding:15px 24px;border-radius:40px}.leaf{position:absolute;right:100px;top:200px;width:170px;height:260px;background:#aabc94;border-radius:100% 0 100% 0;transform:rotate(20deg)}</style></head><body><nav>ACORN / CREATIVE STUDIO</nav><h1>Good things<br>take a little care.</h1><p>Thoughtful spaces. Useful ideas. A small studio for work that makes a difference.</p><button>Explore our work</button><div class="leaf"></div></body></html>`;
const note = "# A thoughtful launch\n\nOur story starts with the people we help.\n\n## This week\n\n- Share the studio story\n- Publish the new website\n- Invite our first collaborators\n\n## A clear direction\n\nKeep the writing warm, useful, and direct.";

async function studio(page: Page) {
  const agent = { id: "nova", name: "Nova", role: "Head agent", kind: "ai" as const, workingStyle: "Helpful", status: "active" as const, isHead: true, departmentId: null, managerId: null, appearance: { style: "robot" as const, color: "#cedeb8", head: "square" as const, eyes: "visor" as const, accessory: "antenna" as const }, model: "test", connectionId: "service" };
  const snapshot: Snapshot = { workspace: { id: "demo", slug: "studio", name: "Acorn Studio", qualityChecks: true }, role: "owner", departments: [], agents: [agent, { ...agent, id: "mira", name: "Mira", role: "Designer", isHead: false, appearance: { ...agent.appearance, color: "#b7cddd", head: "round", accessory: "headset" } }], layout: { zones: [], desks: {} }, preferences: { theme: "light", reducedMotion: false, calmMode: false }, connections: [{ id: "service", kind: "custom", label: "Test", hint: "test", status: "connected" }] };
  const goal: GoalDTO = { id: "goal", text: "Build our studio website", status: "running", projectId: "acorn", parent: null, newProject: true, projectName: "Acorn website", summary: null, error: null, inputTokens: 0, outputTokens: 0, createdAt: "2026-10-11T09:00:00Z", working: ["mira"], edits: [], tasks: [{ id: "task", position: 0, agentId: "mira", agentName: "Mira", title: "Design the studio website", instructions: "Make a website", deliverable: "Website", criteria: [], dependsOn: [], status: "running", result: null, startedAt: new Date().toISOString(), finishedAt: null, filesRead: [], error: null, errorCode: null, verdict: null, verdictNote: null, rating: null, ratingReason: null, inputTokens: 0, outputTokens: 0 }] };
  const overview = (kind: "website" | "document", path: string, status: "done" | "running" | "awaiting_approval") => ({ cover: { kind, path, revision: 1 }, goal: { id: "goal", text: "Build our studio website", status, done: status === "done" ? 1 : 0, total: 1, pendingEdits: 0, agentIds: ["nova", "mira"] } });
  const projects = [
    { id: "acorn", name: "Acorn website", fileCount: 3, totalBytes: 12288, updatedAt: "2026-10-11T09:00:00Z", overview: overview("website", "index.html", "done") },
    { id: "notes", name: "A thoughtful launch", fileCount: 2, totalBytes: 3028, updatedAt: "2026-10-10T09:00:00Z", overview: overview("document", "launch.md", "awaiting_approval") },
    { id: "brand", name: "Our next chapter", fileCount: 1, totalBytes: 1298, updatedAt: "2026-10-09T09:00:00Z", overview: overview("document", "direction.md", "running") },
  ];
  const message: ChatMessageDTO = { id: "result", role: "assistant", content: "Mira is putting your studio website together.", status: "complete", model: null, inputTokens: null, outputTokens: null, errorCode: null, errorMessage: null, createdAt: "2026-10-11T09:00:00Z", goalId: "goal" };
  let sent = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/api/me") return json({ user: { id: "owner", name: "Avery", email: "avery@example.test" }, workspaces: [{ ...snapshot.workspace, role: "owner" }] });
    if (path === "/api/workspaces/demo") return json(snapshot);
    if (path.endsWith("/preferences")) { snapshot.preferences = req.postDataJSON(); return json({ ok: true }); }
    if (path === "/api/workspaces/demo/projects") return req.method() === "POST" ? json({ id: "created" }) : json({ projects });
    if (path.endsWith("/goals")) return json({ goals: [goal] });
    if (path.endsWith("/goals/goal")) return json({ goal });
    if (path.endsWith("/tree")) return json({ project: projects[0], entries: ["index.html", "notes.md"].map((p) => ({ path: p, kind: "file", size: 1000, isText: true, revision: 1, updatedAt: "2026-10-11T09:00:00Z" })), summary: null });
    if (path.endsWith("/files")) return json({ content: url.searchParams.get("path")?.endsWith(".html") ? website : note, revision: 1 });
    if (path.endsWith("/preview-token")) return json({ url: "/api/preview/test/index.html" });
    if (path.startsWith("/api/preview/")) return route.fulfill({ contentType: "text/html", body: website });
    if (path.endsWith("/download.zip")) return route.fulfill({ contentType: "application/zip", headers: { "content-disposition": 'attachment; filename="Acorn.zip"' }, body: "fixture" });
    if (path.endsWith("/conversations")) return json({ conversations: [{ id: "empty", title: "New chat", updatedAt: "2026-10-11" }, { id: "work", title: "Our studio website", updatedAt: "2026-10-10" }] });
    if (/\/conversations\/[^/]+\/messages$/.test(path)) { sent++; return route.fulfill({ contentType: "text/event-stream", body: "event: done\ndata: {}\n\n" }); }
    if (path.endsWith("/conversations/work")) return json({ messages: [message] });
    if (path.includes("/conversations/")) return json({ messages: [] });
    return json({});
  });
  await page.goto("/w/studio");
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
  return { sent: () => sent, finish: () => { goal.status = "done"; goal.working = []; goal.tasks[0].status = "done"; goal.summary = "Your studio website is ready to explore."; goal.edits = [{ id: "output", taskId: "task", path: "index.html", baseRevision: 0, note: "Website", status: "applied", reason: null }]; } };
}

async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

test("studio gallery shows real covers, filters, and project creation", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await studio(page);
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ideas, brought to life." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(page.frameLocator('iframe[title="Thumbnail of Acorn website"]').getByRole("heading")).toContainText("Good things");
  await expect(page.frameLocator('iframe[title="Thumbnail of Acorn website"]').getByRole("heading")).toBeVisible();
  await page.screenshot({ path: info.outputPath("projects-desktop.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Needs review", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("A thoughtful launch");
  await page.getByRole("button", { name: "All projects" }).click();
  await page.getByRole("button", { name: "Preview Acorn website", exact: true }).click();
  await expect(page.frameLocator('iframe[title="Preview of Acorn website"]').getByRole("heading")).toContainText("Good things");
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill("A new idea");
  await expect(page.getByRole("button", { name: "Create project" })).toBeEnabled();
  await page.getByRole("button", { name: "Cancel new project" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await fits(page);
  await page.screenshot({ path: info.outputPath("projects-mobile.png"), fullPage: true, animations: "disabled" });
});

test("studio preview stays beside chat and switches cleanly on phones", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const model = await studio(page);
  await page.getByText("Continue where you left off", { exact: true }).click();
  await expect(page.getByText("LATEST PROJECT")).toBeVisible();
  await page.getByText("Continue where you left off", { exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const preview = page.getByRole("region", { name: "Work preview" });
  await expect(preview).toBeVisible();
  await expect(page.getByLabel("Message Nova")).toBeInViewport();
  await page.screenshot({ path: info.outputPath("chat-preview-desktop.png"), fullPage: true, animations: "disabled" });
  await preview.getByLabel("Preview file").selectOption("notes.md");
  await expect(preview.getByRole("heading", { name: "A thoughtful launch" })).toBeVisible();
  await preview.getByRole("button", { name: "Request changes" }).click();
  await expect(page.getByLabel("Message Nova")).toHaveValue("Please update notes.md in Acorn website: ");
  expect(model.sent()).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("group", { name: "Chat workspace view" }).getByRole("button", { name: "Preview" }).click();
  await expect(preview).toBeVisible();
  await expect(page.getByLabel("Message Nova")).not.toBeVisible();
  await fits(page);
  await page.screenshot({ path: info.outputPath("chat-preview-mobile.png"), fullPage: true, animations: "disabled" });
  await preview.getByRole("button", { name: "Request changes" }).click();
  await expect(page.getByLabel("Message Nova")).toBeVisible();
  await expect(preview).not.toBeVisible();
});

test("studio appearance and focus persist without losing navigation", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await studio(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make yourself at home." });
  await dialog.getByRole("radio", { name: "Warm", exact: true }).check();
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-warm", "true");
  await dialog.getByRole("button", { name: "Blue", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /Celebrate finished work/ }).uncheck();
  await page.screenshot({ path: info.outputPath("appearance-warm.png"), fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "Close appearance" }).click();
  await page.reload();
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-warm", "true");
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-accent", "blue");
  await page.getByRole("button", { name: "Enter focus mode" }).click();
  await expect(page.getByRole("navigation", { name: "App" })).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Exit focus" }).click();
  await expect(page.getByRole("navigation", { name: "App" })).toBeVisible();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: /Celebrate finished work/ })).not.toBeChecked();
  await dialog.getByRole("radio", { name: "Dark", exact: true }).check();
  await expect(page.locator(".workspace-shell")).toHaveAttribute("data-theme", "dark");
  await dialog.getByRole("button", { name: "Close appearance" }).click();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ideas, brought to life." })).toBeVisible();
  await page.screenshot({ path: info.outputPath("projects-dark.png"), fullPage: true, animations: "disabled" });
});

test("studio celebrates a live completion once and previews its result", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const model = await studio(page);
  await page.getByRole("button", { name: "Our studio website", exact: true }).click();
  const goal = page.getByRole("group", { name: "Goal: Build our studio website" });
  await expect(goal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  model.finish();
  await expect(goal.getByText("Your work is ready.")).toBeVisible();
  await expect(goal.locator(".studio-confetti")).toBeVisible();
  await expect(goal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  await goal.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByRole("region", { name: "Work preview" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Our studio website", exact: true }).click();
  await expect(goal.getByText("Your work is ready.")).toBeVisible();
  await expect(goal.locator(".studio-confetti")).toHaveCount(0);
});

test("studio office shows the selected companion's real task", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await studio(page);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  const desk = page.getByRole("button", { name: /Mira, Designer, Working on: Design the studio website/ });
  await desk.focus();
  await expect(page.locator(".office-agent-info")).toContainText("Design the studio website");
  await page.screenshot({ path: info.outputPath("office-personality.png"), fullPage: true, animations: "disabled" });
});
