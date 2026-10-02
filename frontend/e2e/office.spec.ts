import { expect, test } from "@playwright/test";

test("sign up, onboard, customize a companion, and it survives refresh", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.dev`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Asha Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("Asha Bakery");
  await page.getByRole("radio", { name: /Starter/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();

  await expect(page).toHaveURL(/\/w\/asha-bakery/);
  const companions = page.getByRole("button", { name: /, Idle$/ });
  await expect(companions).toHaveCount(5);

  // Keyboard: focus the head agent and open it with Enter.
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Companion details" });
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Customize" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Nova Prime");
  await dialog.getByLabel("Color", { exact: true }).fill("#ff7a00");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "Nova Prime, Head agent, Idle" })).toBeVisible();

  // Escape closes the panel and returns focus to the companion.
  const nova = page.getByRole("button", { name: "Nova Prime, Head agent, Idle" });
  await nova.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(nova).toBeFocused();

  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("row", { name: /^Nova Prime/ })).toBeVisible();
});
