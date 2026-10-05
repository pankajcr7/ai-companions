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

test("the Team page: cards by department, the office view, organizing, and old links", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Cards", company: "Cards Bakery", template: /Starter/ });
  await connectFakeLLM(page, co.id);
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your team" })).toBeVisible();
  const lead = page.getByRole("region", { name: "Team lead" });
  const nova = lead.getByRole("article", { name: "Nova" });
  await expect(nova.getByText("Team lead")).toBeVisible();
  await expect(nova.getByText("Free")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Needs setup" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Office", exact: true }).click();
  await expect(page.getByLabel(/^Office map\./)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/^Office map\./)).toBeVisible();
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
