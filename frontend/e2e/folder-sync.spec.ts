import { expect, test } from "@playwright/test";
import { newCompany } from "./setup";

type Stub = { __calls: string[]; __emit(projectId: string, o: object): void };

test("in the desktop app a project syncs with a folder; in a browser the button isn't there", async ({ page }) => {
  const c = await newCompany(page, { prefix: "Sync", company: "Sync Bakery", template: /Just the head agent/ });
  const res = await page.request.post(`/api/workspaces/${c.id}/projects`, { headers: { origin: "http://localhost:3100" }, data: { name: "Sync site" } });
  const pid = (await res.json()).id as string;

  await page.goto(`/w/${c.slug}/projects/${pid}`);
  await expect(page.getByRole("heading", { name: "Sync site" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync with a folder on this computer" })).toHaveCount(0);

  // Stands in for the desktop app's bridge (desktop/src/preload.ts).
  await page.addInitScript(() => {
    const w = window as unknown as Stub & { agentDesktop: unknown };
    const calls: string[] = (w.__calls = []);
    let listener: ((id: string, s: unknown) => void) | null = null;
    const status = (o = {}) => ({ kind: "synced", at: Date.now(), waiting: 0, conflicts: [], deletedHere: [], skipped: [], readOnly: false, ...o });
    w.__emit = (id, o) => listener?.(id, status(o));
    w.agentDesktop = {
      version: "0.1.0",
      pickFolder: async () => (calls.push("pickFolder"), "/Users/me/Sites/sync-site"),
      link: async (o: { projectName: string; folder: string }) => (calls.push(`link ${o.projectName} ${o.folder}`), status()),
      unlink: async () => void calls.push("unlink"),
      linkOf: async () => null,
      onStatus: (cb: (id: string, s: unknown) => void) => ((listener = cb), () => (listener = null)),
      openFolder: async () => void calls.push("openFolder"),
      confirmDeletes: async () => void calls.push("confirmDeletes"),
      restoreDeleted: async () => void calls.push("restoreDeleted"),
    };
  });
  await page.reload();
  const calls = () => page.evaluate(() => (window as unknown as Stub).__calls);

  await page.getByRole("button", { name: "Sync with a folder on this computer" }).click();
  const bar = page.getByRole("region", { name: "Folder sync" });
  await expect(bar.getByText("sync-site", { exact: true })).toBeVisible();
  await expect(bar.getByText("Synced just now")).toBeVisible();
  expect(await calls()).toEqual(["pickFolder", "link Sync site /Users/me/Sites/sync-site"]);

  await page.evaluate((id) => (window as unknown as Stub).__emit(id, { deletedHere: ["a.md", "b.md"], conflicts: ["c (my copy).md"] }), pid);
  await expect(bar.getByText("2 files deleted on this computer")).toBeVisible();
  await expect(bar.getByText("1 conflict: c (my copy).md")).toBeVisible();
  await bar.getByRole("button", { name: "Delete them in the project too" }).click();
  await bar.getByRole("button", { name: "Open folder" }).click();
  await bar.getByRole("button", { name: "Stop syncing" }).click();
  await expect(page.getByRole("button", { name: "Sync with a folder on this computer" })).toBeVisible();
  expect((await calls()).slice(2)).toEqual(["confirmDeletes", "openFolder", "unlink"]);
});
