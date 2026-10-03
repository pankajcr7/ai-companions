import { expect, test } from "@playwright/test";

test("build a new project from a goal, preview it, and download it", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Build Owner");
  await page.getByLabel("Email").fill(`build-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("Build Bakery");
  await page.getByRole("radio", { name: /Just the head agent/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/build-bakery/);

  await page.getByRole("link", { name: "AI providers", exact: true }).click();
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const conn = page.getByRole("dialog");
  await conn.getByLabel("Provider").selectOption("other");
  await conn.getByLabel("Base URL").fill("http://127.0.0.1:4199/v1");
  await conn.getByLabel("Name").fill("Fake LLM");
  await conn.getByRole("button", { name: "Test and save" }).click();
  await expect(page.getByText(/Connected/).first()).toBeVisible();

  await page.getByRole("link", { name: "Office map", exact: true }).click();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Companion details" });
  await panel.getByRole("button", { name: "Customize" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Provider").selectOption({ label: "Fake LLM (127.0.0.1:4199)" });
  await form.getByLabel("Model").fill("fake-model");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await page.getByRole("button", { name: "Close details" }).click();

  await page.getByLabel("Project for this goal").selectOption({ label: "New project" });
  await page.getByLabel("Tell your company what to do").fill("Build a landing page for my bakery");
  await page.getByRole("button", { name: "Send to your company" }).click();
  const goal = page.getByRole("complementary", { name: "Company goal" });
  await expect(goal.getByLabel("New project name")).toHaveValue("Bakery landing page");
  await goal.getByRole("button", { name: "Start" }).click();
  await expect(goal.getByRole("status")).toContainText("Done", { timeout: 60_000 });

  const created = goal.getByRole("region", { name: "Files created" });
  await expect(created).toContainText("index.html");
  await expect(created).toContainText("style.css");
  await created.getByRole("button", { name: "Preview" }).click();
  const frame = page.frameLocator('iframe[title="Preview of Bakery landing page"]');
  await expect(frame.getByRole("heading", { name: "Crumb Bakery" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  const download = page.waitForEvent("download");
  await created.getByRole("link", { name: "Download ZIP" }).click();
  expect((await download).suggestedFilename()).toBe("Bakery landing page.zip");

  await created.getByRole("link", { name: "View" }).first().click();
  await expect(page.getByLabel("Editing index.html")).toContainText("Crumb Bakery");
});
