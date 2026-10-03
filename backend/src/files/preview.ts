import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
