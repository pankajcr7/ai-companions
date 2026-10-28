import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { credentialsKey } from "../crypto.js";

export const PREVIEW_TTL_MS = 60 * 60 * 1000;

// A separate key derived from CREDENTIALS_KEY, used only for preview links.
const key = () => createHash("sha256").update("project-preview:").update(credentialsKey()).digest();
const mac = (body: string) => createHmac("sha256", key()).update(body).digest();

/** "<base64url(projectId.expiry)>.<hmac>": names one project and expires after an hour. */
export function signPreview(projectId: string, now = Date.now()): string {
  const body = Buffer.from(`${projectId}.${now + PREVIEW_TTL_MS}`).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verifyPreview(token: string, now = Date.now()): string | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const [projectId, expiry] = Buffer.from(body, "base64url").toString("utf8").split(".");
  return projectId && Number(expiry) > now ? projectId : null;
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
};
export const previewType = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** The page a preview opens: the shallowest index.html, else the shallowest HTML file. */
export function previewEntry(paths: string[]): string | null {
  const html = paths.filter((p) => /\.html?$/i.test(p));
  const pick = (list: string[]) => [...list].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] ?? null;
  return pick(html.filter((p) => /(^|\/)index\.html?$/i.test(p))) ?? pick(html);
}

/** The page that builds a React or Next.js app in the browser; it sits in the app's folder, so its files load relative to it. */
export const APP_PAGE = "__app__";
const ESBUILD = "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.28.2";
/** Build output and installed packages: never part of the source the preview builds. */
export const NOT_SOURCE = /(^|\/)(node_modules|\.next|\.git|dist|build|out|\.vercel|coverage)\//;
/** Source the browser build reads; other files (pictures, fonts) are only listed, and load by address. */
export const APP_SOURCE = /\.(tsx?|jsx?|mjs|cjs|json|css|html?)$/i;
export const APP_SOURCE_CAP = 5 * 1024 * 1024;

/** The folder ("" or "shop/") of the shallowest package.json that uses React or Next.js, or null. */
export function appRoot(packages: { path: string; json: string }[]): string | null {
  const depth = (p: string) => p.split("/").length;
  for (const pkg of [...packages].sort((a, b) => depth(a.path) - depth(b.path))) {
    if (NOT_SOURCE.test(pkg.path)) continue;
    try {
      const j = JSON.parse(pkg.json) as { dependencies?: object; devDependencies?: object };
      const deps = { ...j.devDependencies, ...j.dependencies };
      if ("react" in deps || "next" in deps) return pkg.path.slice(0, -"package.json".length);
    } catch {
      // Not valid JSON: not an app we can build.
    }
  }
  return null;
}

let builder: string | null = null;
/** The runner page: the project's files as data, and the builder, which loads esbuild-wasm and builds them. */
export function appPage(files: Record<string, string>): string {
  builder ??= readFileSync(new URL("./app-builder.js", import.meta.url), "utf8");
  // "<" escaped, so no file can end the page's script early.
  const data = JSON.stringify(files).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview</title>
<style>#__preview_status{position:fixed;inset:0;display:grid;place-items:center;background:#fff;color:#5b6270;font:500 15px/1.5 system-ui,sans-serif;text-align:center;padding:24px}</style></head>
<body><div id="__preview_status">Building your app…<br><small>The first preview takes a few seconds.</small></div>
<script type="application/json" id="__preview_files">${data}</script>
<script type="module">
import * as esbuild from "${ESBUILD}/esm/browser.min.js";
${builder}
startPreview({ esbuild, wasmURL: "${ESBUILD}/esbuild.wasm", files: JSON.parse(document.getElementById("__preview_files").textContent), assetBase: new URL("./", location.href).href });
</script></body></html>`;
}
