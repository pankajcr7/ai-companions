import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { APP_PAGE, APP_SOURCE, APP_SOURCE_CAP, appPage, appRoot, NOT_SOURCE, previewEntry, previewType, signPreview, verifyPreview } from "../files/preview.js";
import { loadProject, ProjectParams, requirePath } from "../files/service.js";
import { findEntry, listEntries, readBytes, readText } from "../files/source.js";
import type { Project } from "../generated/prisma/client.js";
import { HttpError, requireMember } from "../http.js";

// Previewed pages run in an opaque origin: no app cookies, storage, or parent-page access.
const SANDBOX = {
  "content-security-policy": "sandbox allow-scripts allow-forms",
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
};

const at = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** The folder of the project's React or Next.js app, from its package.json files, or null. */
async function findApp(project: Project, files: { path: string; blobHash: string | null }[]) {
  const packages = files.filter((f) => /(^|\/)package\.json$/.test(f.path) && f.blobHash).slice(0, 8);
  return appRoot(await Promise.all(packages.map(async (f) => ({ path: f.path, json: await readText(project, f) }))));
}

export async function previewRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/projects/:pid/preview-token", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id);
    const project = await loadProject(id, pid, user.id);
    const files = (await listEntries(project)).filter((e) => e.kind === "file");
    const requested = (req.body as { path?: unknown } | undefined)?.path;
    // A React or Next.js app opens as a live app, unless a particular HTML file was asked for.
    if (requested === undefined || requested === APP_PAGE) {
      const root = await findApp(project, files);
      if (root !== null) return { url: `/api/preview/${signPreview(pid)}/${at(root + APP_PAGE)}`, entry: APP_PAGE };
      if (requested === APP_PAGE) throw new HttpError(404, "not_app", "This project isn't a React or Next.js app.");
    }
    const path = typeof requested === "string" ? requirePath(requested) : null;
    const entry = path ? files.find((f) => f.path.toLowerCase() === path.toLowerCase() && /\.html?$/i.test(f.path))?.path : previewEntry(files.map((f) => f.path));
    if (!entry) throw new HttpError(404, "no_html", "This project has no HTML file to preview.");
    return { url: `/api/preview/${signPreview(pid)}/${at(entry)}`, entry };
  });

  app.get("/api/preview/:token/*", async (req, reply) => {
    const params = req.params as { token: string; "*": string };
    const projectId = verifyPreview(params.token);
    if (!projectId) return reply.code(403).headers(SANDBOX).type("text/html; charset=utf-8").send("<p>This preview link has expired. Open the preview again.</p>");
    const path = requirePath(params["*"]);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return reply.code(404).headers(SANDBOX).type("text/html; charset=utf-8").send("<p>This project no longer exists.</p>");
    if (path === APP_PAGE || path.endsWith(`/${APP_PAGE}`)) return reply.headers(SANDBOX).type("text/html; charset=utf-8").send(await appRunner(project, path.slice(0, -APP_PAGE.length)));
    // A folder on the owner's computer holds more than a site: its preview link reaches web files only.
    const entry = project.deviceId && previewType(path) === "application/octet-stream" ? null : await findEntry(project, path);
    if (!entry || entry.kind !== "file" || !entry.blobHash) return reply.code(404).headers(SANDBOX).type("text/html; charset=utf-8").send("<p>That file isn't in this project.</p>");
    return reply.headers(SANDBOX).type(previewType(path)).send(await readBytes(project, entry));
  });
}

/** The app page for the app in root ("" or "shop/"): its source as data (other files listed, empty), for the browser to build. */
async function appRunner(project: Project, root: string) {
  const entries = (await listEntries(project)).filter((e) => e.kind === "file" && e.path.startsWith(root) && e.blobHash && !NOT_SOURCE.test(e.path.slice(root.length)));
  const source = entries.filter((e) => APP_SOURCE.test(e.path));
  if (source.reduce((n, e) => n + e.size, 0) > APP_SOURCE_CAP) return "<p>This app is too big to preview here: its source is over 5 MB. Download it to run it.</p>";
  const files: Record<string, string> = {};
  for (const e of entries) files[e.path.slice(root.length)] = "";
  // All at once: a folder on the computer answers each read through the app.
  const texts = await Promise.all(source.map((e) => readText(project, e)));
  source.forEach((e, i) => (files[e.path.slice(root.length)] = texts[i]));
  return appPage(files);
}
