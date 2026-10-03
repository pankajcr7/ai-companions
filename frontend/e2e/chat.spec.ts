import { expect, test } from "@playwright/test";
import { newCompany } from "./setup";

test("connect a custom endpoint, assign it to Nova, chat, and keep the history", async ({ page }) => {
  await newCompany(page, { prefix: "Chat", company: "Chat Bakery", template: /Just the head agent/ });

  await page.getByRole("link", { name: "AI providers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI providers" })).toBeVisible();
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Provider").selectOption("other");
  await dialog.getByLabel("Base URL").fill("http://127.0.0.1:4199/v1");
  await dialog.getByLabel("Name").fill("Fake LLM");
  await dialog.getByRole("button", { name: "Test and save" }).click();
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

  await panel.getByRole("tab", { name: "Chat" }).click();
  await panel.getByLabel("Message Nova").fill("Hello Nova");
  await panel.getByRole("button", { name: "Send" }).click();
  await expect(panel.getByText("Hello from the fake model.")).toBeVisible();
  await expect(panel.getByText(/fake-model · 56 tokens/)).toBeVisible();
  // Without clipboard access (for example on a plain-HTTP network address) the button says so.
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
  await panel.getByRole("button", { name: "Copy message" }).first().click();
  await expect(panel.getByRole("button", { name: "Couldn't copy, select the text instead" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("complementary", { name: "Companion details" }).getByRole("tab", { name: "Chat" }).click();
  await expect(page.getByText("Hello Nova")).toBeVisible();
  await expect(page.getByText("Hello from the fake model.")).toBeVisible();

  const chat = page.getByRole("complementary", { name: "Companion details" });
  // Nova knows the team: asked for marketing with no marketer, it offers to add one, then plans the work.
  await chat.getByLabel("Message Nova").fill("Ask the marketing team to market my app");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  const suggestion = chat.getByRole("group", { name: "Nova's suggestion" });
  await expect(suggestion).toContainText("No one on the team covers Marketing lead yet.");
  await suggestion.getByRole("button", { name: "Add a Marketing lead companion" }).click();
  const hireForm = page.getByRole("dialog");
  await expect(hireForm.getByLabel("Role")).toHaveValue("Marketing lead");
  await hireForm.getByLabel("Name").fill("Mira");
  await hireForm.getByLabel("Provider").selectOption({ label: "Fake LLM (127.0.0.1:4199)" });
  await hireForm.getByLabel("Model").fill("fake-model");
  await hireForm.getByRole("button", { name: "Save" }).click();
  await expect(hireForm).toBeHidden();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  const novaPanel = page.getByRole("complementary", { name: "Companion details" });
  await novaPanel.getByRole("tab", { name: "Chat" }).click();
  await novaPanel.getByRole("group", { name: "Nova's suggestion" }).last().getByRole("button", { name: "Plan it" }).click();
  await expect(page.getByRole("complementary", { name: "Company goal" }).getByText("Plan ready for your approval")).toBeVisible();
});
