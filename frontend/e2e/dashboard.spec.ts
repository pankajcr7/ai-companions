import { expect, test, type Page } from "@playwright/test";
import type { ChatMessageDTO, Snapshot } from "../src/lib/types";

async function workspace(page: Page, options: { setup?: boolean; viewer?: boolean; dark?: boolean } = {}) {
  const snapshot: Snapshot = {
    workspace: { id: "demo", slug: "studio", name: "Acorn Studio", qualityChecks: true },
    role: options.viewer ? "viewer" : "owner",
    departments: [],
    agents: [{ id: "nova", name: "Nova", role: "Head agent", kind: "ai", workingStyle: "Helpful", status: "active", isHead: true, departmentId: null, managerId: null, appearance: { style: "robot", color: "#cedeb8", head: "square", eyes: "visor", accessory: "antenna" }, model: options.setup ? null : "test-model", connectionId: options.setup ? null : "service" }],
    layout: { zones: [], desks: {} },
    preferences: { theme: options.dark ? "dark" : "light", reducedMotion: true, calmMode: false },
    connections: options.setup ? [] : [{ id: "service", kind: "custom", label: "Test service", hint: "test", status: "connected" }],
  };
  let conversations = [
    { id: "new", title: "New chat", updatedAt: "2026-10-09T12:00:00Z" },
    { id: "launch", title: "Ideas for our next launch", updatedAt: "2026-10-08T12:00:00Z" },
    { id: "website", title: "A website for Acorn Studio", updatedAt: "2026-10-07T12:00:00Z" },
  ];
  const messages: Record<string, ChatMessageDTO[]> = { new: [] };
  const sent: Record<string, unknown>[] = [];
  let counter = 0;
  const message = (id: string, role: "user" | "assistant", content: string): ChatMessageDTO => ({ id, role, content, status: "complete", model: "test-model", inputTokens: 10, outputTokens: 10, errorCode: null, errorMessage: null, createdAt: "2026-10-09T12:00:00Z" });
  messages.launch = [message("past-1", "user", "Help me plan our next launch."), message("past-2", "assistant", "Let’s start with your audience and what makes your product useful.")];
  messages.website = [message("past-3", "user", "I need a website for my studio.")];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === "/api/me") return json({ user: { id: "owner", name: "Avery", email: "avery@example.test" }, workspaces: [{ ...snapshot.workspace, role: snapshot.role }] });
    if (path === "/api/workspaces/demo") return json(snapshot);
    if (path === "/api/workspaces/demo/projects") return json({ projects: [{ id: "acorn", name: "Acorn website" }] });
    if (path === "/api/workspaces/demo/attachments") return json({ id: "attachment-1", name: "brief.txt", kind: "text", mime: "text/plain", size: 12, pages: null, scanned: false, url: "/brief.txt", viewUrl: "/brief.txt" });
    if (path === "/api/workspaces/demo/conversations") {
      if (method === "POST") {
        const id = `chat-${++counter}`;
        conversations.unshift({ id, title: "New chat", updatedAt: "2026-10-09T13:00:00Z" });
        messages[id] = [];
        return json({ id });
      }
      return json({ conversations });
    }
    const match = path.match(/\/conversations\/([^/]+)(\/messages)?$/);
    if (match) {
      const id = match[1];
      if (method === "PATCH") {
        const body = request.postDataJSON();
        conversations = conversations.map((c) => c.id === id ? { ...c, title: body.title } : c);
        return json({ ok: true });
      }
      if (method === "DELETE") { conversations = conversations.filter((c) => c.id !== id); return json({ ok: true }); }
      if (method === "POST") {
        const body = request.postDataJSON();
        sent.push(body);
        messages[id] = [...(messages[id] ?? []), message(`u-${sent.length}`, "user", body.message), message(`a-${sent.length}`, "assistant", "I can help with that. Let’s turn your idea into a clear next step.")];
        conversations = conversations.map((c) => c.id === id ? { ...c, title: body.message.slice(0, 60) } : c);
        return route.fulfill({ contentType: "text/event-stream", body: 'event: delta\ndata: {"text":"I can help with that. Let’s turn your idea into a clear next step."}\n\nevent: done\ndata: {}\n\n' });
      }
      return json({ messages: messages[id] ?? [] });
    }
    return json({});
  });
  await page.goto("/w/studio");
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
  return { sent };
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("desktop: one sidebar, starter prompts, attachments, projects and a working conversation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { sent } = await workspace(page);
  await expect(page.getByRole("navigation", { name: "Conversations" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(page.getByRole("list", { name: "Your team" })).not.toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("desktop-welcome.png"), fullPage: true });
  await page.getByRole("button", { name: "Build a website" }).click();
  await expect(page.getByLabel("Message Nova")).toHaveValue("Build a landing page for my bakery");
  await expect(page.getByLabel("Message Nova")).toBeFocused();
  await page.getByLabel("Working on").selectOption("acorn");
  await page.getByLabel("Attach files").setInputFiles({ name: "brief.txt", mimeType: "text/plain", buffer: Buffer.from("Project brief") });
  await expect(page.getByRole("list", { name: "Attachments", exact: true })).toContainText("brief.txt");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("I can help with that.");
  expect(sent).toEqual([{ message: "Build a landing page for my bakery", attachmentIds: ["attachment-1"], project: { kind: "existing", id: "acorn" } }]);
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).not.toBeVisible();
  await expect(page.getByRole("log")).not.toContainText("tokens");
  await page.screenshot({ path: testInfo.outputPath("desktop-conversation.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Conversations" }).getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByLabel("Working on")).toHaveValue("");
  await expect(page.getByLabel("Message Nova")).toHaveValue("");
});

