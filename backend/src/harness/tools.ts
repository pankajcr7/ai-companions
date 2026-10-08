import { z } from "zod";
import { prisma } from "../db.js";
import type { Project, ProjectEntry } from "../generated/prisma/client.js";
import { requirePath } from "../files/service.js";
import { exclusionReason } from "../files/rules.js";
import type { Loaded } from "../goals/context.js";
import { loadText } from "../goals/load.js";
import { HttpError } from "../http.js";
import { ToolError, type Tool } from "./loop.js";
import { openUrl, tavilySearch, untrusted } from "./web.js";

export type Write = { path: string; content: string; note: string; baseRevision: number };
export const READ_CHARS = 20_000;
const LIST_MAX = 300;
const SEARCH_HITS = 50;
const SEARCH_FILE_MAX = 200_000;
// ponytail: linear scan over at most 5 MB of text per search; index file contents if projects outgrow it.
const SEARCH_SCAN_MAX = 5_000_000;

function cleanPath(raw: string): string {
  try {
    const path = requirePath(raw);
    const excluded = exclusionReason(path, "file");
    if (excluded) throw new ToolError(`That path isn't allowed in projects: ${excluded}`);
    return path;
  } catch (e) {
    if (e instanceof HttpError) throw new ToolError(e.message);
    throw e;
  }
}
const folder = (raw: string | undefined) => (raw ? cleanPath(raw.replace(/\/+$/, "")) : "");
const under = (e: ProjectEntry, dir: string) => !dir || e.pathLower.startsWith(`${dir.toLowerCase()}/`);

export function projectTools(project: Project, o: { write: ((w: Write) => Promise<string>) | null; read: Map<string, Loaded> }): Tool[] {
  let cache: Promise<ProjectEntry[]> | null = null;
  const entries = () => (cache ??= prisma.projectEntry.findMany({ where: { projectId: project.id }, orderBy: { path: "asc" } }));
  const fileAt = async (raw: string) => {
    const path = cleanPath(raw);
    const e = (await entries()).find((x) => x.pathLower === path.toLowerCase());
    return { path, e };
  };

  const tools: Tool[] = [
    {
      name: "list_files",
      purpose: "Lists the folders and files in the project (or one folder of it), with sizes.",
      argsHelp: '{"path"?: folder}',
      args: z.object({ path: z.string().max(500).optional() }),
      label: (a) => a.path || "project",
      run: async (a) => {
        const dir = folder(a.path);
        const rows = (await entries()).filter((e) => under(e, dir));
        if (!rows.length) return dir ? `No files under ${dir}.` : "The project is empty.";
        const lines = rows.slice(0, LIST_MAX).map((e) => (e.kind === "dir" ? `${e.path}/` : `${e.path} (${e.size} B${e.isText ? "" : ", binary"})`));
        return rows.length > LIST_MAX ? `${lines.join("\n")}\n... and ${rows.length - LIST_MAX} more` : lines.join("\n");
      },
    },
    {
      name: "read_file",
      purpose: `Reads a project file, ${READ_CHARS} characters at a time.`,
      argsHelp: '{"path": file, "offset"?: number}',
      args: z.object({ path: z.string().min(1).max(500), offset: z.number().int().min(0).optional() }),
      label: (a) => a.path,
      run: async (a) => {
        const { path, e } = await fileAt(a.path);
        if (!e || e.kind !== "file" || !e.blobHash) throw new ToolError(`There is no file at ${path}. Use list_files to see what exists.`);
        if (!e.isText) return `${e.path} is a binary file (${Math.ceil(e.size / 1024)} KB) and can't be read as text.`;
        const text = await loadText(e.blobHash);
        o.read.set(e.pathLower, { path: e.path, revision: e.revision, content: text });
        const from = a.offset ?? 0;
        const piece = text.slice(from, from + READ_CHARS);
        return from + READ_CHARS < text.length ? `${piece}\n[truncated — continue with offset ${from + READ_CHARS}]` : piece;
      },
    },
    {
      name: "search",
      purpose: "Finds lines containing some text (not case-sensitive) across the project's text files.",
      argsHelp: '{"query": text, "path"?: folder}',
      args: z.object({ query: z.string().trim().min(2).max(200), path: z.string().max(500).optional() }),
      label: (a) => `“${a.query}”`,
      run: async (a, signal) => {
        const dir = folder(a.path);
        const needle = a.query.toLowerCase();
        const hits: string[] = [];
        let scanned = 0;
        for (const e of (await entries()).filter((x) => x.kind === "file" && x.isText && x.blobHash && x.size <= SEARCH_FILE_MAX && under(x, dir))) {
          if (hits.length >= SEARCH_HITS || scanned > SEARCH_SCAN_MAX || signal.aborted) break;
          scanned += e.size;
          const lines = (await loadText(e.blobHash!)).split("\n");
          for (let i = 0; i < lines.length && hits.length < SEARCH_HITS; i++) if (lines[i].toLowerCase().includes(needle)) hits.push(`${e.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
        return hits.length ? hits.join("\n") : "No matches.";
      },
    },
  ];
  if (o.write) {
    const write = o.write;
    tools.push({
      name: "write_file",
      purpose: "Creates or replaces a whole project file. The owner may need to approve it.",
      argsHelp: '{"path": file, "content": the complete file, "note"?: why}',
      args: z.object({ path: z.string().min(1).max(500), content: z.string().max(1_000_000), note: z.string().max(500).optional() }),
      label: (a) => a.path,
      finishOnStop: true,
      run: async (a) => {
        const { path, e } = await fileAt(a.path);
        if (e && (e.kind !== "file" || !e.isText)) throw new ToolError(`${path} is a folder or a binary file and can't be written.`);
        try {
          return await write({ path: e?.path ?? path, content: a.content, note: a.note ?? "", baseRevision: e?.revision ?? 0 });
        } finally {
          cache = null;
        }
      },
    });
  }
  return tools;
}

export function webTools(searchKey: string | null): Tool[] {
  const tools: Tool[] = [
    {
      name: "open_url",
      purpose: "Opens a public web page and returns its text.",
      argsHelp: '{"url": "https://..."}',
      args: z.object({ url: z.string().url().max(2000) }),
      label: (a) => {
        try {
          return new URL(a.url).host;
        } catch {
          return a.url.slice(0, 60);
        }
      },
      run: (a, signal) => openUrl(a.url, signal),
    },
  ];
  if (searchKey) {
    tools.push({
      name: "web_search",
      purpose: "Searches the web and returns the top 5 results.",
      argsHelp: '{"query": text}',
      args: z.object({ query: z.string().trim().min(2).max(300) }),
      label: (a) => `“${a.query}”`,
      run: async (a, signal) => {
        const results = await tavilySearch(searchKey, a.query, signal);
        return untrusted(results.length ? results.map((r) => `${r.title} — ${r.url} — ${r.content}`).join("\n") : "No results.");
      },
    });
  }
  return tools;
}
