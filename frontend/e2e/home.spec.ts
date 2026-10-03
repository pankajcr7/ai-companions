import { expect, test } from "@playwright/test";

test("ask Nova for work on the home screen, start, stop, resume, and ask about the results", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Home Owner");
  await page.getByLabel("Email").fill(`home-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("Home Bakery");
  await page.getByRole("radio", { name: /Just the head agent/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/home-bakery/);
  await expect(page.getByText("Nova needs an AI model")).toBeVisible();

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

  await page.getByRole("link", { name: "Home", exact: true }).click();
  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await expect(chat.getByText("What should the team work on today?")).toBeVisible();
  await expect(page.getByRole("list", { name: "Your team" }).getByText("Nova")).toBeVisible();
  await chat.getByLabel("Message Nova").fill("Write the launch posts for my bakery");
  await chat.getByRole("button", { name: "Send", exact: true }).click();

  const card = chat.getByRole("group", { name: /Goal: Write the launch posts/ });
  await expect(card.getByText("Nova will write the launch posts")).toBeVisible();
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText(/Working/)).toBeVisible();
  await page.getByRole("status").getByRole("button", { name: /Stop/ }).click();
  await expect(card.getByText(/Stopped\./)).toBeVisible();
  await card.getByRole("button", { name: "Resume" }).click();
  await expect(card.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText("Nova's summary")).toBeVisible();

  await chat.getByLabel("Message Nova").fill("What did the team write?");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Hello from the fake model.").last()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Conversations" }).getByText("Write the launch posts for my bakery")).toBeVisible();
  await expect(page.getByRole("group", { name: /Goal: Write the launch posts/ }).getByText("Done", { exact: true })).toBeVisible();
});
