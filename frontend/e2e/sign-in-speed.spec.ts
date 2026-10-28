import { expect, test } from "@playwright/test";
import { newCompany } from "./setup";

test("signing in goes straight to the workspace, with no extra hops or repeated requests", async ({ page }) => {
  const co = await newCompany(page, { prefix: "Speedy", company: `Speedy Bakery ${Date.now()}`, template: /Just the head agent/ });
  const email = (await (await page.request.get("/api/me")).json()).user.email as string;
  await page.context().clearCookies();

  const visited: string[] = [];
  const calls: string[] = [];
  page.on("framenavigated", (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname));
  page.on("request", (r) => r.url().includes("/api/") && calls.push(new URL(r.url()).pathname));

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-1");
  calls.length = 0;
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${co.slug}$`));
  await expect(page.getByRole("region", { name: "Chat with Nova" })).toBeVisible();

  expect(visited).not.toContain("/app");
  expect(calls.filter((c) => c === "/api/me").length).toBeLessThanOrEqual(1);
  expect(calls).toContain(`/api/workspaces/by-slug/${co.slug}`);
});
