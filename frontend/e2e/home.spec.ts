import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("ask Nova for work on the home screen, start, stop, resume, and ask about the results", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Home", company: "Home Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);

  await page.getByRole("link", { name: "Chat", exact: true }).click();
  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await expect(chat.getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
  await chat.getByText("Your team", { exact: true }).click();
  await expect(page.getByRole("list", { name: "Your team" }).getByText("Nova")).toBeVisible();
  await chat.getByText("Your team", { exact: true }).click();
  await chat.getByLabel("Message Nova").fill("Write the launch posts for my bakery");
  await chat.getByRole("button", { name: "Send", exact: true }).click();

  const card = chat.getByRole("group", { name: /Goal: Write the launch posts/ });
  await expect(card.getByText("Nova will write the launch posts")).toBeVisible();
  await expect(card.getByText("Design direction")).toBeVisible();
  // The chat list picks up the new title, and the home chat shows no technical details.
  await expect(page.getByRole("navigation", { name: "Conversations" }).getByText("Write the launch posts for my bakery")).toBeVisible();
  await expect(chat.getByText(/tokens/)).toHaveCount(0);
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText(/Working/)).toBeVisible();
  await page.getByRole("status").getByRole("button", { name: /Stop/ }).click();
  await expect(card.getByText(/Stopped\./)).toBeVisible();
  await card.getByRole("button", { name: "Resume" }).click();
  await expect(card.getByText("Done", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText("✓ Checked by Nova · 1 fix made")).toBeVisible();
  await expect(card.getByText("Nova's summary")).toBeVisible();
  await expect(card.getByRole("link", { name: "Details" })).toBeVisible();

  await chat.getByLabel("Message Nova").fill("What did the team write?");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Hello from the fake model.").last()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Conversations" }).getByText("Write the launch posts for my bakery")).toBeVisible();
  await expect(page.getByRole("group", { name: /Goal: Write the launch posts/ }).getByText("Done", { exact: true })).toBeVisible();

  // Chats can be renamed and deleted from the list.
  const list = page.getByRole("navigation", { name: "Conversations" });
  await list.getByRole("button", { name: "Options for Write the launch posts for my bakery" }).click();
  await list.getByRole("button", { name: "Rename", exact: true }).click();
  await list.getByLabel("Chat name", { exact: true }).fill("Bakery launch");
  await list.getByRole("button", { name: "Save chat name" }).click();
  await expect(list.getByText("Bakery launch")).toBeVisible();
  await list.getByRole("button", { name: "Options for Bakery launch" }).click();
  await list.getByRole("button", { name: "Delete", exact: true }).click();
  await list.getByRole("button", { name: "Delete chat", exact: true }).click();
  await expect(list.getByText("Bakery launch")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Chat with Nova" }).getByRole("heading", { name: "What would you like to create?" })).toBeVisible();
});
