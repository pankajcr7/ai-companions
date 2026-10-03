import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("give the company a goal, approve the plan, and apply a proposed edit", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Goal Owner");
  await page.getByLabel("Email").fill(`goals-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Company name").fill("Goal Bakery");
  await page.getByRole("radio", { name: /Just the head agent/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/goal-bakery/);

  await page.getByRole("link", { name: "AI providers", exact: true }).click();
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const conn = page.getByRole("dialog");
  await conn.getByLabel("Provider").selectOption("other");
  await conn.getByLabel("Base URL").fill("http://127.0.0.1:4199/v1");
  await conn.getByLabel("Name").fill("Fake LLM");
  await conn.getByRole("button", { name: "Test and save" }).click();
  await expect(page.getByText(/Connected/).first()).toBeVisible();

  await page.getByRole("link", { name: "Office", exact: true }).click();
  await page.getByRole("button", { name: "Nova, Head agent, Idle" }).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Companion details" });
  await panel.getByRole("button", { name: "Customize" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Provider").selectOption({ label: "Fake LLM (127.0.0.1:4199)" });
  await form.getByLabel("Model").fill("fake-model");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await page.getByRole("button", { name: "Close details" }).click();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Open project" }).click();
  const upload = page.getByRole("dialog");
  await upload.getByLabel("Choose a folder").setInputFiles(resolve("e2e/fixtures/sample-app"));
  await upload.getByLabel("Project name").fill("Sample app");
  await upload.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(upload.getByRole("status")).toContainText("files added");
  await upload.getByRole("button", { name: "Open project" }).click();
  await expect(page.getByRole("heading", { name: "Sample app" })).toBeVisible();

  await page.getByRole("link", { name: "Office", exact: true }).click();
  await page.getByLabel("Project for this goal").selectOption({ label: "Sample app" });
  await page.getByLabel("Tell your company what to do").fill("Document the math helper");
  await page.getByRole("button", { name: "Send to your company" }).click();

  const goal = page.getByRole("complementary", { name: "Company goal" });
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
  await card.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("export const add");

  await goal.getByRole("button", { name: "Continue with a new goal" }).click();
  await goal.getByLabel("What should happen next?").fill("Add a subtract helper too");
  await goal.getByRole("button", { name: "Plan it" }).click();
  const followUp = page.getByRole("complementary", { name: "Company goal" });
  await expect(followUp.getByRole("button", { name: /Continues: Document the math helper/ })).toBeVisible();
  await expect(followUp.getByText("Plan ready for your approval")).toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: /Sample app/ }).click();
  await page.getByRole("tree", { name: "Project files" }).getByText("math.ts").click();
  await expect(page.getByLabel("Editing sample-app/src/lib/math.ts")).toContainText("Adds two numbers.");
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByRole("complementary", { name: "File history" }).getByText("Version 2 (current)")).toBeVisible();
});
