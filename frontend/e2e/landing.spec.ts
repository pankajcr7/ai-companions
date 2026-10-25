import { expect, test } from "@playwright/test";

test("the landing hero shows the headline and its buttons over the 3D scenes, without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(/Hire an\s*AI team/i);
  await expect(page.getByRole("link", { name: "Create your team" }).first()).toHaveAttribute("href", "/sign-up");
  await expect(page.getByRole("link", { name: "See it work" }).first()).toHaveAttribute("href", "#product");
  // Two moving scenes: the team network and the robot.
  await expect(page.locator("canvas")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Bring your own models" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause motion" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the footer links to Privacy and Terms, and both pages open", async ({ page }) => {
  await page.goto("/");
  const legal = page.getByRole("navigation", { name: "Legal" });
  await legal.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
});