test("history: switch, rename, cancel deletion, and delete an active chat", async ({ page }) => {
  await workspace(page);
  const history = page.getByRole("navigation", { name: "Conversations" });
  await history.getByRole("button", { name: "Ideas for our next launch", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Help me plan our next launch.");
  await history.getByRole("button", { name: "Options for Ideas for our next launch" }).click();
  await history.getByRole("button", { name: "Rename", exact: true }).click();
  await history.getByLabel("Chat name", { exact: true }).fill("October launch");
  await history.getByRole("button", { name: "Save chat name" }).click();
  await expect(history.getByRole("button", { name: "October launch", exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Options for October launch" }).click();
  await history.getByRole("button", { name: "Delete", exact: true }).click();
  await history.getByRole("button", { name: "Keep chat" }).click();
  await expect(history.getByRole("button", { name: "October launch", exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Options for October launch" }).click();
  await history.getByRole("button", { name: "Delete", exact: true }).click();
  await history.getByRole("button", { name: "Delete chat", exact: true }).click();
  await expect(history.getByRole("button", { name: "October launch", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
});

test("mobile: composer stays accessible, drawer traps focus and returns to the selected chat", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await workspace(page);
  await noHorizontalOverflow(page);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await expect(page.getByRole("navigation", { name: "Conversations" })).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-welcome.png"), fullPage: true });
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Sign out" }).focus();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("link", { name: "Agent Company home" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("navigation", { name: "Conversations" }).getByRole("button", { name: "Ideas for our next launch", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("log")).toContainText("Help me plan our next launch.");
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await noHorizontalOverflow(page);
});

test("new users see one setup action and a clear explanation for the disabled composer", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await workspace(page, { setup: true });
  await expect(page.getByRole("link", { name: "Connect an AI service" })).toHaveAttribute("href", "/w/studio/settings?tab=ai");
  await expect(page.getByLabel("Message Nova")).toBeDisabled();
  await expect(page.getByText("Finish the setup above to start chatting.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Build a website" })).toBeDisabled();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("mobile-setup.png"), fullPage: true });
});

test("viewers can read history but cannot create, rename, delete, or send", async ({ page }) => {
  await workspace(page, { viewer: true });
  await expect(page.getByLabel("Message Nova")).toBeDisabled();
  await expect(page.getByText(/You have view-only access/)).toBeVisible();
  const history = page.getByRole("navigation", { name: "Conversations" });
  await expect(history.getByRole("button", { name: "New chat", exact: true })).toHaveCount(1); // Existing conversation, not a create action.
  await expect(history.getByRole("button", { name: /Options for/ })).toHaveCount(0);
  await history.getByRole("button", { name: "Ideas for our next launch", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Help me plan our next launch.");
});

test("dark mode and small laptops keep the welcome and composer within the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await workspace(page, { dark: true });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Build a website" })).toBeInViewport();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("dark-laptop.png"), fullPage: true });
  await page.getByRole("button", { name: "How chat works" }).click();
  await expect(page.getByText("Start with a message.")).toBeVisible();
  await page.getByText("Your team", { exact: true }).click();
  await expect(page.getByRole("list", { name: "Your team" })).toBeVisible();
});
