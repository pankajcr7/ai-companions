import { expect, test } from "@playwright/test";

test("the landing hero shows the headline and its buttons over the 3D dusk field with the 3D robot, without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const hero = page.locator("h1");
  await expect(hero).toHaveText(/Hire an\s*AI team/i);
  await expect(page.getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "#process");
  // Two 3D scenes: the pillar field and the robot.
  await expect(page.locator("canvas")).toHaveCount(2);
  await page.mouse.move(600, 600);
  await expect(page.getByRole("region", { name: "Bring your own models" })).toBeVisible();
  expect(errors).toEqual([]);
});
