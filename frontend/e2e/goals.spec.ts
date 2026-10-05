import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany, startGoal } from "./setup";

test("give the company a goal, approve the plan, and apply a proposed edit", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Goal", company: "Goal Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Open project" }).click();
  const upload = page.getByRole("dialog");
  await upload.getByLabel("Choose a folder").setInputFiles(resolve("e2e/fixtures/sample-app"));
  await upload.getByLabel("Project name").fill("Sample app");
  await upload.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(upload.getByRole("status")).toContainText("files added");
  await upload.getByRole("button", { name: "Open project" }).click();
  await expect(page.getByRole("heading", { name: "Sample app" })).toBeVisible();

  const projectId = new URL(page.url()).pathname.split("/").pop()!;
  await startGoal(page, co, { text: "Document the math helper", projectId });

  const goal = page.getByRole("complementary", { name: "Team task" });
  await expect(goal.getByText("Plan ready for your approval")).toBeVisible();
  await goal.getByLabel("Title").fill("Document add()");
  await goal.getByRole("button", { name: "Start" }).click();
  await expect(goal.getByRole("status")).toContainText("Done", { timeout: 60_000 });
  await expect(goal.getByText("Nova checked the work: the helper is documented.")).toBeVisible();
  await expect(goal.getByText(/Meets criteria/)).toBeVisible();
  await goal.getByRole("button", { name: "Show result" }).click();
  await expect(goal.getByText("I documented the add helper.")).toBeVisible();

  await goal.getByRole("button", { name: "View changes" }).click();
  const review = page.getByRole("dialog");
  await expect(review.getByText("Left: current file. Right: proposed change.")).toBeVisible();
  await expect(review).toContainText("Adds two numbers.");
  await expect(review.getByRole("button", { name: "Copy new file" })).toBeVisible();
  await review.getByRole("button", { name: "Close" }).click();
  await goal.getByRole("button", { name: "Apply" }).click();
  await expect(goal.getByText(/applied/)).toBeVisible();
  await goal.getByRole("button", { name: "Good result" }).click();
  await expect(goal.getByRole("button", { name: "Good result" })).toHaveAttribute("aria-pressed", "true");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await goal.getByLabel("Ask Nova about this goal").fill("Show me the helper");
  await goal.getByRole("button", { name: "Send", exact: true }).click();
  const card = goal.getByRole("figure", { name: "Code: sample-app/src/lib/math.ts" });
  await expect(card).toContainText("Adds two numbers.");
  // Images in model output are never fetched: a prompt injection could use one to leak data.
  await expect(goal.locator('img[src*="pixel"]')).toHaveCount(0);
  await expect(goal.getByText("[image: tracker]")).toBeVisible();
  await card.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("export const add");

  await goal.getByRole("button", { name: "Continue with a new goal" }).click();
  await goal.getByLabel("What should happen next?").fill("Add a subtract helper too");
  await goal.getByRole("button", { name: "Plan it" }).click();
  const followUp = page.getByRole("complementary", { name: "Team task" });
  await expect(followUp.getByRole("button", { name: /Continues: Document the math helper/ })).toBeVisible();
  await expect(followUp.getByText("Plan ready for your approval")).toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: /Sample app/ }).click();
  await page.getByRole("tree", { name: "Project files" }).getByText("math.ts").click();
  await expect(page.getByLabel("Editing sample-app/src/lib/math.ts")).toContainText("Adds two numbers.");
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("complementary", { name: "File history" }).getByText("Version 2 (current)")).toBeVisible();
});
