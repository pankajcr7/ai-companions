import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("a companion's page: profile, chat, edit, and a missing teammate", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Team", company: "Team Bakery", template: /Starter/ });
  await connectFakeLLM(page, co.id);
  const snap = await (await page.request.get(`/api/workspaces/${co.id}`)).json();
  const nova = snap.agents.find((a: { isHead: boolean }) => a.isHead);

  await page.goto(`/w/${co.slug}/team/${nova.id}`);
  const about = page.getByRole("region", { name: "About Nova" });
  await expect(about.getByRole("heading", { name: "Nova" })).toBeVisible();
  await expect(about.getByText("Team lead")).toBeVisible();
  await expect(about.getByText("Free")).toBeVisible();
  await expect(about.getByText("No finished work yet.")).toBeVisible();

  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await chat.getByLabel("Message Nova").fill("Hello Nova");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Hello from the fake model.")).toBeVisible();

  await about.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name").fill("Nova Prime");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("region", { name: "About Nova Prime" }).getByRole("heading", { name: "Nova Prime" })).toBeVisible();

  const other = snap.agents.find((a: { isHead: boolean }) => !a.isHead);
  await page.goto(`/w/${co.slug}/team/${other.id}`);
  await expect(page.getByText("Needs setup").first()).toBeVisible();
  await expect(page.getByRole("region", { name: `Chat with ${other.name}` }).getByRole("button", { name: "Choose a model" })).toBeVisible();

  await page.goto(`/w/${co.slug}/team/does-not-exist`);
  await expect(page.getByText("This teammate wasn't found")).toBeVisible();
  await page.getByRole("link", { name: "Back to team" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${co.slug}/team$`));
});

test("the Team page: office desks, cards by department, organizing, and old links", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Cards", company: "Cards Bakery", template: /Starter/ });
  await connectFakeLLM(page, co.id);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();
  const office = page.getByRole("group", { name: /^Team office\./ });
  await expect(office).toBeVisible();
  const desk = office.getByRole("button", { name: /^Nova, Team lead, Free$/ });
  await desk.focus();
  await desk.press("Enter");
  await expect(page.getByRole("region", { name: "Chat with Nova" })).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  const lead = page.getByRole("region", { name: "Team lead" });
  const nova = lead.getByRole("article", { name: "Nova" });
  await expect(nova.getByText("Team lead")).toBeVisible();
  await expect(nova.getByText("Free")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Needs setup" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Office", exact: true }).click();
  await expect(office).toBeVisible();
  await page.reload();
  await expect(office).toBeVisible();
  const zoom = page.getByRole("group", { name: "Office zoom" });
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).toContainText("120%");
  await zoom.getByRole("button", { name: "Reset view" }).click();
  await expect(zoom).toContainText("100%");
  await page.getByRole("button", { name: "Cards", exact: true }).click();

  await nova.getByRole("link", { name: "Chat with Nova" }).click();
  await expect(page.getByRole("region", { name: "Chat with Nova" })).toBeVisible();
  await page.goBack();

  await page.getByRole("button", { name: "Organize" }).click();
  const org = page.getByRole("dialog", { name: "Organize your team" });
  await org.getByLabel("New department name").fill("Kitchen");
  await org.getByRole("button", { name: "Add" }).click();
  await expect(org.getByLabel("Department name").last()).toHaveValue("Kitchen");
  await org.getByRole("button", { name: "Close" }).click();

  await page.goto(`/w/${co.slug}/office`);
  await expect(page).toHaveURL(new RegExp(`/w/${co.slug}/team$`));
  await page.goto(`/w/${co.slug}/organization`);
  await expect(page).toHaveURL(new RegExp(`/w/${co.slug}/team$`));
});

test("Settings has Company and AI services tabs; the old providers link keeps its message", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Tabs", company: "Tabs Bakery", template: /Just the head agent/ });
  const nav = page.getByRole("navigation", { name: "App" });
  await expect(nav.getByRole("link")).toHaveText(["Chat", "Projects", "Team"]);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Company", selected: true })).toBeVisible();
  await page.getByRole("tab", { name: "AI services" }).click();
  await expect(page).toHaveURL(/tab=ai/);
  await expect(page.getByRole("heading", { name: "AI services" })).toBeVisible();
  await page.goto(`/w/${co.slug}/providers?chatgpt_error=${encodeURIComponent("Sign-in expired")}`);
  await expect(page).toHaveURL(/\/settings\?/);
  await expect(page.getByText("Sign-in expired")).toBeVisible();
});

test("first-run setup card, then Give a task fills the home input", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Setup", company: "Setup Bakery", template: /Starter/ });
  const setup = page.getByRole("region", { name: "Finish setting up" });
  await expect(setup.getByRole("link", { name: "Connect an AI service" })).toBeVisible();
  await setup.getByRole("link", { name: "Connect an AI service" }).click();
  await expect(page).toHaveURL(/\/settings\?tab=ai/);
  await page.getByRole("button", { name: "Add a service" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("AI service").selectOption("other");
  await dialog.getByLabel("Service address").fill("http://127.0.0.1:4199/v1");
  await dialog.getByLabel("Name").fill("Fake LLM");
  await dialog.getByRole("button", { name: "Test and save" }).click();
  await page.getByRole("link", { name: "Back to home" }).click();

  await expect(setup.getByText("One more step to meet Nova")).toBeVisible();
  await setup.getByRole("button", { name: "Choose Nova’s AI model" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("AI service").selectOption({ label: "Fake LLM (127.0.0.1:4199)" });
  await form.getByLabel("AI model").fill("fake-model");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(setup).toHaveCount(0);

  await page.getByRole("link", { name: "Team", exact: true }).click();
  const snap = await (await page.request.get(`/api/workspaces/${co.id}`)).json();
  const other = snap.agents.find((a: { isHead: boolean }) => !a.isHead);
  await page.request.patch(`/api/workspaces/${co.id}/agents/${other.id}`, { headers: { origin: "http://localhost:3100" }, data: { name: "Mira & Co", connectionId: snap.agents.find((a: { isHead: boolean }) => a.isHead).connectionId, model: "fake-model" } });
  await page.reload();
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await page.getByRole("article", { name: "Mira & Co" }).getByRole("link", { name: "Give a task" }).click();
  await expect(page.getByLabel("Message Nova")).toHaveValue("@Mira & Co ");
  // The name is filled in once: a new chat (or a reload) starts empty.
  await expect(page).not.toHaveURL(/ask=/);
  await page.getByRole("navigation", { name: "Conversations" }).getByRole("button", { name: "New chat", exact: true }).first().click();
  await expect(page.getByLabel("Message Nova")).toHaveValue("");
});

test("after a first ChatGPT sign-in the next setup step is still shown", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Gpt", company: "Gpt Bakery", template: /Starter/ });
  await page.goto(`/w/${co.slug}/providers?connected=chatgpt`);
  await page.getByRole("dialog").getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("status")).toContainText("ChatGPT is connected.");
  await expect(page.getByRole("status")).toContainText("Next: choose Nova's AI model.");
  await expect(page.getByRole("status").getByRole("link", { name: "Back to home" })).toBeVisible();
});
