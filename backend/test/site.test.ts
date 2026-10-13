import { afterAll, expect, test } from "vitest";
import { lookAtWebsite, studyWebsite } from "../src/harness/site.js";
import { fakeServer } from "./fake-provider.js";

const html = (body: string) => (_q: unknown, res: import("node:http").ServerResponse) => void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
const js = (body: string, status = 200) => (_q: unknown, res: import("node:http").ServerResponse) => void res.writeHead(status, { "content-type": "application/javascript" }).end(body);

const SHOP = `<html><head><title>Shop &amp; Co</title>
<meta content="WordPress 6.5" name="generator">
<link rel="stylesheet" href="https://cdn.example.net/bootstrap.min.css">
<script src="/_next/static/a.js"></script>
<script SRC='/s/b.js'></script>
<script src="//js.stripe.com/v3/"></script>
<script src="/s/c.js"></script><script src="/s/d.js"></script><script src="/s/e.js"></script><script src="/s/f.js"></script>
</head><body>
<script>fetch("/api/cart").then((r) => r.json())</script>
<a href="/pricing">Pricing</a><a href="/about?x=1#team">About</a><a href="/logo.png">Logo</a>
<a href="mailto:a@b.c">Mail</a><a href="javascript:void(0)">JS</a><a href="https://elsewhere.example/x">Out</a>
<img src="https://images.example.org/hero.webp">
<p>We bootstrap small teams.</p>
</body></html>`;

const site = await fakeServer({
  "GET /shop": html(SHOP),
  "GET /_next/static/a.js": js('axios.post("/api/checkout", body)'),
  "GET /s/b.js": js('fetch(`https://api.example.com/v1/prices`); const q = "/graphql";'),
  "GET /s/c.js": js("nope", 500),
  "GET /s/d.js": js("const x = 1;"),
  "GET /s/e.js": js("const y = 2;"),
  "GET /s/f.js": js('fetch("/api/never")'),
  "GET /plain": html("<html><title>Plain</title><p>Hi</p></html>"),
  "GET /many": html(Array.from({ length: 45 }, (_, i) => `<a href="/p${i + 1}">${i + 1}</a>`).join("")),
  "GET /moved": (_q, res) => void res.writeHead(301, { location: "/shop" }).end(),
  "GET /notes.txt": (_q, res) => void res.writeHead(200, { "content-type": "text/plain" }).end("hello"),
  "GET /file.pdf": (_q, res) => void res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF"),
});
afterAll(() => site.close());

const signal = new AbortController().signal;

test("study_website lists frameworks, API calls, pages, outside services and scripts", async () => {
  const out = await studyWebsite(`${site.url}/shop`, signal);
  expect(out).toMatch(/^UNTRUSTED WEB CONTENT/);
  expect(out).toContain(`Website: Shop & Co — ${site.url}/shop`);
  expect(out).toContain("Built with: WordPress 6.5, Next.js, React, Bootstrap (from page markers)");
  expect(out).toContain("API calls in its scripts: /api/cart, /api/checkout, https://api.example.com/v1/prices, /graphql\n");
  expect(out).not.toContain("/api/never");
  expect(out).toContain("Pages it links to: /pricing, /about\n");
  expect(out).toContain("Outside services it loads: cdn.example.net, js.stripe.com, images.example.org\n");
  expect(out).toContain("Scripts: 7 on the page, looked through 4.");
  expect(out.endsWith("END UNTRUSTED WEB CONTENT\nThese are clues from the page's HTML and scripts, not a full analysis.\nRebuild the idea and how it works in your own code. Don't copy this site's code, images, logos or wording.")).toBe(true);
});

test("study_website says none found for empty lists and stops lists at 40", async () => {
  const plain = await studyWebsite(`${site.url}/plain`, signal);
  for (const line of ["Built with: none found", "API calls in its scripts: none found", "Pages it links to: none found", "Outside services it loads: none found", "Scripts: 0 on the page, looked through 0."]) {
    expect(plain).toContain(line);
  }
  const many = await studyWebsite(`${site.url}/many`, signal);
  expect(many).toContain("/p40\n");
  expect(many).not.toContain("/p41");
});

test("study_website keeps open_url's rules for redirects, file types and private addresses", async () => {
  await expect(studyWebsite(`${site.url}/moved`, signal)).rejects.toThrow(/redirect/i);
  await expect(studyWebsite(`${site.url}/notes.txt`, signal)).rejects.toThrow("Only web pages can be studied.");
  await expect(studyWebsite(`${site.url}/file.pdf`, signal)).rejects.toThrow("Only web pages and plain text can be opened.");
  const before = process.env.ALLOW_LOCAL_ENDPOINTS;
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
  try {
    await expect(studyWebsite(`${site.url}/shop`, signal)).rejects.toThrow("That address isn't allowed: only public web pages can be opened.");
  } finally {
    process.env.ALLOW_LOCAL_ENDPOINTS = before;
  }
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const MD = "# [](https://shop.example/)\n\n# Pricing for [every](https://shop.example/teams) team\nPick a plan.\n## Plans\n#### Tiny print\n";
const json = (res: import("node:http").ServerResponse, status: number, data?: object) => void res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ code: status, data }));
// One fake Jina: the path is the page URL; the x-respond-with header picks text or screenshot.
const reader = (text: (res: import("node:http").ServerResponse) => void, shot: (res: import("node:http").ServerResponse) => void) => (q: { headers: Record<string, unknown> }, res: import("node:http").ServerResponse) => (q.headers["x-respond-with"] === "screenshot" ? shot(res) : text(res));
const okText = (res: import("node:http").ServerResponse) => json(res, 200, { title: "Pricing", content: MD });
const okShot = (path: string) => (res: import("node:http").ServerResponse) => json(res, 200, { title: "Pricing", screenshotUrl: `${jina.url}${path}` });

