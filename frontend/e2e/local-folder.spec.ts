import { expect, test } from "@playwright/test";
import { newCompany } from "./setup";

type Stub = { __calls: string[] };

test("in the desktop app a folder opens as a project; in a browser there's no Open folder", async ({ page }) => {
  const c = await newCompany(page, { prefix: "Folder", company: "Folder Bakery", template: /Just the head agent/ });
  await page.goto(`/w/${c.slug}/projects`);
  await expect(page.getByRole("heading", { name: "Ideas, brought to life." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open folder" })).toHaveCount(0);

  // Stands in for the desktop app's bridge (desktop/src/preload.ts).
  await page.addInitScript(() => {
    const w = window as unknown as Stub & { agentDesktop: unknown };
    const calls: string[] = (w.__calls = []);
    const opened: Record<string, string> = JSON.parse(sessionStorage.getItem("opened") ?? "{}");
    w.agentDesktop = {
      version: "0.2.0",
      deviceId: "device-0000-test",
      pickFolder: async () => (calls.push("pick"), "/Users/me/Sites/bakery-site"),
      projectOf: async (folder: string) => Object.keys(opened).find((k) => opened[k] === folder) ?? null,
      attach: async (projectId: string, folder: string) => {
        calls.push(`attach ${folder}`);
        opened[projectId] = folder;
        sessionStorage.setItem("opened", JSON.stringify(opened));
      },
      folderOf: async (projectId: string) => opened[projectId] ?? null,
      showFolder: async () => void calls.push("show"),
      folders: async () => [],
      forget: async () => {},
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page.getByRole("heading", { name: "bakery-site" })).toBeVisible();
  const projectUrl = page.url();
  expect(await page.evaluate(() => (window as unknown as Stub).__calls)).toEqual(["pick", "attach /Users/me/Sites/bakery-site"]);
  // No app answers for this folder in the test, so the page says what to do.
  await expect(page.getByText("Open the Agent Company app on the computer that has this folder.")).toBeVisible();
  await expect(page.getByText("/Users/me/Sites/bakery-site")).toBeVisible();
  await expect(page.getByRole("link", { name: /Download ZIP/ })).toHaveCount(0);

  // The same folder again opens the same project.
  await page.goto(`/w/${c.slug}/projects`);
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect(page).toHaveURL(projectUrl);
  const list = await (await page.request.get(`/api/workspaces/${c.id}/projects`)).json();
  expect(list.projects.map((p: { name: string; onDevice: string }) => [p.name, p.onDevice])).toEqual([["bakery-site", "device-0000-test"]]);
});
