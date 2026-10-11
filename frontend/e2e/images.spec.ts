import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("add a free Cloudflare key, ask Nova for a logo, see it under her reply, open it, and save it to a project", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Pics", company: "Pics Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);
  const made = await page.request.post(`/api/workspaces/${co.id}/projects`, { headers: { origin: "http://localhost:3100" }, data: { name: "Brand" } });
  expect(made.ok()).toBe(true);

  await page.goto(`/w/${co.slug}/providers`);
  const card = page.getByRole("region", { name: "Image generation" });
  await card.getByLabel("Account ID").fill("0123456789abcdef0123456789abcdef");
  await card.getByLabel("API token").fill("fake-cloudflare-token-1234");
  await card.getByRole("button", { name: "Save Cloudflare" }).click();
  await expect(card.getByText("fak…1234")).toBeVisible();

  await page.goto(`/w/${co.slug}`);
  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await chat.getByLabel("Message Nova").fill("Draw a logo for the bakery");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Here's your logo.")).toBeVisible();
  await chat.getByRole("button", { name: "Made 1 image" }).click();
  await expect(chat.getByText("“A warm bakery logo” · free")).toBeVisible();
  await chat.getByRole("img", { name: "logo.png" }).click();
  const viewer = page.getByRole("dialog", { name: "logo.png" });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();

  await chat.getByRole("button", { name: "Save to project" }).click();
  const save = page.getByRole("dialog", { name: "Save logo.png to a project" });
  await save.getByRole("button", { name: "Save" }).click();
  await expect(save.getByRole("status")).toHaveText("Saved as attachments/logo.png");
});