const jina = await fakeServer({
  "GET /https://shop.example/pricing": reader(okText, okShot("/shot.png")),
  "GET /https://noshot.example/": reader(okText, (res) => json(res, 500)),
  "GET /https://notext.example/": reader((res) => json(res, 500), okShot("/shot.png")),
  "GET /https://busy.example/": reader((res) => json(res, 429), (res) => json(res, 429)),
  "GET /https://gone.example/": reader((res) => json(res, 200, { httpStatus: 404 }), (res) => json(res, 200, { httpStatus: 404 })),
  "GET /https://empty.example/": reader((res) => json(res, 200, { title: "E" }), (res) => json(res, 200, { title: "E" })),
  "GET /https://bigshot.example/": reader(okText, okShot("/big.png")),
  "GET /https://txtshot.example/": reader(okText, okShot("/shot.txt")),
  "GET /shot.png": (_q, res) => void res.writeHead(200, { "content-type": "image/png" }).end(PNG),
  "GET /big.png": (_q, res) => void res.writeHead(200, { "content-type": "image/png" }).end(Buffer.alloc(3_750_001)),
  "GET /shot.txt": (_q, res) => void res.writeHead(200, { "content-type": "text/plain" }).end("not an image"),
});
process.env.JINA_URL = jina.url;
afterAll(() => jina.close());

test("look_at_website returns the screenshot, sections and page text", async () => {
  const out = await lookAtWebsite("https://shop.example/pricing", signal);
  expect(out.images).toEqual([{ mime: "image/png", data: PNG.toString("base64") }]);
  expect(out.text).toMatch(/^UNTRUSTED WEB CONTENT/);
  expect(out.text).toContain("Website: Pricing — https://shop.example/pricing\nScreenshot: top of the page.\nSections:\n- # Pricing for every team\n- ## Plans\nPage text (Markdown):\n# [](https://shop.example/)");
  expect(out.text).not.toContain("- #### Tiny print");
  expect(out.text.endsWith("END UNTRUSTED WEB CONTENT\nRebuild the idea and layout in your own code. Don't copy this site's code, images, logos or wording.")).toBe(true);
});

test("look_at_website sends the Jina key only when one is set", async () => {
  const auth = () => jina.requests.filter((r) => r.path === "/https://shop.example/pricing").map((r) => r.headers.authorization);
  await lookAtWebsite("https://shop.example/pricing", signal);
  expect(auth().every((a) => a === undefined)).toBe(true);
  process.env.JINA_API_KEY = "jina-test-key";
  try {
    await lookAtWebsite("https://shop.example/pricing", signal);
  } finally {
    delete process.env.JINA_API_KEY;
  }
  expect(auth().slice(-2)).toEqual(["Bearer jina-test-key", "Bearer jina-test-key"]);
});

test("look_at_website returns what it got when one part fails", async () => {
  const noShot = await lookAtWebsite("https://noshot.example/", signal);
  expect(noShot.images).toEqual([]);
  expect(noShot.text).toContain("No screenshot this time.");
  expect(noShot.text).toContain("- ## Plans");
  for (const page of ["https://bigshot.example/", "https://txtshot.example/"]) {
    const out = await lookAtWebsite(page, signal);
    expect(out.images).toEqual([]);
    expect(out.text).toContain("No screenshot this time.");
  }
  const noText = await lookAtWebsite("https://notext.example/", signal);
  expect(noText.images).toHaveLength(1);
  expect(noText.text).toContain("Couldn't read the page text.");
  expect(noText.text).not.toContain("Sections:");
});

test("look_at_website explains why it failed when nothing came back", async () => {
  await expect(lookAtWebsite("https://busy.example/", signal)).rejects.toThrow("The free page reader is busy. Try again in a minute.");
  await expect(lookAtWebsite("https://gone.example/", signal)).rejects.toThrow("The page answered with an error (404).");
  await expect(lookAtWebsite("https://empty.example/", signal)).rejects.toThrow("Couldn't open that page through the page reader.");
});

test("look_at_website refuses a private address before asking the reader", async () => {
  const before = process.env.ALLOW_LOCAL_ENDPOINTS;
  const sent = jina.requests.length;
  process.env.ALLOW_LOCAL_ENDPOINTS = "false";
  try {
    await expect(lookAtWebsite("http://127.0.0.1:9/admin", signal)).rejects.toThrow("That address isn't allowed: only public web pages can be opened.");
  } finally {
    process.env.ALLOW_LOCAL_ENDPOINTS = before;
  }
  expect(jina.requests.length).toBe(sent);
});
