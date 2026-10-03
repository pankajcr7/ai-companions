import { afterAll, expect, test, vi } from "vitest";
import { PREVIEW_TTL_MS, previewEntry, previewType, signPreview, verifyPreview } from "../src/files/preview.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { multipart } from "./upload-helpers.js";

vi.setConfig({ testTimeout: 240_000 });
const app = await makeApp();
afterAll(() => app.close());

test("tokens round-trip, expire, and can't be altered", () => {
  const t = signPreview("proj1", 1_000);
  expect(verifyPreview(t, 2_000)).toBe("proj1");
  expect(verifyPreview(t, 1_000 + PREVIEW_TTL_MS + 1)).toBeNull();
  const [body, mac] = t.split(".");
  expect(verifyPreview(`${Buffer.from("proj2.9999999999999").toString("base64url")}.${mac}`, 2_000)).toBeNull();
  expect(verifyPreview(`${body}.${mac.slice(0, -2)}xx`, 2_000)).toBeNull();
  expect(verifyPreview("junk", 2_000)).toBeNull();
});

test("entry is the shallowest index.html, else the shallowest html file", () => {
  expect(previewEntry(["site/index.html", "index.html", "a/b/index.html"])).toBe("index.html");
  expect(previewEntry(["docs/readme.md", "site/about.html", "site/x/index.html"])).toBe("site/x/index.html");
  expect(previewEntry(["docs/readme.md", "site/about.html", "a/b/contact.html"])).toBe("site/about.html");
  expect(previewEntry(["a.md"])).toBeNull();
  expect(previewType("a/b.css")).toBe("text/css; charset=utf-8");
  expect(previewType("x.unknown")).toBe("application/octet-stream");
});

async function project(files: [string, string][]) {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Preview Co", template: "head-only" })).json().id as string;
  const body = multipart({ name: `P${Math.random()}`, source: "folder" }, files.map(([p, c]) => [p, p.split("/").pop()!, c]));
  const pid = (await app.inject({ method: "POST", url: `/api/workspaces/${id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie, origin: ORIGIN } })).json().projectId as string;
  return { req, id, pid, cookie };
}

test("members get a preview link that serves the project's files in a sandbox", async () => {
  const a = await project([["site/index.html", '<link rel="stylesheet" href="style.css"><h1>Crumb</h1>'], ["site/style.css", "h1{color:brown}"]]);
  const res = await a.req("POST", `/api/workspaces/${a.id}/projects/${a.pid}/preview-token`);
  expect(res.statusCode).toBe(200);
  const { url, entry } = res.json();
  expect(entry).toBe("site/index.html");
  expect(url).toMatch(/^\/api\/preview\/[^/]+\/site\/index\.html$/);
  const page = await app.inject({ method: "GET", url });
  expect(page.statusCode).toBe(200);
  expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
  expect(page.headers["content-security-policy"]).toBe("sandbox allow-scripts allow-forms");
  expect(page.headers["x-content-type-options"]).toBe("nosniff");
  expect(page.body).toContain("<h1>Crumb</h1>");
  const css = await app.inject({ method: "GET", url: url.replace("index.html", "style.css") });
  expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
  expect(css.body).toBe("h1{color:brown}");
  expect((await app.inject({ method: "GET", url: url.replace("index.html", "missing.png") })).statusCode).toBe(404);
  expect((await app.inject({ method: "GET", url: url.replace("site/index.html", "..%2F..%2Fetc%2Fpasswd") })).statusCode).toBe(400);
});

test("tokens are per project; bad and expired links get 403; projects without HTML get 404; other workspaces can't ask", async () => {
  const a = await project([["index.html", "<h1>A</h1>"]]);
  const b = await project([["secret.html", "<h1>B secret</h1>"]]);
  const { url } = (await a.req("POST", `/api/workspaces/${a.id}/projects/${a.pid}/preview-token`)).json();
  const token = url.split("/")[3];
  const crossed = await app.inject({ method: "GET", url: `/api/preview/${token}/secret.html` });
  expect(crossed.statusCode).toBe(404);
  expect(crossed.body).not.toContain("B secret");
  const bad = await app.inject({ method: "GET", url: `/api/preview/${token.slice(0, -3)}abc/index.html` });
  expect(bad.statusCode).toBe(403);
  const expired = signPreview(a.pid, Date.now() - PREVIEW_TTL_MS - 1000);
  const old = await app.inject({ method: "GET", url: `/api/preview/${expired}/index.html` });
  expect(old.statusCode).toBe(403);
  expect(old.body).toContain("Open the preview again");
  const c = await project([["notes.md", "# hi"]]);
  const none = await c.req("POST", `/api/workspaces/${c.id}/projects/${c.pid}/preview-token`);
  expect(none.statusCode).toBe(404);
  expect(none.json().error.message).toBe("This project has no HTML file to preview.");
  expect((await b.req("POST", `/api/workspaces/${a.id}/projects/${a.pid}/preview-token`)).statusCode).toBe(404);
});
