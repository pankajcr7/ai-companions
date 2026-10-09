import { z } from "zod";
import { prisma } from "../db.js";
import type { Attachment, Project, ProjectEntry } from "../generated/prisma/client.js";
import { getBlob } from "../files/store.js";
import { detect, type Kind } from "../attachments/detect.js";
import { extractText } from "../attachments/extract.js";
import { imageFits } from "../attachments/parts.js";
import { LIMITS } from "../files/rules.js";
import { requirePath } from "../files/service.js";
import { exclusionReason } from "../files/rules.js";
import type { Loaded } from "../goals/context.js";
import { loadText } from "../goals/load.js";
import { HttpError } from "../http.js";
import { ToolError, type Tool } from "./loop.js";
import { openUrl, tavilySearch, untrusted } from "./web.js";

const DOC_EXT = /\.(pdf|docx|xlsx|pptx)$/i;
// ponytail: per-process cache of document text by blob, oldest out past 50; move to a column if documents get large or many.
const docCache = new Map<string, string>();
async function documentText(hash: string, kind: Kind, mime: string, data: Buffer): Promise<string> {
  const hit = docCache.get(hash);
  if (hit !== undefined) return hit;
  const text = (await extractText(kind, mime, data)).text ?? "";
  docCache.set(hash, text);
  if (docCache.size > 50) docCache.delete(docCache.keys().next().value!);
  return text;
}

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
        let text: string;
        if (e.isText) text = await loadText(e.blobHash);
        else {
          // Images come back as pictures; PDF and Office files as their text; anything else stays unreadable.
          const data = await getBlob(e.blobHash);
          const type = detect(e.path, data);
          if (type?.kind === "image") {
            if (!imageFits(e.size)) return `${e.path} is an image too large to show (${(e.size / 1024 / 1024).toFixed(1)} MB).`;
            return { text: `${e.path} (image, ${Math.ceil(e.size / 1024)} KB)`, images: [{ mime: type.mime, data: data.toString("base64") }] };
          }
          const doc = type && (type.kind === "pdf" || type.kind === "office") ? await documentText(e.blobHash, type.kind, type.mime, data) : null;
          if (doc === null) return `${e.path} is a binary file (${Math.ceil(e.size / 1024)} KB) and can't be read as text.`;
          if (!doc) return `${e.path} has no readable text (it may be a scanned document).`;
          text = doc;
        }
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
        const searchable = (x: ProjectEntry) => x.kind === "file" && !!x.blobHash && under(x, dir) && (x.isText ? x.size <= SEARCH_FILE_MAX : DOC_EXT.test(x.path) && x.size <= LIMITS.maxFileBytes);
        for (const e of (await entries()).filter(searchable)) {
          if (hits.length >= SEARCH_HITS || scanned > SEARCH_SCAN_MAX || signal.aborted) break;
          let body: string;
          if (e.isText) body = await loadText(e.blobHash!);
          else {
            const data = await getBlob(e.blobHash!);
            const type = detect(e.path, data);
            body = type && (type.kind === "pdf" || type.kind === "office") ? ((await documentText(e.blobHash!, type.kind, type.mime, data)) ?? "") : "";
          }
          scanned += body.length;
          const lines = body.split("\n");
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

/** The chat's attached files: list them, and read any one again (text in pages, images as pictures). */
export function attachmentTools(atts: Attachment[]): Tool[] {
  const find = (name: string) => {
    const a = atts.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!a) throw new ToolError(`There is no attachment called ${name}. Use list_attachments to see them.`);
    return a;
  };
  return [
    {
      name: "list_attachments",
      purpose: "Lists the files the owner attached in this chat.",
      argsHelp: "{}",
      args: z.object({}).passthrough(),
      label: () => "attachments",
      run: async () => atts.map((a) => `${a.name} (${a.kind}, ${Math.max(1, Math.round(a.size / 1024))} KB${a.pages ? `, ${a.pages} pages` : ""}${a.scanned ? ", scanned, no text" : ""})`).join("\n") || "No files are attached in this chat.",
    },
    {
      name: "read_attachment",
      purpose: `Reads an attached file, ${READ_CHARS} characters at a time; an image comes back as a picture.`,
      argsHelp: '{"name": file name, "offset"?: number}',
      args: z.object({ name: z.string().min(1).max(300), offset: z.number().int().min(0).optional() }),
      label: (a) => a.name,
      run: async (a) => {
        const att = find(a.name);
        if (att.kind === "image") {
          const data = await getBlob(att.viewHash ?? att.blobHash);
          if (!imageFits(data.length)) return `${att.name} is an image too large to show (${(data.length / 1024 / 1024).toFixed(1)} MB).`;
          return { text: `${att.name} (image)`, images: [{ mime: att.viewMime ?? att.mime, data: data.toString("base64") }] };
        }
        const text = att.text ?? "";
        if (!text) return `${att.name} has no readable text${att.scanned ? " (it looks like a scanned document)" : ""}.`;
        const from = a.offset ?? 0;
        const piece = text.slice(from, from + READ_CHARS);
        return from + READ_CHARS < text.length ? `${piece}\n[truncated — continue with offset ${from + READ_CHARS}]` : piece;
      },
    },
  ];
}
