import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { previewEntry, previewType, signPreview, verifyPreview } from "../files/preview.js";
import { loadProject, ProjectParams, requirePath } from "../files/service.js";
import { getBlob } from "../files/store.js";
import { HttpError, requireMember } from "../http.js";

// Previewed pages run in an opaque origin: no app cookies, storage, or parent-page access.
const SANDBOX = {
  "content-security-policy": "sandbox allow-scripts allow-forms",
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
};

export async function previewRoutes(app: FastifyInstance) {
  app.post("/api/workspaces/:id/projects/:pid/preview-token", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const files = await prisma.projectEntry.findMany({ where: { projectId: pid, kind: "file" }, select: { path: true } });
    const entry = previewEntry(files.map((f) => f.path));
    if (!entry) throw new HttpError(404, "no_html", "This project has no HTML file to preview.");
    return { url: `/api/preview/${signPreview(pid)}/${entry.split("/").map(encodeURIComponent).join("/")}`, entry };
  });

  app.get("/api/preview/:token/*", async (req, reply) => {
    const params = req.params as { token: string; "*": string };
    const projectId = verifyPreview(params.token);
    if (!projectId) return reply.code(403).headers(SANDBOX).type("text/html; charset=utf-8").send("<p>This preview link has expired. Open the preview again.</p>");
    const path = requirePath(params["*"]);
    const entry = await prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId, pathLower: path.toLowerCase() } } });
    if (!entry || entry.kind !== "file" || !entry.blobHash) return reply.code(404).headers(SANDBOX).type("text/html; charset=utf-8").send("<p>That file isn't in this project.</p>");
    return reply.headers(SANDBOX).type(previewType(path)).send(await getBlob(entry.blobHash));
  });
}
