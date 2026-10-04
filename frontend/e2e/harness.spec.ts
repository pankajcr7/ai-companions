import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { connectFakeLLM, newCompany } from "./setup";

test("Nova reads the project to answer, then suggests a change you apply", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Tools", company: "Tools Bakery", template: /Just the head agent/ });
  await connectFakeLLM(page, co.id);
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Open project" }).click();
  const upload = page.getByRole("dialog");
  await upload.getByLabel("Choose a folder").setInputFiles(resolve("e2e/fixtures/sample-app"));
  await upload.getByLabel("Project name").fill("Sample app");
  await upload.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(upload.getByRole("status")).toContainText("files added");
  await page.goto(`/w/${co.slug}`);

  const chat = page.getByRole("region", { name: "Chat with Nova" });
  await page.getByLabel("Working on").selectOption({ label: "Sample app" });
  await chat.getByLabel("Message Nova").fill("What does my app do?");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat.getByText("Your app is a small sample with a math helper.")).toBeVisible();
  await expect(chat.getByText(/\{"tool"/)).toHaveCount(0);
  await chat.getByRole("button", { name: "Read 1 file" }).click();
  await expect(chat.getByText("sample-app/README.md")).toBeVisible();

  await chat.getByLabel("Message Nova").fill("Add a changelog");
  await chat.getByRole("button", { name: "Send", exact: true }).click();
  const card = chat.getByRole("group", { name: "Suggested changes" });
  await expect(card.getByText("sample-app/CHANGELOG.md")).toBeVisible();
  await card.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("dialog")).toContainText("First release");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await card.getByRole("button", { name: "Apply" }).click();
  await expect(card.getByText("Applied")).toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("link", { name: /Sample app/ }).click();
  await expect(page.getByRole("tree", { name: "Project files" }).getByText("CHANGELOG.md")).toBeVisible();
});

test("the web search key can be added and removed in AI services", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Search", company: "Search Bakery", template: /Just the head agent/ });
  await page.goto(`/w/${co.slug}/providers`);
  const card = page.getByRole("region", { name: "Web search" });
  await expect(card.getByText("Not set up")).toBeVisible();
  await card.getByLabel("Tavily API key").fill("tvly-wrong");
  await card.getByRole("button", { name: "Save key" }).click();
  await expect(card.getByRole("alert")).toContainText(/rejected|reach/i);
});
