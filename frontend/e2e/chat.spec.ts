import { expect, test } from "@playwright/test";

test("connect a custom endpoint, assign it to Nova, chat, and keep the history", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Chat Owner");
  await page.getByLabel("Email").fill(`chat-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("Chat Bakery");
  await page.getByRole("radio", { name: /Just the head agent/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/chat-bakery/);

  await page.getByRole("link", { name: "AI providers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI providers" })).toBeVisible();
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Provider").selectOption("other");
  await dialog.getByLabel("Base URL").fill("http://127.0.0.1:4199/v1");
  await dialog.getByLabel("Name").fill("Fake LLM");
  await dialog.getByRole("button", { name: "Test and save" }).click();
  await expect(page.getByText(/Connected/).first()).toBeVisible();

  await page.getByRole("link", { name: "Office", exact: true }).click();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Companion details" });
  await panel.getByRole("button", { name: "Customize" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Provider").selectOption({ label: "Fake LLM (127.0.0.1:4199)" });
  await form.getByLabel("Model").fill("fake-model");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();

  await panel.getByRole("tab", { name: "Chat" }).click();
  await panel.getByLabel("Message Nova").fill("Hello Nova");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("Hello from the fake model.")).toBeVisible();
  await expect(panel.getByText(/fake-model · 56 tokens/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("complementary", { name: "Companion details" }).getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("Hello Nova")).toBeVisible();
  await expect(page.getByText("Hello from the fake model.")).toBeVisible();

  // The office command bar sends to the head agent and opens their chat.
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByLabel("Tell your company what to do").fill("chat: Plan the launch");
  await page.getByRole("button", { name: "Send to your company" }).click();
  const chat = page.getByRole("complementary", { name: "Companion details" });
  await expect(chat.getByText("Plan the launch")).toBeVisible();
  await expect(chat.getByText("Hello from the fake model.")).toHaveCount(2);
});
