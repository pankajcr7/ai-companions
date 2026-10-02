// Shared upload rules. The browser keeps an identical copy in frontend/src/lib/file-rules.ts (parity tested).
export const LIMITS = {
  maxEntries: 2000,
  maxTotalBytes: 50 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxEditorBytes: 1024 * 1024,
  maxPathLength: 1024,
  maxDepth: 32,
};

export const EXCLUDED_DIRS = [
  "node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache",
  "coverage", "__pycache__", ".venv", "venv", "target", ".gradle", ".idea",
];
export const KEEP_FILES = [".env.example", ".env.sample"];
export const EXCLUDED_FILES = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /^id_(rsa|ed25519)/i,
  /^(credentials\.json|\.npmrc|\.pypirc|\.netrc)$/i,
];
export const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

const bytes = (s: string) => new TextEncoder().encode(s).length;

export function normalizePath(raw: string): PathCheck {
  const p = raw.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (!p) return { ok: false, reason: "empty path" };
  if (/[\u0000-\u001f\u007f]/.test(p)) return { ok: false, reason: "name contains control characters" };
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return { ok: false, reason: "absolute paths aren't allowed" };
  const segs = p.split("/");
  if (segs.some((s) => s === "" || s === "." || s === "..")) return { ok: false, reason: "invalid path segment" };
  if (segs.some((s) => bytes(s) > 255)) return { ok: false, reason: "a name is too long" };
  if (p.length > LIMITS.maxPathLength) return { ok: false, reason: "path is too long" };
  if (segs.length > LIMITS.maxDepth) return { ok: false, reason: "folders are nested too deep" };
  return { ok: true, path: segs.join("/") };
}

export function exclusionReason(path: string, kind: "file" | "dir"): string | null {
  const segs = path.split("/");
  const dirs = kind === "dir" ? segs : segs.slice(0, -1);
  const dir = dirs.find((d) => EXCLUDED_DIRS.includes(d));
  if (dir) return `${dir} folders are excluded`;
  if (kind === "dir") return null;
  const name = segs.at(-1)!;
  if (name === ".DS_Store") return "system file";
  if (KEEP_FILES.includes(name.toLowerCase())) return null;
  if (EXCLUDED_FILES.some((r) => r.test(name))) return "secret or credential file";
  return null;
}

export function parentDirs(path: string): string[] {
  const segs = path.split("/");
  return segs.slice(0, -1).map((_, i) => segs.slice(0, i + 1).join("/"));
}
