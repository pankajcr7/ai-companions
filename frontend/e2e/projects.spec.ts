import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Playwright runs from frontend/ (see playwright.config.ts).
const fixture = resolve("e2e/fixtures/sample-app");

test("upload a folder, edit a file, restore a version, and download the ZIP", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("File Owner");
  await page.getByLabel("Email").fill(`files-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("File Bakery");
  await page.getByRole("radio", { name: /Just the head agent/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/file-bakery/);

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Open project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose a folder").setInputFiles(fixture);
  await expect(dialog.getByText(/node_modules folders are excluded/)).toBeVisible();
  await expect(dialog.getByText(/secret or credential file/)).toBeVisible();
  await dialog.getByLabel("Project name").fill("Sample app");
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("files added");
  await dialog.getByRole("button", { name: "Open project" }).click();

  await expect(page.getByRole("heading", { name: "Sample app" })).toBeVisible();
  const tree = page.getByRole("tree", { name: "Project files" });
  await expect(tree.getByText("math.ts")).toBeVisible();
  await expect(tree.getByText("left-pad")).toHaveCount(0);
  await expect(tree.getByText(".env")).toHaveCount(0);
  await tree.getByText("math.ts").click();

  const editor = page.getByLabel("Editing sample-app/src/lib/math.ts");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("export const add = (a: number, b: number) => a + b + 0;");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved version 2.")).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("complementary", { name: "File history" });
  await expect(history.getByText("Version 2 (current)")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await history.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Version restored.")).toBeVisible();
  await expect(page.getByLabel("Editing sample-app/src/lib/math.ts")).toContainText("a + b;");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ZIP" }).click();
  expect((await download).suggestedFilename()).toBe("Sample app.zip");
});
