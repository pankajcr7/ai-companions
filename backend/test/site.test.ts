import { afterAll, expect, test } from "vitest";
import { studyWebsite } from "../src/harness/site.js";
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
