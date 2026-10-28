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

test("preview picker opens the requested HTML file and rejects non-HTML or missing paths", async () => {
  const a = await project([["index.html", "<h1>Home</h1>"], ["about.html", "<h1>About</h1>"], ["notes.md", "# Notes"]]);
  const endpoint = `/api/workspaces/${a.id}/projects/${a.pid}/preview-token`;
  const picked = await a.req("POST", endpoint, { path: "about.html" });
  expect(picked.statusCode).toBe(200);
  expect(picked.json().entry).toBe("about.html");
  expect((await app.inject({ method: "GET", url: picked.json().url })).body).toBe("<h1>About</h1>");
  expect((await a.req("POST", endpoint, { path: "notes.md" })).statusCode).toBe(404);
  expect((await a.req("POST", endpoint, { path: "../private.html" })).statusCode).toBe(400);
  expect((await a.req("POST", endpoint, { path: "missing.html" })).statusCode).toBe(404);
});

const reactApp: [string, string][] = [
  ["package.json", JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } })],
  ["index.html", '<div id="root"></div><script type="module" src="/src/main.jsx"></script>'],
  ["src/main.jsx", 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);'],
  ["src/App.jsx", 'export default function App() { return <p>{"</script><b>not markup</b>"}</p>; }'],
];

test("a React or Next.js project previews as a live app: one page that builds it in the browser", async () => {
  const a = await project(reactApp);
  const res = await a.req("POST", `/api/workspaces/${a.id}/projects/${a.pid}/preview-token`);
  expect(res.statusCode).toBe(200);
  // The app wins over its index.html, which can't run without a build.
  expect(res.json().entry).toBe("__app__");
  expect(res.json().url).toMatch(/^\/api\/preview\/[^/]+\/__app__$/);
  const page = await app.inject({ method: "GET", url: res.json().url });
  expect(page.statusCode).toBe(200);
  expect(page.headers["content-type"]).toBe("text/html; charset=utf-8");
  expect(page.headers["content-security-policy"]).toBe("sandbox allow-scripts allow-forms");
  expect(page.body).toContain("https://cdn.jsdelivr.net/npm/esbuild-wasm@0.28.2/esm/browser.min.js");
  expect(page.body).toContain("startPreview(");
  expect(page.body).toContain('"src/App.jsx"');
  // Project files can't end the page's script early: their "<" is escaped.
  expect(page.body.match(/<\/script>/gi)).toHaveLength(2);
  expect(page.body).toContain("\\u003c/script>\\u003cb>not markup");
});

test("an app in a folder previews from that folder; plain sites and non-apps keep their HTML preview", async () => {
  const a = await project([["README.md", "# Shop"], ...reactApp.map(([p, c]): [string, string] => [`shop/${p}`, c]), ["shop/node_modules/x/index.js", "module.exports = 1"]]);
  const res = (await a.req("POST", `/api/workspaces/${a.id}/projects/${a.pid}/preview-token`)).json();
  expect(res.url).toMatch(/\/shop\/__app__$/);
  const page = (await app.inject({ method: "GET", url: res.url })).body;
  expect(page).toContain('"src/main.jsx"');
  expect(page).not.toContain("shop/src/main.jsx");
  expect(page).not.toContain("node_modules");

  const site = await project([["package.json", JSON.stringify({ devDependencies: { prettier: "3.0.0" } })], ["index.html", "<h1>Plain</h1>"]]);
  const endpoint = `/api/workspaces/${site.id}/projects/${site.pid}/preview-token`;
  expect((await site.req("POST", endpoint)).json().entry).toBe("index.html");
  const asked = await site.req("POST", endpoint, { path: "__app__" });
  expect(asked.statusCode).toBe(404);
  expect(asked.json().error.message).toBe("This project isn't a React or Next.js app.");
});
