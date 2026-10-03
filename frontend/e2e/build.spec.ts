import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany, startGoal } from "./setup";

test("build a new project from a goal, preview it, and download it", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Build", company: "Build Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);

  await startGoal(page, co, { text: "Build a landing page for my bakery", newProject: true });
  const goal = page.getByRole("complementary", { name: "Company goal" });
  await expect(goal.getByLabel("New project name")).toHaveValue("Bakery landing page");
  await goal.getByRole("button", { name: "Start" }).click();
  await expect(goal.getByRole("status")).toContainText("Done", { timeout: 60_000 });

  const created = goal.getByRole("region", { name: "Files created" });
  await expect(created).toContainText("index.html");
  await expect(created).toContainText("style.css");
  await created.getByRole("button", { name: "Preview" }).click();
  const frame = page.frameLocator('iframe[title="Preview of Bakery landing page"]');
  await expect(frame.getByRole("heading", { name: "Crumb Bakery" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  const download = page.waitForEvent("download");
  await created.getByRole("link", { name: "Download ZIP" }).click();
  expect((await download).suggestedFilename()).toBe("Bakery landing page.zip");

  await created.getByRole("link", { name: "View" }).first().click();
  await expect(page.getByLabel("Editing index.html")).toContainText("Crumb Bakery");
});
