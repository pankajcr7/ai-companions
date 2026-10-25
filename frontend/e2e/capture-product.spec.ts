import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

// Refreshes the landing page's "See it work" screenshots from the real app, with a sample company and the fake model.
// Run on demand: CAPTURE=1 npx playwright test e2e/capture-product.spec.ts
test.skip(!process.env.CAPTURE, "Set CAPTURE=1 to refresh the landing page's product screenshots.");
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

const out = (name: string) => `public/product/${name}.png`;

test("capture the product screens shown on the landing page", async ({ page }) => {
  test.setTimeout(300_000);
  const co = await newCompany(page, { prefix: "Shot", company: "Crumb Bakery", template: /Starter/ });
  await connectFakeLLM(page, co.id, "all");

  // 1. Asking Nova for work in chat, through to the finished, checked result.
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await chat.getByLabel("Message Nova").fill("Write the launch posts for my bakery");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  const card = chat.getByRole("group", { name: /Goal: Write the launch posts/ });
  await card.getByRole("button", { name: "Start" }).click();
  await expect(card.getByText("Done", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(card.getByText("Nova's summary")).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: out("chat") });

  // 2. The team: every companion at their desk.
  await page.getByRole("link", { name: "Team", exact: true }).click();
  await expect(page.getByRole("group", { name: /^Team office\./ })).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: out("team") });
});
