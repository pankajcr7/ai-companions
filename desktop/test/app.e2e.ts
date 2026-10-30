import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

function serve(html: string) {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const s = http.createServer((req, res) => {
      res.setHeader("content-type", "text/html");
      // Like the site's preview pages: built apps run sandboxed on the site's own address.
      if (req.url === "/preview") res.setHeader("content-security-policy", "sandbox allow-scripts allow-forms");
      if (req.url === "/go-elsewhere") {
        res.writeHead(302, { location: "https://example.com/landing" });
        return res.end();
      }
      res.end(html);
    });
    s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });
}

async function launch(url: string) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "agent-app-"));
  return electron.launch({ args: [path.join(__dirname, "../dist/main.js")], env: { ...process.env, AGENT_COMPANY_URL: url, AGENT_COMPANY_DATA: data } });
}

test("shows the site with the desktop bridge; other sites open in the browser and get no bridge", async () => {
  const other = await serve("<h1>Somewhere else</h1>");
  const site = await serve(`<h1>Agent Company</h1><a id="out" href="${other.url}/page">out</a><a id="google" href="https://sites.google.com/view/x">g</a><a id="redirect" href="/go-elsewhere">r</a>`);
  const app = await launch(site.url);
  const win = await app.firstWindow();
  await expect(win.locator("h1")).toHaveText("Agent Company");
  expect(new URL(win.url()).pathname).toBe("/app");
  expect(await win.evaluate(() => typeof (window as unknown as { agentDesktop?: { version: string } }).agentDesktop?.version)).toBe("string");
  expect(await win.evaluate(() => (window as unknown as { agentDesktop: { deviceId: string } }).agentDesktop.deviceId)).toMatch(/^[0-9a-f-]{36}$/);
  // No camera or microphone for pages, without a prompt.
  expect(await win.evaluate(() => navigator.mediaDevices.getUserMedia({ audio: true }).then(() => "granted", (e: Error) => e.name))).toBe("NotAllowedError");
  expect(await win.evaluate(() => navigator.userAgent)).not.toMatch(/Electron|Agent/);

  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { opened: string[] }).opened = opened;
    shell.openExternal = async (u: string) => void opened.push(u);
  });
  await win.evaluate(() => document.getElementById("out")!.click());
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([`${other.url}/page`]);
  expect(win.url()).toBe(`${site.url}/app`);
  // Only Google's sign-in page stays inside, not every Google page; a link that redirects away opens outside too.
  await win.evaluate(() => document.getElementById("google")!.click());
  await win.evaluate(() => document.getElementById("redirect")!.click());
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([`${other.url}/page`, "https://sites.google.com/view/x", "https://example.com/landing"]);
  await expect(win.locator("h1")).toHaveText("Agent Company");

  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()[0].loadURL(u), `${site.url}/preview`);
  await expect(win.locator("h1")).toHaveText("Agent Company");
  expect(await win.evaluate(() => typeof (window as unknown as { agentDesktop?: unknown }).agentDesktop)).toBe("undefined");

  await app.evaluate(({ BrowserWindow }, u) => BrowserWindow.getAllWindows()[0].loadURL(u), other.url);
  await expect(win.locator("h1")).toHaveText("Somewhere else");
  expect(await win.evaluate(() => typeof (window as unknown as { agentDesktop?: unknown }).agentDesktop)).toBe("undefined");
  await app.close();
  other.close();
  site.close();
});

test("offline: a page with the linked folders and a way back", async () => {
  const app = await launch("http://127.0.0.1:1");
  const win = await app.firstWindow();
  await expect(win.getByRole("heading", { name: "You're offline" })).toBeVisible();
  expect(await win.evaluate(() => (window as unknown as { agentDesktop: { folders(): Promise<unknown[]> } }).agentDesktop.folders())).toEqual([]);
  await expect(win.getByRole("button", { name: "Try again" })).toBeVisible();
  await app.close();
});
