import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("attach an image and a PDF, Nova reads the PDF, and the team gets both files", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Files", company: "Files Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);
  await page.goto(`/w/${co.slug}`);
  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await chat.getByLabel("Attach files").setInputFiles([{ name: "logo.png", mimeType: "image/png", buffer: PNG }, { name: "menu.pdf", mimeType: "application/pdf", buffer: readFileSync(resolve("e2e/fixtures/menu.pdf")) }]);
  await expect(chat.getByRole("listitem", { name: /logo\.png/ })).toBeVisible();
  await expect(chat.getByRole("listitem", { name: /menu\.pdf/ })).toBeVisible();
  await chat.getByLabel("Message Nova").fill("What's on my menu?");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Your menu has croissants.")).toBeVisible();
  await expect(chat.getByRole("img", { name: "logo.png" })).toBeVisible();
  await expect(chat.getByRole("link", { name: /menu\.pdf/ })).toBeVisible();

  await chat.getByLabel("Message Nova").fill("Build my bakery site with these files");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  const card = chat.getByRole("group", { name: /Goal:/ });
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText("Done", { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: /Bakery landing page/ }).click();
  const tree = page.getByRole("tree", { name: "Project files" });
  await expect(tree.getByText("logo.png")).toBeVisible();
  await expect(tree.getByText("menu.pdf")).toBeVisible();
});
