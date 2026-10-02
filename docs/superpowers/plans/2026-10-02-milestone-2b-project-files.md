# Milestone 2b: Projects, File Upload, and Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects inside a company: upload a folder, ZIP, or files (with preview and safety rules), browse the tree, edit text files in CodeMirror with versioned saves and conflict detection, manage files and folders, view history and restore, and download files or the whole project as a ZIP.

**Architecture:** Content-addressed blobs on local disk (`files/store.ts`, the only storage module), file metadata and versions in Postgres, pure path/exclusion rules shared in spirit by browser and server (`files/rules.ts` and a frontend copy kept identical by a parity test), safe streaming ZIP read and ZIP write with `fflate`, multipart batch uploads with `@fastify/multipart`, and a CodeMirror 6 editor in the browser.

**Tech Stack:** Existing stack plus `@fastify/multipart` 10, `fflate` 0.8, CodeMirror 6 (`codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/lang-javascript|json|html|css|markdown|python`, `@codemirror/theme-one-dark`).

**Spec:** `docs/superpowers/specs/2026-10-02-milestone-2b-project-files-design.md`

## Global Constraints

- Branch `milestone-1`. Backend relative imports end in `.js`. Run backend commands from `backend/`.
- Limits: 2,000 entries per project, 50 MB total per project, 10 MB per file, 1 MB for in-editor text, path ≤ 1,024 chars, depth ≤ 32, segment ≤ 255 bytes.
- Nothing uploaded is executed or rendered as HTML. Inline display only for PNG, JPEG, GIF, WebP. All file responses: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`.
- Storage paths come only from SHA-256 hashes, never from user paths. No filesystem symlinks are ever created.
- Roles: viewer browse/download; member upload/edit/create/move/delete entries and create/rename projects; owner/admin delete projects.
- Every route checks workspace membership; project IDs from another workspace return 404.
- Rate limits keyed by `perUser`: uploads 30/min, saves 60/min.
- No em-dashes in user-facing copy.

## Review Focus

1. **Uploading into a project that already has a file at that path (any letter case)**: skipped with "already exists", never overwritten or duplicated. Test in Task 4.
2. **Two people editing the same file**: the second save gets 409 and keeps their text on screen, not lost. Test in Task 5 (backend) and Task 7 (UI keeps editor content).
3. **Renaming a folder into its own subfolder or onto an existing path**: rejected with a clear message, tree unchanged. Test in Task 5.
4. **A ZIP whose declared sizes lie (bomb) or that is corrupt**: clear error, nothing written, no memory blow-up beyond the limit. Test in Task 2.
5. **Cancel or failure on the first batch of a new-project upload**: no empty project left behind. Test in Task 4.

---

## File Map

```
backend/
  prisma/schema.prisma            + Project, ProjectEntry, FileRevision, ProjectImport, enums
  src/files/rules.ts              LIMITS, normalizePath, exclusionReason, PRIVATE_KEY, parentDirs
  src/files/store.ts              putBlob, getBlob, hashOf, isTextContent
  src/files/zip.ts                readZip, writeZip, ZipLimitError
  src/files/service.ts            loadProject, addFiles, recount, entryDTO
  src/routes/projects.ts          project CRUD, tree, download, download.zip
  src/routes/uploads.ts           multipart upload (files or zip), finish import
  src/routes/files.ts             read, save, folders, move, delete, history, restore
  test/file-rules.test.ts, file-store.test.ts, file-zip.test.ts,
  test/projects.test.ts, uploads.test.ts, files.test.ts, test/upload-helpers.ts
frontend/
  src/lib/file-rules.ts           browser copy of the rules
  src/lib/projects.ts             types + upload helpers (collect, filter, batch)
  src/app/w/[slug]/projects/page.tsx
  src/app/w/[slug]/projects/[pid]/page.tsx
  src/components/app/files/UploadDialog.tsx
  src/components/app/files/FileTree.tsx
  src/components/app/files/CodeEditor.tsx
  src/components/app/files/HistoryPanel.tsx
  src/components/app/AppShell.tsx (nav)
  e2e/projects.spec.ts, e2e/fixtures/sample-app/**
```

---

### Task 1: Schema, blob store, and shared rules

**Files:**
- Modify: `backend/prisma/schema.prisma`, `backend/package.json`
- Create: `backend/src/files/rules.ts`, `backend/src/files/store.ts`, `backend/test/file-rules.test.ts`, `backend/test/file-store.test.ts`

**Interfaces:**
- Produces:
  - `LIMITS = { maxEntries: 2000, maxTotalBytes: 52_428_800, maxFileBytes: 10_485_760, maxEditorBytes: 1_048_576, maxPathLength: 1024, maxDepth: 32 }`
  - `EXCLUDED_DIRS: string[]`, `EXCLUDED_FILES: RegExp[]`, `KEEP_FILES: string[]`
  - `type PathCheck = { ok: true; path: string } | { ok: false; reason: string }`
  - `normalizePath(raw: string): PathCheck`
  - `exclusionReason(path: string, kind: "file" | "dir"): string | null`
  - `PRIVATE_KEY: RegExp`
  - `parentDirs(path: string): string[]` (`"a/b/c.txt"` → `["a", "a/b"]`)
  - `hashOf(buf: Buffer): string`, `putBlob(buf: Buffer): Promise<string>`, `getBlob(hash: string): Promise<Buffer>`, `isTextContent(buf: Buffer): boolean`
  - Prisma: `Project`, `ProjectEntry`, `FileRevision`, `ProjectImport`, enums `EntryKind`, `RevisionReason`, `ImportStatus`, `ImportSource`.

- [ ] **Step 1: Install backend dependencies**

```bash
cd backend && npm i @fastify/multipart@10 fflate@0.8
```

- [ ] **Step 2: Write the failing rule tests**

`backend/test/file-rules.test.ts`:

```ts
import { expect, test } from "vitest";
import { exclusionReason, normalizePath, parentDirs, PRIVATE_KEY } from "../src/files/rules.js";

test.each([
  ["src/app/page.tsx", "src/app/page.tsx"],
  ["./README.md", "README.md"],
  ["src\\win\\file.ts", "src/win/file.ts"],
  ["folder/", "folder"],
])("normalizePath(%s) -> %s", (raw, out) => {
  expect(normalizePath(raw)).toEqual({ ok: true, path: out });
});

test.each([
  ["", /empty/],
  ["../etc/passwd", /invalid/],
  ["a/../../b", /invalid/],
  ["a//b", /invalid/],
  ["/abs/path", /absolute/],
  ["C:/Windows/x", /absolute/],
  ["bad\u0000name", /control/],
  ["tab\tname", /control/],
  [`${"x".repeat(256)}.txt`, /too long/],
  [Array.from({ length: 33 }, () => "d").join("/"), /deep/],
  [`${"a/".repeat(520)}f`, /too long|deep/],
])("normalizePath rejects %j", (raw, reason) => {
  const r = normalizePath(raw);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(reason);
});

test.each([
  ["node_modules/react/index.js", "file", /node_modules/],
  ["app/.git/config", "file", /\.git/],
  ["web/.next/cache/x", "file", /\.next/],
  ["dist", "dir", /dist/],
  [".env", "file", /secret/],
  ["config/.env.production", "file", /secret/],
  ["keys/server.pem", "file", /secret/],
  ["home/id_rsa", "file", /secret/],
  ["home/id_ed25519.pub", "file", /secret/],
  [".npmrc", "file", /secret/],
  ["photos/.DS_Store", "file", /system/],
])("exclusionReason(%s) excludes", (path, kind, reason) => {
  expect(exclusionReason(path, kind as "file" | "dir")).toMatch(reason);
});

test.each([["src/index.ts"], [".env.example"], [".env.sample"], [".github/workflows/ci.yml"], ["package-lock.json"], [".eslintrc.json"]])(
  "exclusionReason(%s) keeps",
  (path) => {
    expect(exclusionReason(path, "file")).toBeNull();
  },
);

test("private key detection", () => {
  expect(PRIVATE_KEY.test("-----BEGIN RSA PRIVATE KEY-----\nMIIE")).toBe(true);
  expect(PRIVATE_KEY.test("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
  expect(PRIVATE_KEY.test("-----BEGIN PUBLIC KEY-----")).toBe(false);
});

test("parentDirs lists every ancestor folder", () => {
  expect(parentDirs("a/b/c.txt")).toEqual(["a", "a/b"]);
  expect(parentDirs("top.txt")).toEqual([]);
});
```

`backend/test/file-store.test.ts`:

```ts
import { expect, test } from "vitest";
import { getBlob, hashOf, isTextContent, putBlob } from "../src/files/store.js";

test("put then get returns the same bytes, named by hash", async () => {
  const buf = Buffer.from(`hello ${Date.now()}`);
  const hash = await putBlob(buf);
  expect(hash).toBe(hashOf(buf));
  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect((await getBlob(hash)).equals(buf)).toBe(true);
  expect(await putBlob(buf)).toBe(hash);
});

test("getBlob refuses anything that isn't a hash", async () => {
  await expect(getBlob("../../etc/passwd")).rejects.toThrow();
});

test("text detection", () => {
  expect(isTextContent(Buffer.from("const x = 1;\n"))).toBe(true);
  expect(isTextContent(Buffer.from("héllo ✓", "utf8"))).toBe(true);
  expect(isTextContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))).toBe(false);
  expect(isTextContent(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false);
  expect(isTextContent(Buffer.alloc(0))).toBe(true);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/file-rules.test.ts test/file-store.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write `backend/src/files/rules.ts`**

```ts
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
```

- [ ] **Step 5: Write `backend/src/files/store.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The only module that touches file storage. Swap for S3/R2 here.
const root = () => process.env.FILES_DIR || fileURLToPath(new URL("../../data/blobs/", import.meta.url));

export const hashOf = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

function pathFor(hash: string) {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("invalid blob id");
  return join(root(), hash.slice(0, 2), hash);
}

export async function putBlob(buf: Buffer): Promise<string> {
  const hash = hashOf(buf);
  const target = pathFor(hash);
  try {
    await stat(target);
    return hash;
  } catch {
    // not stored yet
  }
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, target);
  return hash;
}

export const getBlob = async (hash: string) => readFile(pathFor(hash));

export function isTextContent(buf: Buffer): boolean {
  if (buf.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/file-rules.test.ts test/file-store.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: all pass, `TSC_OK`.

- [ ] **Step 7: Extend the schema**

Add:

```prisma
enum EntryKind {
  file
  dir
}

enum RevisionReason {
  upload
  edit
  restore
  rename
}

enum ImportStatus {
  running
  complete
  failed
  cancelled
}

enum ImportSource {
  folder
  zip
  files
}

model Project {
  id          String          @id @default(cuid())
  workspaceId String
  name        String
  createdById String
  totalBytes  Int             @default(0)
  fileCount   Int             @default(0)
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  workspace   Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  entries     ProjectEntry[]
  imports     ProjectImport[]

  @@unique([workspaceId, name])
  @@index([workspaceId])
}

model ProjectEntry {
  id          String         @id @default(cuid())
  projectId   String
  path        String
  pathLower   String
  kind        EntryKind
  blobHash    String?
  size        Int            @default(0)
  isText      Boolean        @default(false)
  revision    Int            @default(0)
  updatedById String
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  project     Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  revisions   FileRevision[]

  @@unique([projectId, pathLower])
}

model FileRevision {
  id          String         @id @default(cuid())
  entryId     String
  projectId   String
  blobHash    String
  size        Int
  revision    Int
  reason      RevisionReason
  fromPath    String?
  createdById String
  createdAt   DateTime       @default(now())
  entry       ProjectEntry   @relation(fields: [entryId], references: [id], onDelete: Cascade)

  @@index([entryId, revision])
}

model ProjectImport {
  id          String       @id @default(cuid())
  projectId   String
  source      ImportSource
  status      ImportStatus @default(running)
  added       Int          @default(0)
  skipped     Json         @default("[]")
  createdNew  Boolean      @default(false)
  createdById String
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  project     Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

Add `projects Project[]` to `Workspace`.

- [ ] **Step 8: Migrate, generate, type check**

Run: `npx prisma migrate dev --name project_files 2>&1 | grep -v "postgresql://" | tail -2 && npx prisma generate | tail -1 && npx tsc --noEmit && echo TSC_OK`
Expected: in sync, client generated, `TSC_OK`. (Prisma 7: `migrate dev` does not regenerate the client, so `generate` is required.)

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(backend): project file schema, blob store, and upload rules"
```

---

### Task 2: Safe ZIP read and write

**Files:**
- Create: `backend/src/files/zip.ts`, `backend/test/file-zip.test.ts`

**Interfaces:**
- Consumes: `LIMITS`.
- Produces:
  - `type ZipEntry = { path: string; data: Buffer; isDir: boolean }`
  - `class ZipLimitError extends Error`
  - `readZip(buf: Buffer, limits?: { maxEntries: number; maxTotalBytes: number; maxFileBytes: number }): ZipEntry[]` (paths are raw ZIP names; callers normalize)
  - `writeZip(entries: { path: string; data?: Buffer; isDir: boolean }[]): Buffer`

- [ ] **Step 1: Write the failing tests**

`backend/test/file-zip.test.ts`:

```ts
import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { readZip, writeZip, ZipLimitError } from "../src/files/zip.js";

const small = { maxEntries: 5, maxTotalBytes: 1000, maxFileBytes: 400 };

test("reads files, nested paths, empty files, and empty folders", () => {
  const zip = Buffer.from(zipSync({ "app/src/a.ts": strToU8("export {}"), "app/empty.txt": new Uint8Array(), "app/docs/": new Uint8Array() }));
  const out = readZip(zip, small);
  expect(out.map((e) => [e.path, e.isDir, e.data.toString()])).toEqual([
    ["app/src/a.ts", false, "export {}"],
    ["app/empty.txt", false, ""],
    ["app/docs/", true, ""],
  ]);
});

test("a file that expands past the per-file limit is refused (bomb-safe)", () => {
  const zip = Buffer.from(zipSync({ "big.bin": new Uint8Array(5000) }, { level: 9 }));
  expect(zip.length).toBeLessThan(400);
  expect(() => readZip(zip, small)).toThrow(ZipLimitError);
  expect(() => readZip(zip, small)).toThrow(/larger than/);
});

test("total expanded size is limited", () => {
  const files = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`f${i}.bin`, new Uint8Array(300)]));
  expect(() => readZip(Buffer.from(zipSync(files)), small)).toThrow(/expands to more than/);
});

test("too many entries is refused", () => {
  const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.txt`, strToU8("x")]));
  expect(() => readZip(Buffer.from(zipSync(files)), small)).toThrow(/more than 5/);
});

test("a corrupt file is a clear error", () => {
  expect(() => readZip(Buffer.from("PK\u0003\u0004not really a zip at all"), small)).toThrow(ZipLimitError);
});

test("writeZip round-trips through readZip", () => {
  const buf = writeZip([
    { path: "a/b.txt", data: Buffer.from("hello"), isDir: false },
    { path: "a/empty", isDir: true },
  ]);
  const back = readZip(buf, small);
  expect(back.find((e) => e.path === "a/b.txt")!.data.toString()).toBe("hello");
  expect(back.some((e) => e.path === "a/empty/" && e.isDir)).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/file-zip.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `backend/src/files/zip.ts`**

```ts
import { Unzip, UnzipInflate, zipSync } from "fflate";
import { LIMITS } from "./rules.js";

export type ZipEntry = { path: string; data: Buffer; isDir: boolean };
export class ZipLimitError extends Error {}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Streaming read that counts real expanded bytes, so a ZIP lying about its sizes can't
 * expand past the limits. No filesystem paths are created here; callers validate names.
 */
export function readZip(buf: Buffer, limits = LIMITS): ZipEntry[] {
  const out: ZipEntry[] = [];
  let total = 0;
  let failure: Error | null = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (failure) return;
    if (out.length >= limits.maxEntries) {
      failure = new ZipLimitError(`The ZIP has more than ${limits.maxEntries} entries`);
      return;
    }
    if (file.name.endsWith("/")) {
      out.push({ path: file.name, data: Buffer.alloc(0), isDir: true });
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = new ZipLimitError("That ZIP file couldn't be read");
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > limits.maxFileBytes) {
        failure = new ZipLimitError(`${file.name} is larger than ${mb(limits.maxFileBytes)}`);
        file.terminate();
        return;
      }
      if (total > limits.maxTotalBytes) {
        failure = new ZipLimitError(`The ZIP expands to more than ${mb(limits.maxTotalBytes)}`);
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) out.push({ path: file.name, data: Buffer.concat(chunks), isDir: false });
    };
    file.start();
  };
  try {
    unzip.push(new Uint8Array(buf), true);
  } catch {
    throw new ZipLimitError("That ZIP file couldn't be read");
  }
  if (failure) throw failure;
  if (!out.length && buf.length > 22) throw new ZipLimitError("That ZIP file couldn't be read");
  return out;
}

export function writeZip(entries: { path: string; data?: Buffer; isDir: boolean }[]): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const e of entries) files[e.isDir ? `${e.path}/` : e.path] = e.isDir ? new Uint8Array() : new Uint8Array(e.data ?? Buffer.alloc(0));
  return Buffer.from(zipSync(files, { level: 6 }));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/file-zip.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 6 passed, `TSC_OK`. If an empty file never receives a `final` callback with an empty chunk in this fflate version, also push the entry when `file.originalSize === 0` right after `file.start()`; the "empty files" assertion pins the behavior.

- [ ] **Step 5: Commit**

```bash
git add backend/src/files/zip.ts backend/test/file-zip.test.ts
git commit -m "feat(backend): bomb-safe streaming ZIP reader and ZIP writer"
```

---

### Task 3: Projects, tree, and downloads

**Files:**
- Create: `backend/src/files/service.ts`, `backend/src/routes/projects.ts`, `backend/test/projects.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: `getBlob`, `writeZip`, `requireMember`, `audit`, `HttpError`, `WsParams`, `Name`.
- Produces:
  - `loadProject(workspaceId: string, pid: string): Promise<Project>` (404 otherwise)
  - `recount(db: Db, projectId: string): Promise<void>` (sets `fileCount`, `totalBytes`)
  - `entryDTO(e: ProjectEntry)` → `{ path, kind, size, isText, revision, updatedAt }`
  - `projectDTO(p: Project)` → `{ id, name, fileCount, totalBytes, updatedAt }`
  - `ProjectParams = WsParams.extend({ pid })`, `QueryPath = z.object({ path })` (normalized via `normalizePath`, 400 on failure), helper `requirePath(raw: string): string`
  - `sendFile(reply, name: string, data: Buffer)` with safe headers
  - Routes: `GET/POST /api/workspaces/:id/projects`, `PATCH/DELETE /api/workspaces/:id/projects/:pid`, `GET .../:pid/tree`, `GET .../:pid/download?path=`, `GET .../:pid/download.zip`

- [ ] **Step 1: Write the failing tests**

`backend/test/projects.test.ts`:

```ts
import { unzipSync } from "fflate";
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { putBlob } from "../src/files/store.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Files Co", template: "head-only" })).json().id as string;
  return { req, id, cookie };
}

async function seedFile(projectId: string, path: string, content: string | Buffer, userId: string) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const blobHash = await putBlob(data);
  await prisma.projectEntry.create({ data: { projectId, path, pathLower: path.toLowerCase(), kind: "file", blobHash, size: data.length, isText: !Buffer.isBuffer(content), revision: 1, updatedById: userId } });
}

test("create, list, rename, and duplicate names", async () => {
  const { req, id } = await owner();
  const created = await req("POST", `/api/workspaces/${id}/projects`, { name: "Bakery site" });
  expect(created.statusCode).toBe(201);
  expect((await req("POST", `/api/workspaces/${id}/projects`, { name: "Bakery site" })).statusCode).toBe(409);
  const pid = created.json().id;
  expect((await req("PATCH", `/api/workspaces/${id}/projects/${pid}`, { name: "Bakery web" })).statusCode).toBe(200);
  const list = (await req("GET", `/api/workspaces/${id}/projects`)).json().projects;
  expect(list).toMatchObject([{ id: pid, name: "Bakery web", fileCount: 0, totalBytes: 0 }]);
});

test("tree lists entries; downloads send safe headers", async () => {
  const { req, id } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "P" })).json().id;
  const me = (await req("GET", "/api/me")).json().user.id;
  await seedFile(pid, "src/index.html", "<script>alert(1)</script>", me);
  await seedFile(pid, "logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), me);
  await prisma.projectEntry.create({ data: { projectId: pid, path: "src", pathLower: "src", kind: "dir", updatedById: me } });
  const tree = (await req("GET", `/api/workspaces/${id}/projects/${pid}/tree`)).json().entries;
  expect(tree.map((e: { path: string; kind: string }) => [e.path, e.kind])).toEqual([
    ["logo.png", "file"],
    ["src", "dir"],
    ["src/index.html", "file"],
  ]);
  const html = await req("GET", `/api/workspaces/${id}/projects/${pid}/download?path=src/index.html`);
  expect(html.headers["content-disposition"]).toMatch(/^attachment;/);
  expect(html.headers["x-content-type-options"]).toBe("nosniff");
  expect(html.headers["content-security-policy"]).toBe("sandbox");
  expect(html.headers["content-type"]).toMatch(/application\/octet-stream/);
  const png = await req("GET", `/api/workspaces/${id}/projects/${pid}/download?path=logo.png`);
  expect(png.headers["content-type"]).toBe("image/png");
  expect(png.headers["content-disposition"]).toMatch(/^inline;/);
});

test("download.zip contains every file with its structure", async () => {
  const { req, id } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "Zip me" })).json().id;
  const me = (await req("GET", "/api/me")).json().user.id;
  await seedFile(pid, "a/b/c.txt", "deep", me);
  await prisma.projectEntry.create({ data: { projectId: pid, path: "empty", pathLower: "empty", kind: "dir", updatedById: me } });
  const res = await req("GET", `/api/workspaces/${id}/projects/${pid}/download.zip`);
  expect(res.headers["content-disposition"]).toMatch(/Zip%20me\.zip|Zip me\.zip/);
  const files = unzipSync(new Uint8Array(res.rawPayload));
  expect(Buffer.from(files["a/b/c.txt"]).toString()).toBe("deep");
  expect("empty/" in files).toBe(true);
});

test("bad paths are rejected and other workspaces get 404", async () => {
  const a = await owner();
  const b = await owner();
  const pid = (await a.req("POST", `/api/workspaces/${a.id}/projects`, { name: "Mine" })).json().id;
  expect((await a.req("GET", `/api/workspaces/${a.id}/projects/${pid}/download?path=../x`)).statusCode).toBe(400);
  expect((await b.req("GET", `/api/workspaces/${b.id}/projects/${pid}/tree`)).statusCode).toBe(404);
  expect((await b.req("GET", `/api/workspaces/${a.id}/projects/${pid}/tree`)).statusCode).toBe(404);
});

test("roles: member cannot delete a project, owner can", async () => {
  const { req, id } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "Doomed" })).json().id;
  const member = await signUp(app);
  const mid = (await client(app, member.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: id, userId: mid, role: "member" } });
  expect((await client(app, member.cookie)("DELETE", `/api/workspaces/${id}/projects/${pid}`)).statusCode).toBe(403);
  expect((await req("DELETE", `/api/workspaces/${id}/projects/${pid}`)).statusCode).toBe(204);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/projects.test.ts`
Expected: FAIL, routes 404.

- [ ] **Step 3: Write `backend/src/files/service.ts`**

```ts
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { prisma, type Db } from "../db.js";
import type { Project, ProjectEntry } from "../generated/prisma/client.js";
import { HttpError } from "../http.js";
import { WsParams } from "../routes/workspaces.js";
import { normalizePath } from "./rules.js";

export const ProjectParams = WsParams.extend({ pid: z.string().min(1).max(64) });

export function requirePath(raw: unknown): string {
  const r = normalizePath(String(raw ?? ""));
  if (!r.ok) throw new HttpError(400, "invalid", `That path isn't allowed: ${r.reason}`);
  return r.path;
}

export async function loadProject(workspaceId: string, pid: string): Promise<Project> {
  const p = await prisma.project.findFirst({ where: { id: pid, workspaceId } });
  if (!p) throw new HttpError(404, "not_found", "Project not found");
  return p;
}

export async function loadEntry(projectId: string, path: string) {
  const e = await prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId, pathLower: path.toLowerCase() } } });
  if (!e) throw new HttpError(404, "not_found", "File not found");
  return e;
}

export async function recount(db: Db, projectId: string) {
  const agg = await db.projectEntry.aggregate({ where: { projectId, kind: "file" }, _sum: { size: true }, _count: true });
  await db.project.update({ where: { id: projectId }, data: { fileCount: agg._count, totalBytes: agg._sum.size ?? 0 } });
}

export const entryDTO = (e: ProjectEntry) => ({ path: e.path, kind: e.kind, size: e.size, isText: e.isText, revision: e.revision, updatedAt: e.updatedAt });
export const projectDTO = (p: Project) => ({ id: p.id, name: p.name, fileCount: p.fileCount, totalBytes: p.totalBytes, updatedAt: p.updatedAt });

const INLINE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** Never lets the browser render uploaded content as a page: images inline, everything else an attachment. */
export function sendFile(reply: FastifyReply, name: string, data: Buffer, forceAttachment = false) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const inline = !forceAttachment ? INLINE[ext] : undefined;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return reply
    .header("content-type", inline ?? "application/octet-stream")
    .header("content-disposition", `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`)
    .header("x-content-type-options", "nosniff")
    .header("content-security-policy", "sandbox")
    .header("cache-control", "private, no-store")
    .send(data);
}
```

- [ ] **Step 4: Write `backend/src/routes/projects.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { entryDTO, loadEntry, loadProject, ProjectParams, projectDTO, requirePath, sendFile } from "../files/service.js";
import { getBlob } from "../files/store.js";
import { writeZip } from "../files/zip.js";
import { audit, HttpError, requireMember } from "../http.js";
import { Name, WsParams } from "./workspaces.js";

export async function projectRoutes(app: FastifyInstance) {
  app.get("/api/workspaces/:id/projects", async (req) => {
    const { id } = WsParams.parse(req.params);
    await requireMember(req, id);
    const rows = await prisma.project.findMany({ where: { workspaceId: id }, orderBy: { updatedAt: "desc" } });
    return { projects: rows.map(projectDTO) };
  });

  app.post("/api/workspaces/:id/projects", async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { name } = z.object({ name: Name }).parse(req.body);
    const p = await prisma.project.create({ data: { workspaceId: id, name, createdById: user.id } });
    await audit(prisma, id, user.id, "project.create", "project", p.id, { name });
    return reply.code(201).send({ id: p.id });
  });

  app.patch("/api/workspaces/:id/projects/:pid", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const { name } = z.object({ name: Name }).parse(req.body);
    await loadProject(id, pid);
    await prisma.project.update({ where: { id: pid }, data: { name } });
    await audit(prisma, id, user.id, "project.rename", "project", pid, { name });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/projects/:pid", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "admin");
    await loadProject(id, pid);
    await prisma.project.delete({ where: { id: pid } });
    await audit(prisma, id, user.id, "project.delete", "project", pid);
    return reply.code(204).send();
  });

  app.get("/api/workspaces/:id/projects/:pid/tree", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    const project = await loadProject(id, pid);
    const entries = await prisma.projectEntry.findMany({ where: { projectId: pid }, orderBy: { path: "asc" } });
    return { project: projectDTO(project), entries: entries.map(entryDTO) };
  });

  app.get("/api/workspaces/:id/projects/:pid/download", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const path = requirePath((req.query as { path?: string }).path);
    const entry = await loadEntry(pid, path);
    if (entry.kind !== "file" || !entry.blobHash) throw new HttpError(400, "invalid", "That's a folder; download the project ZIP instead");
    return sendFile(reply, path.split("/").pop()!, await getBlob(entry.blobHash));
  });

  app.get("/api/workspaces/:id/projects/:pid/download.zip", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    const project = await loadProject(id, pid);
    const entries = await prisma.projectEntry.findMany({ where: { projectId: pid }, orderBy: { path: "asc" } });
    const items = [];
    for (const e of entries) items.push(e.kind === "dir" ? { path: e.path, isDir: true } : { path: e.path, isDir: false, data: await getBlob(e.blobHash!) });
    return sendFile(reply, `${project.name}.zip`, writeZip(items), true);
  });
}
```

- [ ] **Step 5: Register and run**

In `backend/src/app.ts` add `import { projectRoutes } from "./routes/projects.js";` and `await app.register(projectRoutes);` after `chatRoutes`.

Run: `npx vitest run test/projects.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 5 passed, `TSC_OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/src backend/test/projects.test.ts
git commit -m "feat(backend): projects, file tree, and safe downloads"
```

---

### Task 4: Uploads (files and ZIP)

**Files:**
- Modify: `backend/src/files/service.ts`, `backend/src/app.ts`
- Create: `backend/src/routes/uploads.ts`, `backend/test/upload-helpers.ts`, `backend/test/uploads.test.ts`

**Interfaces:**
- Consumes: rules, `putBlob`, `isTextContent`, `readZip`, `ZipLimitError`, `recount`, `loadProject`, `perUser`.
- Produces:
  - `type Incoming = { path: string; data: Buffer }`
  - `addFiles(projectId: string, userId: string, files: Incoming[], dirs: string[]): Promise<{ added: number; skipped: { path: string; reason: string }[] }>`
  - Routes: `POST /api/workspaces/:id/projects/upload` (new project; fields `name`, `source`, optional `dirs` JSON; files: field name = relative path, or one `zip` file), `POST /api/workspaces/:id/projects/:pid/upload` (existing project; same fields plus optional `importId`), `POST /api/workspaces/:id/projects/:pid/imports/:importId/finish` `{ status: "complete" | "cancelled" }` → `{ deletedProject: boolean }`
  - Upload responses: `{ projectId, importId, added, skipped }`
  - Test helper `multipart(fields, files)` → `{ payload: Buffer, headers }`

- [ ] **Step 1: Write the multipart test helper**

`backend/test/upload-helpers.ts`:

```ts
/** Builds a multipart/form-data body for app.inject. Files: [fieldName, filename, content]. */
export function multipart(fields: Record<string, string>, files: [string, string, Buffer | string][]) {
  const boundary = `----test${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const [field, filename, content] of files) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${field}"; filename="${filename}"\r\ncontent-type: application/octet-stream\r\n\r\n`));
    parts.push(Buffer.isBuffer(content) ? content : Buffer.from(content));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
```

- [ ] **Step 2: Write the failing tests**

`backend/test/uploads.test.ts`:

```ts
import { strToU8, zipSync } from "fflate";
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { multipart } from "./upload-helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Upload Co", template: "head-only" })).json().id as string;
  const upload = (url: string, fields: Record<string, string>, files: [string, string, Buffer | string][]) => {
    const body = multipart(fields, files);
    return app.inject({ method: "POST", url, payload: body.payload, headers: { ...body.headers, cookie, origin: ORIGIN } });
  };
  return { req, id, upload };
}
const paths = async (req: ReturnType<typeof client>, id: string, pid: string) =>
  (await req("GET", `/api/workspaces/${id}/projects/${pid}/tree`)).json().entries.map((e: { path: string; kind: string }) => `${e.kind}:${e.path}`);

test("folder upload creates a project with nesting, parent folders, and empty folders", async () => {
  const { req, id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Sample app", source: "folder", dirs: JSON.stringify(["sample/assets/empty"]) }, [
    ["sample/package.json", "package.json", '{"name":"x"}'],
    ["sample/src/app/page.tsx", "page.tsx", "export default function Page() {}"],
  ]);
  expect(res.statusCode).toBe(201);
  const { projectId, added, skipped } = res.json();
  expect({ added, skipped }).toEqual({ added: 2, skipped: [] });
  expect(await paths(req, id, projectId)).toEqual([
    "dir:sample",
    "dir:sample/assets",
    "dir:sample/assets/empty",
    "file:sample/package.json",
    "dir:sample/src",
    "dir:sample/src/app",
    "file:sample/src/app/page.tsx",
  ]);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  expect(project).toMatchObject({ name: "Sample app", fileCount: 2 });
  const rev = await prisma.fileRevision.findFirstOrThrow({ where: { projectId } });
  expect(rev).toMatchObject({ reason: "upload", revision: 1 });
});

test("excluded, secret, unsafe, and colliding files are skipped with reasons", async () => {
  const { id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Rules", source: "folder" }, [
    ["app/node_modules/x/index.js", "index.js", "x"],
    ["app/.env", ".env", "SECRET=1"],
    ["app/.env.example", ".env.example", "SECRET="],
    ["app/notes/key.txt", "key.txt", "-----BEGIN RSA PRIVATE KEY-----\nabc"],
    ["../escape.txt", "escape.txt", "x"],
    ["app/Readme.md", "Readme.md", "a"],
    ["app/README.md", "README.md", "b"],
  ]);
  const { added, skipped } = res.json();
  expect(added).toBe(2);
  const reasons = Object.fromEntries(skipped.map((s: { path: string; reason: string }) => [s.path, s.reason]));
  expect(reasons["app/node_modules/x/index.js"]).toMatch(/node_modules/);
  expect(reasons["app/.env"]).toMatch(/secret/);
  expect(reasons["app/notes/key.txt"]).toMatch(/private key/);
  expect(reasons["../escape.txt"]).toMatch(/invalid/);
  expect(reasons["app/README.md"]).toMatch(/already exists|same name/);
});

test("uploading into an existing project never overwrites (any letter case)", async () => {
  const { req, id, upload } = await owner();
  const pid = (await req("POST", `/api/workspaces/${id}/projects`, { name: "Existing" })).json().id;
  await upload(`/api/workspaces/${id}/projects/${pid}/upload`, { source: "files" }, [["notes.txt", "notes.txt", "first"]]);
  const res = await upload(`/api/workspaces/${id}/projects/${pid}/upload`, { source: "files" }, [["NOTES.txt", "NOTES.txt", "second"]]);
  expect(res.json().added).toBe(0);
  expect(res.json().skipped[0].reason).toMatch(/already exists/);
  const entry = await prisma.projectEntry.findFirstOrThrow({ where: { projectId: pid } });
  expect(entry.path).toBe("notes.txt");
});

test("ZIP upload unpacks safely", async () => {
  const { req, id, upload } = await owner();
  const zip = Buffer.from(zipSync({ "site/index.html": strToU8("<h1>Hi</h1>"), "site/img/": new Uint8Array(), "site/.git/HEAD": strToU8("ref") }));
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Zipped", source: "zip" }, [["zip", "site.zip", zip]]);
  expect(res.statusCode).toBe(201);
  expect(await paths(req, id, res.json().projectId)).toEqual(["dir:site", "dir:site/img", "file:site/index.html"]);
  expect(res.json().skipped.map((s: { reason: string }) => s.reason)).toEqual([expect.stringMatching(/\.git/)]);
});

test("a bad ZIP on a new project leaves no empty project behind", async () => {
  const { id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Broken zip", source: "zip" }, [["zip", "bad.zip", Buffer.from("PK\u0003\u0004nope")]]);
  expect(res.statusCode).toBe(400);
  expect(await prisma.project.count({ where: { workspaceId: id } })).toBe(0);
});

test("cancelling a new-project import that added nothing deletes the project", async () => {
  const { req, id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Cancelled", source: "folder" }, [["x/.env", ".env", "S=1"]]);
  const { projectId, importId } = res.json();
  const fin = await req("POST", `/api/workspaces/${id}/projects/${projectId}/imports/${importId}/finish`, { status: "cancelled" });
  expect(fin.json()).toEqual({ deletedProject: true });
  expect(await prisma.project.count({ where: { id: projectId } })).toBe(0);
});

test("files over 10 MB are skipped, and viewers can't upload", async () => {
  const { req, id, upload } = await owner();
  const res = await upload(`/api/workspaces/${id}/projects/upload`, { name: "Big", source: "files" }, [
    ["big.bin", "big.bin", Buffer.alloc(10 * 1024 * 1024 + 1)],
    ["ok.txt", "ok.txt", "fine"],
  ]);
  expect(res.json().added).toBe(1);
  expect(res.json().skipped[0]).toMatchObject({ path: "big.bin", reason: expect.stringMatching(/larger than 10 MB/) });
  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: id, userId: vid, role: "viewer" } });
  const body = multipart({ name: "Nope", source: "files" }, [["a.txt", "a.txt", "a"]]);
  const denied = await app.inject({ method: "POST", url: `/api/workspaces/${id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie: viewer.cookie, origin: ORIGIN } });
  expect(denied.statusCode).toBe(403);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/uploads.test.ts`
Expected: FAIL, upload routes 404.

- [ ] **Step 4: Add `addFiles` to `backend/src/files/service.ts`**

Append (and add `import { randomUUID } from "node:crypto";`, `import { exclusionReason, LIMITS, normalizePath, parentDirs, PRIVATE_KEY } from "./rules.js";`, `import { isTextContent, putBlob } from "./store.js";` at the top, merging the existing `normalizePath` import):

```ts
export type Incoming = { path: string; data: Buffer };
type Skip = { path: string; reason: string };

/**
 * Validates and stores a batch. Never overwrites: a path that exists in any letter case is skipped.
 * Parent folders are created automatically; empty folders come from `dirs`.
 */
export async function addFiles(projectId: string, userId: string, files: Incoming[], dirs: string[]) {
  const skipped: Skip[] = [];
  const existing = await prisma.projectEntry.findMany({ where: { projectId }, select: { pathLower: true, kind: true } });
  const taken = new Map(existing.map((e) => [e.pathLower, e.kind]));
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  let entries = existing.length;
  let total = project.totalBytes;

  const accepted: { id: string; path: string; data: Buffer; isText: boolean }[] = [];
  const newDirs = new Set<string>();
  const wantDir = (path: string) => {
    const lower = path.toLowerCase();
    if (taken.get(lower) === "file") return false;
    if (!taken.has(lower) && !newDirs.has(path)) newDirs.add(path);
    return true;
  };

  for (const f of files) {
    const n = normalizePath(f.path);
    if (!n.ok) {
      skipped.push({ path: f.path, reason: n.reason });
      continue;
    }
    const path = n.path;
    const excluded = exclusionReason(path, "file");
    if (excluded) {
      skipped.push({ path, reason: excluded });
      continue;
    }
    if (f.data.length > LIMITS.maxFileBytes) {
      skipped.push({ path, reason: "larger than 10 MB" });
      continue;
    }
    const isText = isTextContent(f.data);
    if (isText && PRIVATE_KEY.test(f.data.toString("utf8"))) {
      skipped.push({ path, reason: "contains a private key" });
      continue;
    }
    if (taken.has(path.toLowerCase()) || accepted.some((a) => a.path.toLowerCase() === path.toLowerCase())) {
      skipped.push({ path, reason: "a file with the same name already exists" });
      continue;
    }
    const parents = parentDirs(path);
    if (parents.some((d) => taken.get(d.toLowerCase()) === "file")) {
      skipped.push({ path, reason: "a file is in the way of its folder" });
      continue;
    }
    const newParents = parents.filter((d) => !taken.has(d.toLowerCase()) && !newDirs.has(d)).length;
    if (entries + 1 + newParents > LIMITS.maxEntries) {
      skipped.push({ path, reason: "the project has reached 2,000 files and folders" });
      continue;
    }
    if (total + f.data.length > LIMITS.maxTotalBytes) {
      skipped.push({ path, reason: "the project has reached 50 MB" });
      continue;
    }
    parents.forEach(wantDir);
    entries += 1 + newParents;
    total += f.data.length;
    accepted.push({ id: randomUUID(), path, data: f.data, isText });
  }
  for (const raw of dirs) {
    const n = normalizePath(raw);
    if (!n.ok || exclusionReason(n.path, "dir")) continue;
    if (entries >= LIMITS.maxEntries) break;
    for (const d of [...parentDirs(n.path), n.path]) if (wantDir(d) && !taken.has(d.toLowerCase())) entries++;
  }

  const hashes = [];
  for (const a of accepted) hashes.push(await putBlob(a.data));
  await prisma.$transaction(async (tx) => {
    if (newDirs.size) {
      await tx.projectEntry.createMany({
        data: [...newDirs].map((path) => ({ projectId, path, pathLower: path.toLowerCase(), kind: "dir" as const, updatedById: userId })),
        skipDuplicates: true,
      });
    }
    if (accepted.length) {
      await tx.projectEntry.createMany({
        data: accepted.map((a, i) => ({ id: a.id, projectId, path: a.path, pathLower: a.path.toLowerCase(), kind: "file" as const, blobHash: hashes[i], size: a.data.length, isText: a.isText, revision: 1, updatedById: userId })),
      });
      await tx.fileRevision.createMany({
        data: accepted.map((a, i) => ({ entryId: a.id, projectId, blobHash: hashes[i], size: a.data.length, revision: 1, reason: "upload" as const, createdById: userId })),
      });
    }
    await recount(tx, projectId);
  });
  return { added: accepted.length, skipped };
}
```

- [ ] **Step 5: Write `backend/src/routes/uploads.ts`**

```ts
import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import type { ImportSource, Prisma } from "../generated/prisma/client.js";
import { LIMITS } from "../files/rules.js";
import { addFiles, loadProject, ProjectParams, type Incoming } from "../files/service.js";
import { readZip, ZipLimitError } from "../files/zip.js";
import { audit, HttpError, perUser, requireMember } from "../http.js";
import { Name, WsParams } from "./workspaces.js";

type Parsed = { fields: Record<string, string>; files: Incoming[]; zip: Buffer | null; tooBig: string[] };

async function parse(req: FastifyRequest): Promise<Parsed> {
  const out: Parsed = { fields: {}, files: [], zip: null, tooBig: [] };
  for await (const part of req.parts({ limits: { fileSize: LIMITS.maxTotalBytes, files: 100, fields: 10, fieldSize: 256 * 1024 } })) {
    if (part.type === "field") {
      out.fields[part.fieldname] = String(part.value);
      continue;
    }
    const data = await part.toBuffer();
    if (part.fieldname === "zip") out.zip = data;
    else if (data.length > LIMITS.maxFileBytes) out.tooBig.push(part.fieldname);
    else out.files.push({ path: part.fieldname, data });
  }
  return out;
}

const Source = z.enum(["folder", "zip", "files"]);

async function ingest(projectId: string, userId: string, parsed: Parsed) {
  let files = parsed.files;
  let dirs: string[] = [];
  try {
    dirs = parsed.fields.dirs ? z.array(z.string().max(1024)).max(LIMITS.maxEntries).parse(JSON.parse(parsed.fields.dirs)) : [];
  } catch {
    throw new HttpError(400, "invalid", "The folder list couldn't be read");
  }
  if (parsed.zip) {
    let entries;
    try {
      entries = readZip(parsed.zip);
    } catch (e) {
      throw new HttpError(400, "invalid", e instanceof ZipLimitError ? e.message : "That ZIP file couldn't be read");
    }
    files = entries.filter((e) => !e.isDir).map((e) => ({ path: e.path, data: e.data }));
    dirs = entries.filter((e) => e.isDir).map((e) => e.path);
  }
  const result = await addFiles(projectId, userId, files, dirs);
  return { added: result.added, skipped: [...parsed.tooBig.map((path) => ({ path, reason: "larger than 10 MB" })), ...result.skipped] };
}

async function recordImport(importId: string, added: number, skipped: { path: string; reason: string }[]) {
  const current = await prisma.projectImport.findUniqueOrThrow({ where: { id: importId } });
  const merged = [...(current.skipped as { path: string; reason: string }[]), ...skipped].slice(0, 5000);
  await prisma.projectImport.update({ where: { id: importId }, data: { added: current.added + added, skipped: merged as unknown as Prisma.InputJsonValue } });
}

export async function uploadRoutes(app: FastifyInstance) {
  await app.register(multipart, { throwFileSizeLimit: false });
  const limited = { config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: perUser } } };

  app.post("/api/workspaces/:id/projects/upload", limited, async (req, reply) => {
    const { id } = WsParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const parsed = await parse(req);
    const name = Name.parse(parsed.fields.name ?? "");
    const source = Source.parse(parsed.fields.source ?? "files") as ImportSource;
    const project = await prisma.project.create({ data: { workspaceId: id, name, createdById: user.id } });
    const imp = await prisma.projectImport.create({ data: { projectId: project.id, source, createdNew: true, createdById: user.id } });
    try {
      const result = await ingest(project.id, user.id, parsed);
      await recordImport(imp.id, result.added, result.skipped);
      if (source === "zip") await prisma.projectImport.update({ where: { id: imp.id }, data: { status: "complete" } });
      await audit(prisma, id, user.id, "project.upload", "project", project.id, { source, added: result.added });
      return reply.code(201).send({ projectId: project.id, importId: imp.id, ...result });
    } catch (e) {
      // A brand-new project from a failed first batch is removed, not left half-made.
      await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
      throw e;
    }
  });

  app.post("/api/workspaces/:id/projects/:pid/upload", limited, async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadProject(id, pid);
    const parsed = await parse(req);
    const source = Source.parse(parsed.fields.source ?? "files") as ImportSource;
    let importId = parsed.fields.importId;
    if (importId) {
      const imp = await prisma.projectImport.findFirst({ where: { id: importId, projectId: pid, status: "running" } });
      if (!imp) throw new HttpError(400, "invalid", "That upload has already finished");
    } else {
      importId = (await prisma.projectImport.create({ data: { projectId: pid, source, createdById: user.id } })).id;
    }
    const result = await ingest(pid, user.id, parsed);
    await recordImport(importId, result.added, result.skipped);
    if (source === "zip") await prisma.projectImport.update({ where: { id: importId }, data: { status: "complete" } });
    return { projectId: pid, importId, ...result };
  });

  app.post("/api/workspaces/:id/projects/:pid/imports/:importId/finish", async (req) => {
    const { id, pid, importId } = ProjectParams.extend({ importId: z.string().min(1).max(64) }).parse(req.params);
    await requireMember(req, id, "member");
    const project = await loadProject(id, pid);
    const { status } = z.object({ status: z.enum(["complete", "cancelled"]) }).parse(req.body);
    const imp = await prisma.projectImport.findFirst({ where: { id: importId, projectId: pid } });
    if (!imp) throw new HttpError(404, "not_found", "Upload not found");
    await prisma.projectImport.update({ where: { id: importId }, data: { status } });
    const empty = (await prisma.projectEntry.count({ where: { projectId: pid } })) === 0;
    if (status === "cancelled" && imp.createdNew && empty) {
      await prisma.project.delete({ where: { id: project.id } });
      return { deletedProject: true };
    }
    return { deletedProject: false };
  });
}
```

- [ ] **Step 6: Register and run**

In `backend/src/app.ts` add `import { uploadRoutes } from "./routes/uploads.js";` and `await app.register(uploadRoutes);` after `projectRoutes`.

Run: `npx vitest run test/uploads.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 7 passed, `TSC_OK`. If `part.toBuffer()` throws for a file over `fileSize` despite `throwFileSizeLimit: false`, check `part.file.truncated` after `toBuffer()` instead; the 10 MB test pins the result.

- [ ] **Step 7: Commit**

```bash
git add backend/src backend/test/uploads.test.ts backend/test/upload-helpers.ts
git commit -m "feat(backend): folder, file, and ZIP uploads with rules and cleanup"
```

---

### Task 5: Read, save, manage, history, restore

**Files:**
- Create: `backend/src/routes/files.ts`, `backend/test/files.test.ts`
- Modify: `backend/src/app.ts`

**Interfaces:**
- Consumes: service helpers, rules, store, `perUser`.
- Produces routes (all under `/api/workspaces/:id/projects/:pid`):
  - `GET /files?path=` → `{ path, content, revision }` (415 for binary or > 1 MB)
  - `PUT /files` `{ path, content, baseRevision }` → `{ revision }`; 409 `{ error: { code: "conflict", message } }`
  - `POST /folders` `{ path }` → 201
  - `POST /move` `{ from, to }` → `{ ok: true }`
  - `DELETE /entries?path=` → 204
  - `GET /history?path=` → `{ revisions: { id, revision, reason, size, fromPath, createdAt, createdBy }[] }`
  - `GET /history/:revisionId` → `{ content, revision }`
  - `POST /restore` `{ path, revisionId }` → `{ revision }`

- [ ] **Step 1: Write the failing tests**

`backend/test/files.test.ts`:

```ts
import { afterAll, expect, test } from "vitest";
import { prisma } from "../src/db.js";
import { client, makeApp, ORIGIN, signUp } from "./helpers.js";
import { multipart } from "./upload-helpers.js";

const app = await makeApp();
afterAll(() => app.close());

async function project(files: [string, string][] = [["src/app.ts", "const a = 1;\n"]]) {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Edit Co", template: "head-only" })).json().id as string;
  const body = multipart({ name: `P${Math.random()}`, source: "folder" }, files.map(([p, c]) => [p, p.split("/").pop()!, c]));
  const pid = (await app.inject({ method: "POST", url: `/api/workspaces/${id}/projects/upload`, payload: body.payload, headers: { ...body.headers, cookie, origin: ORIGIN } })).json().projectId;
  const base = `/api/workspaces/${id}/projects/${pid}`;
  const tree = async () => (await req("GET", `${base}/tree`)).json().entries.map((e: { path: string }) => e.path);
  return { req, id, pid, base, tree };
}

test("read, save with revision bump, and history", async () => {
  const { req, base } = await project();
  const file = (await req("GET", `${base}/files?path=src/app.ts`)).json();
  expect(file).toEqual({ path: "src/app.ts", content: "const a = 1;\n", revision: 1 });
  const saved = await req("PUT", `${base}/files`, { path: "src/app.ts", content: "const a = 2;\n", baseRevision: 1 });
  expect(saved.json()).toEqual({ revision: 2 });
  expect((await req("GET", `${base}/files?path=src/app.ts`)).json().content).toBe("const a = 2;\n");
  const history = (await req("GET", `${base}/history?path=src/app.ts`)).json().revisions;
  expect(history.map((h: { revision: number; reason: string }) => [h.revision, h.reason])).toEqual([
    [2, "edit"],
    [1, "upload"],
  ]);
});

test("a stale save is refused with 409 and changes nothing", async () => {
  const { req, base } = await project();
  await req("PUT", `${base}/files`, { path: "src/app.ts", content: "mine", baseRevision: 1 });
  const stale = await req("PUT", `${base}/files`, { path: "src/app.ts", content: "theirs", baseRevision: 1 });
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.message).toMatch(/changed since you opened it/);
  expect((await req("GET", `${base}/files?path=src/app.ts`)).json().content).toBe("mine");
});

test("new files via save, folders, and validation", async () => {
  const { req, base, tree } = await project();
  expect((await req("PUT", `${base}/files`, { path: "docs/guide/intro.md", content: "# Hi", baseRevision: 0 })).json()).toEqual({ revision: 1 });
  expect((await req("PUT", `${base}/files`, { path: "SRC/APP.ts", content: "dup", baseRevision: 0 })).statusCode).toBe(409);
  expect((await req("PUT", `${base}/files`, { path: ".env", content: "S=1", baseRevision: 0 })).statusCode).toBe(400);
  expect((await req("PUT", `${base}/files`, { path: "k.txt", content: "-----BEGIN EC PRIVATE KEY-----", baseRevision: 0 })).statusCode).toBe(400);
  expect((await req("PUT", `${base}/files`, { path: "big.txt", content: "x".repeat(1024 * 1024 + 1), baseRevision: 0 })).statusCode).toBe(413);
  expect((await req("POST", `${base}/folders`, { path: "assets/img" })).statusCode).toBe(201);
  expect(await tree()).toEqual(["assets", "assets/img", "docs", "docs/guide", "docs/guide/intro.md", "src", "src/app.ts"]);
});

test("move a file and a folder with children; refuse moving into itself or onto an existing path", async () => {
  const { req, base, tree } = await project([["src/a.ts", "a"], ["src/lib/b.ts", "b"], ["other.ts", "o"]]);
  expect((await req("POST", `${base}/move`, { from: "other.ts", to: "src/other.ts" })).statusCode).toBe(200);
  expect((await req("POST", `${base}/move`, { from: "src", to: "app" })).statusCode).toBe(200);
  expect(await tree()).toEqual(["app", "app/a.ts", "app/lib", "app/lib/b.ts", "app/other.ts"]);
  expect((await req("POST", `${base}/move`, { from: "app", to: "app/lib/app" })).statusCode).toBe(400);
  expect((await req("POST", `${base}/move`, { from: "app/a.ts", to: "app/other.ts" })).statusCode).toBe(409);
  expect((await req("GET", `${base}/files?path=app/lib/b.ts`)).json().content).toBe("b");
  const rev = (await req("GET", `${base}/history?path=app/other.ts`)).json().revisions[0];
  expect(rev).toMatchObject({ reason: "rename", fromPath: "other.ts" });
});

test("delete a folder removes its children and updates counts", async () => {
  const { req, pid, base, tree } = await project([["src/a.ts", "a"], ["src/lib/b.ts", "b"], ["keep.md", "k"]]);
  expect((await req("DELETE", `${base}/entries?path=src`)).statusCode).toBe(204);
  expect(await tree()).toEqual(["keep.md"]);
  expect(await prisma.project.findUniqueOrThrow({ where: { id: pid } })).toMatchObject({ fileCount: 1, totalBytes: 1 });
});

test("view and restore an old version", async () => {
  const { req, base } = await project();
  await req("PUT", `${base}/files`, { path: "src/app.ts", content: "v2", baseRevision: 1 });
  const v1 = (await req("GET", `${base}/history?path=src/app.ts`)).json().revisions.find((r: { revision: number }) => r.revision === 1);
  expect((await req("GET", `${base}/history/${v1.id}`)).json().content).toBe("const a = 1;\n");
  expect((await req("POST", `${base}/restore`, { path: "src/app.ts", revisionId: v1.id })).json()).toEqual({ revision: 3 });
  expect((await req("GET", `${base}/files?path=src/app.ts`)).json()).toMatchObject({ content: "const a = 1;\n", revision: 3 });
});

test("binary files can't be opened as text; viewers can't edit; other workspaces get 404", async () => {
  const { req, id, base } = await project([["logo.png", "\u0000\u0001PNG"]]);
  expect((await req("GET", `${base}/files?path=logo.png`)).statusCode).toBe(415);
  const viewer = await signUp(app);
  const vid = (await client(app, viewer.cookie)("GET", "/api/me")).json().user.id;
  await prisma.membership.create({ data: { workspaceId: id, userId: vid, role: "viewer" } });
  expect((await client(app, viewer.cookie)("PUT", `${base}/files`, { path: "x.txt", content: "x", baseRevision: 0 })).statusCode).toBe(403);
  const stranger = client(app, (await signUp(app)).cookie);
  expect((await stranger("GET", `${base}/files?path=logo.png`)).statusCode).toBe(404);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/files.test.ts`
Expected: FAIL, routes 404.

- [ ] **Step 3: Write `backend/src/routes/files.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { exclusionReason, LIMITS, parentDirs, PRIVATE_KEY } from "../files/rules.js";
import { loadEntry, loadProject, ProjectParams, recount, requirePath } from "../files/service.js";
import { getBlob, isTextContent, putBlob } from "../files/store.js";
import { HttpError, perUser, requireMember } from "../http.js";

const Save = z.object({ path: z.string().max(1024), content: z.string(), baseRevision: z.number().int().min(0) });
const PathBody = z.object({ path: z.string().max(1024) });
const Move = z.object({ from: z.string().max(1024), to: z.string().max(1024) });
const Restore = z.object({ path: z.string().max(1024), revisionId: z.string().min(1).max(64) });

async function ensureParents(projectId: string, path: string, userId: string) {
  const dirs = parentDirs(path);
  if (!dirs.length) return;
  const blockers = await prisma.projectEntry.findMany({ where: { projectId, kind: "file", pathLower: { in: dirs.map((d) => d.toLowerCase()) } } });
  if (blockers.length) throw new HttpError(409, "conflict", `${blockers[0].path} is a file, not a folder`);
  await prisma.projectEntry.createMany({ data: dirs.map((d) => ({ projectId, path: d, pathLower: d.toLowerCase(), kind: "dir" as const, updatedById: userId })), skipDuplicates: true });
}

function checkAllowed(path: string, kind: "file" | "dir") {
  const reason = exclusionReason(path, kind);
  if (reason) throw new HttpError(400, "invalid", `This isn't allowed in projects: ${reason}`);
}

export async function fileRoutes(app: FastifyInstance) {
  const saveLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute", keyGenerator: perUser } } };

  app.get("/api/workspaces/:id/projects/:pid/files", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const path = requirePath((req.query as { path?: string }).path);
    const entry = await loadEntry(pid, path);
    if (entry.kind !== "file" || !entry.isText || entry.size > LIMITS.maxEditorBytes) {
      throw new HttpError(415, "not_text", "This file can't be opened in the editor. Download it instead.");
    }
    return { path: entry.path, content: (await getBlob(entry.blobHash!)).toString("utf8"), revision: entry.revision };
  });

  app.put("/api/workspaces/:id/projects/:pid/files", saveLimit, async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const project = await loadProject(id, pid);
    const body = Save.parse(req.body);
    const path = requirePath(body.path);
    checkAllowed(path, "file");
    const data = Buffer.from(body.content, "utf8");
    if (data.length > LIMITS.maxEditorBytes) throw new HttpError(413, "too_large", "Files edited here can be up to 1 MB");
    if (PRIVATE_KEY.test(body.content)) throw new HttpError(400, "invalid", "This file contains a private key, which isn't allowed in projects");
    const existing = await prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId: pid, pathLower: path.toLowerCase() } } });
    const growth = data.length - (existing?.size ?? 0);
    if (project.totalBytes + growth > LIMITS.maxTotalBytes) throw new HttpError(413, "too_large", "The project has reached 50 MB");
    const blobHash = await putBlob(data);

    if (body.baseRevision === 0) {
      if (existing) throw new HttpError(409, "conflict", "A file or folder with this name already exists");
      if (project.fileCount + 1 > LIMITS.maxEntries) throw new HttpError(413, "too_large", "The project has reached 2,000 files and folders");
      await ensureParents(pid, path, user.id);
      await prisma.$transaction(async (tx) => {
        const entry = await tx.projectEntry.create({ data: { projectId: pid, path, pathLower: path.toLowerCase(), kind: "file", blobHash, size: data.length, isText: true, revision: 1, updatedById: user.id } });
        await tx.fileRevision.create({ data: { entryId: entry.id, projectId: pid, blobHash, size: data.length, revision: 1, reason: "edit", createdById: user.id } });
        await recount(tx, pid);
      });
      return { revision: 1 };
    }

    if (!existing || existing.kind !== "file") throw new HttpError(404, "not_found", "File not found");
    if (!existing.isText) throw new HttpError(415, "not_text", "Binary files can't be edited here");
    const next = body.baseRevision + 1;
    const updated = await prisma.$transaction(async (tx) => {
      // Conditional update: only succeeds if nobody saved since this revision was opened.
      const r = await tx.projectEntry.updateMany({
        where: { id: existing.id, revision: body.baseRevision },
        data: { blobHash, size: data.length, revision: next, updatedById: user.id },
      });
      if (r.count === 0) return false;
      await tx.fileRevision.create({ data: { entryId: existing.id, projectId: pid, blobHash, size: data.length, revision: next, reason: "edit", createdById: user.id } });
      await recount(tx, pid);
      return true;
    });
    if (!updated) throw new HttpError(409, "conflict", "This file changed since you opened it. Reload to see the latest version.");
    return { revision: next };
  });

  app.post("/api/workspaces/:id/projects/:pid/folders", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    const project = await loadProject(id, pid);
    const path = requirePath(PathBody.parse(req.body).path);
    checkAllowed(path, "dir");
    if (await prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId: pid, pathLower: path.toLowerCase() } } })) {
      throw new HttpError(409, "conflict", "A file or folder with this name already exists");
    }
    if (project.fileCount + 1 > LIMITS.maxEntries) throw new HttpError(413, "too_large", "The project has reached 2,000 files and folders");
    await ensureParents(pid, path, user.id);
    await prisma.projectEntry.create({ data: { projectId: pid, path, pathLower: path.toLowerCase(), kind: "dir", updatedById: user.id } });
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/workspaces/:id/projects/:pid/move", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadProject(id, pid);
    const body = Move.parse(req.body);
    const from = requirePath(body.from);
    const to = requirePath(body.to);
    const entry = await loadEntry(pid, from);
    checkAllowed(to, entry.kind);
    if (to.toLowerCase().startsWith(`${from.toLowerCase()}/`)) throw new HttpError(400, "invalid", "A folder can't be moved into itself");
    const sameEntry = to.toLowerCase() === from.toLowerCase();
    if (!sameEntry && (await prisma.projectEntry.findUnique({ where: { projectId_pathLower: { projectId: pid, pathLower: to.toLowerCase() } } }))) {
      throw new HttpError(409, "conflict", "Something with that name already exists there");
    }
    await ensureParents(pid, to, user.id);
    const fromLower = from.toLowerCase();
    await prisma.$transaction(async (tx) => {
      // One statement renames the entry and everything under it (starts_with avoids LIKE wildcards).
      await tx.$executeRaw`
        UPDATE "ProjectEntry"
        SET "path" = ${to} || substr("path", ${from.length + 1}),
            "pathLower" = lower(${to} || substr("path", ${from.length + 1})),
            "updatedAt" = now()
        WHERE "projectId" = ${pid} AND ("pathLower" = ${fromLower} OR starts_with("pathLower", ${`${fromLower}/`}))`;
      if (entry.kind === "file") {
        await tx.fileRevision.create({ data: { entryId: entry.id, projectId: pid, blobHash: entry.blobHash!, size: entry.size, revision: entry.revision, reason: "rename", fromPath: from, createdById: user.id } });
      }
    });
    return { ok: true };
  });

  app.delete("/api/workspaces/:id/projects/:pid/entries", async (req, reply) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id, "member");
    await loadProject(id, pid);
    const path = requirePath((req.query as { path?: string }).path);
    const entry = await loadEntry(pid, path);
    await prisma.$transaction(async (tx) => {
      await tx.projectEntry.deleteMany({ where: { projectId: pid, OR: [{ id: entry.id }, { pathLower: { startsWith: `${path.toLowerCase()}/` } }] } });
      await recount(tx, pid);
    });
    return reply.code(204).send();
  });

  app.get("/api/workspaces/:id/projects/:pid/history", async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const entry = await loadEntry(pid, requirePath((req.query as { path?: string }).path));
    const rows = await prisma.fileRevision.findMany({ where: { entryId: entry.id }, orderBy: [{ revision: "desc" }, { createdAt: "desc" }] });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return { revisions: rows.map((r) => ({ id: r.id, revision: r.revision, reason: r.reason, size: r.size, fromPath: r.fromPath, createdAt: r.createdAt, createdBy: nameOf.get(r.createdById) ?? "Someone" })) };
  });

  app.get("/api/workspaces/:id/projects/:pid/history/:revisionId", async (req) => {
    const { id, pid, revisionId } = ProjectParams.extend({ revisionId: z.string().min(1).max(64) }).parse(req.params);
    await requireMember(req, id);
    await loadProject(id, pid);
    const rev = await prisma.fileRevision.findFirst({ where: { id: revisionId, projectId: pid } });
    if (!rev) throw new HttpError(404, "not_found", "Version not found");
    const data = await getBlob(rev.blobHash);
    if (!isTextContent(data) || data.length > LIMITS.maxEditorBytes) throw new HttpError(415, "not_text", "This version can't be shown as text");
    return { content: data.toString("utf8"), revision: rev.revision };
  });

  app.post("/api/workspaces/:id/projects/:pid/restore", saveLimit, async (req) => {
    const { id, pid } = ProjectParams.parse(req.params);
    const { user } = await requireMember(req, id, "member");
    await loadProject(id, pid);
    const body = Restore.parse(req.body);
    const entry = await loadEntry(pid, requirePath(body.path));
    const rev = await prisma.fileRevision.findFirst({ where: { id: body.revisionId, entryId: entry.id } });
    if (!rev) throw new HttpError(404, "not_found", "Version not found");
    const next = entry.revision + 1;
    const data = await getBlob(rev.blobHash);
    await prisma.$transaction(async (tx) => {
      await tx.projectEntry.update({ where: { id: entry.id }, data: { blobHash: rev.blobHash, size: rev.size, isText: isTextContent(data), revision: next, updatedById: user.id } });
      await tx.fileRevision.create({ data: { entryId: entry.id, projectId: pid, blobHash: rev.blobHash, size: rev.size, revision: next, reason: "restore", createdById: user.id } });
      await recount(tx, pid);
    });
    return { revision: next };
  });
}
```

- [ ] **Step 4: Register and run**

In `backend/src/app.ts` add `import { fileRoutes } from "./routes/files.js";` and `await app.register(fileRoutes);` after `uploadRoutes`.

Run: `npx vitest run test/files.test.ts && npx tsc --noEmit && echo TSC_OK`
Expected: 7 passed, `TSC_OK`.

- [ ] **Step 5: Run the whole backend suite (keep the Mac awake), then commit**

Run: `caffeinate -i npm test 2>&1 | grep -E "Tests |Test Files|×"`
Expected: every file passes.

```bash
git add backend/src backend/test/files.test.ts
git commit -m "feat(backend): read, save with conflicts, folders, move, delete, history, restore"
```

---

### Task 6: Projects page and upload dialog

**Files:**
- Create: `frontend/src/lib/file-rules.ts`, `frontend/src/lib/file-rules.test.ts`, `frontend/src/lib/projects.ts`, `frontend/src/app/w/[slug]/projects/page.tsx`, `frontend/src/components/app/files/UploadDialog.tsx`
- Modify: `frontend/src/components/app/AppShell.tsx`, `backend/test/file-rules.test.ts`

**Interfaces:**
- Produces:
  - Frontend `file-rules.ts`: identical exports to backend `rules.ts` (`LIMITS`, `EXCLUDED_DIRS`, `EXCLUDED_FILES`, `KEEP_FILES`, `PRIVATE_KEY`, `normalizePath`, `exclusionReason`, `parentDirs`).
  - `projects.ts`: types `ProjectSummary`, `TreeEntry`; `type Picked = { path: string; file: File }`; `collectFromInput(files: FileList): Picked[]`; `collectFromDrop(items: DataTransferItemList): Promise<{ files: Picked[]; dirs: string[] }>`; `planUpload(files: Picked[], dirs: string[], include: Set<string>): Plan` where `type Plan = { included: Picked[]; excluded: { path: string; reason: string; top: string | null }[]; dirs: string[]; bytes: number }`; `uploadBatches(opts): Promise<UploadResult>`; `formatBytes(n)`.
  - `UploadDialog({ mode, projectId?, onClose, onDone })`.

- [ ] **Step 1: Write the frontend rules and the parity test**

Copy `backend/src/files/rules.ts` verbatim to `frontend/src/lib/file-rules.ts` (it uses only `TextEncoder`, available in browsers).

`frontend/src/lib/file-rules.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { exclusionReason, normalizePath } from "./file-rules.ts";

test("browser rules match the server's on the key cases", () => {
  assert.equal(normalizePath("../x").ok, false);
  assert.equal(exclusionReason("app/node_modules/a.js", "file"), "node_modules folders are excluded");
  assert.equal(exclusionReason(".env.example", "file"), null);
  assert.equal(exclusionReason("keys/a.pem", "file"), "secret or credential file");
});
```

Add to `backend/test/file-rules.test.ts`:

```ts
import { readFileSync } from "node:fs";

test("the browser copy of the rules is identical to the server's", () => {
  const server = readFileSync(new URL("../src/files/rules.ts", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../../frontend/src/lib/file-rules.ts", import.meta.url), "utf8");
  expect(browser).toBe(server);
});
```

Run: `cd frontend && npm run test:unit 2>&1 | grep -E "^# (pass|fail)"` and `cd ../backend && npx vitest run test/file-rules.test.ts`
Expected: frontend pass, backend pass.

- [ ] **Step 2: Write `frontend/src/lib/projects.ts`**

```ts
import { exclusionReason, normalizePath, PRIVATE_KEY } from "./file-rules";

export type ProjectSummary = { id: string; name: string; fileCount: number; totalBytes: number; updatedAt: string };
export type TreeEntry = { path: string; kind: "file" | "dir"; size: number; isText: boolean; revision: number; updatedAt: string };
export type Picked = { path: string; file: File };
export type Plan = { included: Picked[]; excluded: { path: string; reason: string; top: string | null }[]; dirs: string[]; bytes: number };
export type UploadResult = { projectId: string; added: number; skipped: { path: string; reason: string }[]; cancelled: boolean };

export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function collectFromInput(files: FileList): Picked[] {
  return [...files].map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));
}

/** Walks dropped folders recursively (DataTransfer entries), keeping empty folders. */
export async function collectFromDrop(items: DataTransferItemList): Promise<{ files: Picked[]; dirs: string[] }> {
  const files: Picked[] = [];
  const dirs: string[] = [];
  const readAll = (reader: FileSystemDirectoryReader) =>
    new Promise<FileSystemEntry[]>((resolve, reject) => {
      const out: FileSystemEntry[] = [];
      const next = () => reader.readEntries((batch) => (batch.length ? (out.push(...batch), next()) : resolve(out)), reject);
      next();
    });
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      files.push({ path, file });
    } else if (entry.isDirectory) {
      const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
      if (!children.length) dirs.push(path);
      for (const c of children) await walk(c, path);
    }
  };
  const roots = [...items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  for (const r of roots) await walk(r, "");
  return { files, dirs };
}

/** Same rules as the server, so the preview shows exactly what will be skipped. */
export function planUpload(files: Picked[], dirs: string[], include: Set<string>): Plan {
  const plan: Plan = { included: [], excluded: [], dirs: [], bytes: 0 };
  for (const p of files) {
    const n = normalizePath(p.path);
    if (!n.ok) {
      plan.excluded.push({ path: p.path, reason: n.reason, top: null });
      continue;
    }
    const reason = exclusionReason(n.path, "file");
    const top = reason?.endsWith("folders are excluded") ? reason.split(" ")[0] : null;
    if (reason && !(top && include.has(top))) {
      plan.excluded.push({ path: n.path, reason, top });
      continue;
    }
    plan.included.push({ path: n.path, file: p.file });
    plan.bytes += p.file.size;
  }
  plan.dirs = dirs.filter((d) => normalizePath(d).ok);
  return plan;
}

const BATCH_FILES = 100;
const BATCH_BYTES = 20 * 1024 * 1024;

export async function uploadBatches(opts: {
  workspaceId: string;
  projectId?: string;
  name?: string;
  source: "folder" | "files";
  plan: Plan;
  onProgress: (done: number, total: number) => void;
  isCancelled: () => boolean;
}): Promise<UploadResult> {
  const { plan } = opts;
  const batches: Picked[][] = [];
  let current: Picked[] = [];
  let size = 0;
  for (const p of plan.included) {
    if (current.length && (current.length >= BATCH_FILES || size + p.file.size > BATCH_BYTES)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.file.size;
  }
  if (current.length || !batches.length) batches.push(current);

  let projectId = opts.projectId;
  let importId: string | undefined;
  const result: UploadResult = { projectId: projectId ?? "", added: 0, skipped: [], cancelled: false };
  for (const [i, batch] of batches.entries()) {
    if (opts.isCancelled()) {
      result.cancelled = true;
      break;
    }
    const form = new FormData();
    form.append("source", opts.source);
    if (!projectId && opts.name) form.append("name", opts.name);
    if (importId) form.append("importId", importId);
    if (i === 0 && plan.dirs.length) form.append("dirs", JSON.stringify(plan.dirs));
    for (const p of batch) form.append(p.path, p.file, p.path.split("/").pop());
    const url = projectId ? `/api/workspaces/${opts.workspaceId}/projects/${projectId}/upload` : `/api/workspaces/${opts.workspaceId}/projects/upload`;
    const res = await fetch(url, { method: "POST", body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message ?? "Upload failed. Try again.");
    projectId = data.projectId;
    importId = data.importId;
    result.projectId = data.projectId;
    result.added += data.added;
    result.skipped.push(...data.skipped);
    opts.onProgress(i + 1, batches.length);
  }
  if (projectId && importId) {
    const fin = await fetch(`/api/workspaces/${opts.workspaceId}/projects/${projectId}/imports/${importId}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: result.cancelled ? "cancelled" : "complete" }),
    });
    const f = await fin.json().catch(() => null);
    if (f?.deletedProject) result.projectId = "";
  }
  return result;
}

export const containsPrivateKey = (text: string) => PRIVATE_KEY.test(text);
```

- [ ] **Step 3: Write `frontend/src/components/app/files/UploadDialog.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { collectFromDrop, collectFromInput, formatBytes, planUpload, uploadBatches, type Picked, type UploadResult } from "@/lib/projects";
import { useWorkspace } from "@/lib/workspace";

const field = "mt-1.5 w-full rounded-[10px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";

export function UploadDialog({ projectId, onClose, onDone }: { projectId?: string; onClose: () => void; onDone: (projectId: string) => void }) {
  const { snapshot } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const [picked, setPicked] = useState<{ files: Picked[]; dirs: string[]; source: "folder" | "files" } | null>(null);
  const [zip, setZip] = useState<File | null>(null);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const plan = useMemo(() => (picked ? planUpload(picked.files, picked.dirs, include) : null), [picked, include]);
  const tops = useMemo(() => [...new Set(plan?.excluded.map((e) => e.top).filter((t): t is string => !!t))], [plan]);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const input = folderInput.current;
    if (input) input.setAttribute("webkitdirectory", "");
  }, []);

  const firstFolder = (files: Picked[]) => files[0]?.path.split("/")[0] ?? "";
  const choose = (files: Picked[], dirs: string[], source: "folder" | "files") => {
    setZip(null);
    setPicked({ files, dirs, source });
    if (!projectId && !name) setName(source === "folder" ? firstFolder(files) : "New project");
  };

  async function start() {
    setError("");
    cancelled.current = false;
    try {
      if (zip) {
        const form = new FormData();
        form.append("source", "zip");
        if (!projectId) form.append("name", name);
        form.append("zip", zip, zip.name);
        setProgress([0, 1]);
        const url = projectId ? `/api/workspaces/${snapshot.workspace.id}/projects/${projectId}/upload` : `/api/workspaces/${snapshot.workspace.id}/projects/upload`;
        const res = await fetch(url, { method: "POST", body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error?.message ?? "Upload failed. Try again.");
        setProgress([1, 1]);
        setResult({ projectId: data.projectId, added: data.added, skipped: data.skipped, cancelled: false });
        return;
      }
      if (!plan || !picked) return;
      const r = await uploadBatches({
        workspaceId: snapshot.workspace.id,
        projectId,
        name: projectId ? undefined : name,
        source: picked.source,
        plan,
        onProgress: (d, t) => setProgress([d, t]),
        isCancelled: () => cancelled.current,
      });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  }

  const busy = progress !== null && !result;
  const ready = (zip || (plan && (plan.included.length || plan.dirs.length))) && (projectId || name.trim());

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="upload-title" className="m-auto w-[min(640px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-6 text-ink backdrop:bg-black/40">
      <h2 id="upload-title" className="text-xl font-semibold">{projectId ? "Upload into this project" : "Open a project"}</h2>
      {!result && (
        <>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const { files, dirs } = await collectFromDrop(e.dataTransfer.items);
              choose(files, dirs, dirs.length || files.some((f) => f.path.includes("/")) ? "folder" : "files");
            }}
            className="mt-4 grid place-items-center gap-3 rounded-[14px] border-2 border-dashed border-line p-6 text-center"
          >
            <p className="text-sm text-muted">Drop a folder or files here, or choose:</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => folderInput.current?.click()} className="btn-dark rounded-[10px] px-4 py-2 text-sm font-semibold">Upload folder</button>
              <button type="button" onClick={() => zipInput.current?.click()} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Upload ZIP</button>
              <button type="button" onClick={() => filesInput.current?.click()} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Upload files</button>
            </div>
            <input ref={folderInput} type="file" multiple hidden aria-label="Choose a folder" onChange={(e) => e.target.files && choose(collectFromInput(e.target.files), [], "folder")} />
            <input ref={filesInput} type="file" multiple hidden aria-label="Choose files" onChange={(e) => e.target.files && choose(collectFromInput(e.target.files), [], "files")} />
            <input ref={zipInput} type="file" accept=".zip,application/zip" hidden aria-label="Choose a ZIP file" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setPicked(null);
              setZip(f);
              if (!projectId && !name) setName(f.name.replace(/\.zip$/i, ""));
            }} />
          </div>

          {!projectId && (zip || plan) && (
            <label className="mt-4 block text-sm font-medium">
              Project name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={field} />
            </label>
          )}

          {zip && <p className="mt-4 text-sm">{zip.name} ({formatBytes(zip.size)}). Files are checked on the server; you&apos;ll see what was skipped afterwards.</p>}

          {plan && (
            <div className="mt-4 space-y-3 text-sm">
              <p>
                <strong>{plan.included.length}</strong> files ({formatBytes(plan.bytes)}){plan.dirs.length ? `, ${plan.dirs.length} empty folders` : ""} will be uploaded.
              </p>
              <details>
                <summary className="cursor-pointer text-muted">Show included files</summary>
                <ul className="mt-2 max-h-40 overflow-auto rounded-[10px] bg-bg p-2 font-mono text-xs">
                  {plan.included.slice(0, 500).map((p) => <li key={p.path}>{p.path}</li>)}
                  {plan.included.length > 500 && <li>…and {plan.included.length - 500} more</li>}
                </ul>
              </details>
              {plan.excluded.length > 0 && (
                <div>
                  <p>{plan.excluded.length} skipped:</p>
                  <ul className="mt-1 max-h-32 overflow-auto rounded-[10px] bg-bg p-2 text-xs">
                    {plan.excluded.slice(0, 200).map((e) => <li key={e.path}><span className="font-mono">{e.path}</span>: {e.reason}</li>)}
                  </ul>
                  {tops.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {tops.map((t) => (
                        <label key={t} className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={include.has(t)} onChange={(e) => setInclude((s) => { const n = new Set(s); if (e.target.checked) n.add(t); else n.delete(t); return n; })} />
                          Include {t} folders
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {progress && (
            <div className="mt-4" aria-live="polite">
              <div className="h-2 overflow-hidden rounded-full bg-bg">
                <div className="h-full bg-ink transition-all" style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">Uploading part {progress[0]} of {progress[1]}...</p>
            </div>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-[#b42318]">{error}</p>}
          <div className="mt-6 flex justify-end gap-2">
            {busy ? (
              <button type="button" onClick={() => (cancelled.current = true)} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Cancel upload</button>
            ) : (
              <button type="button" onClick={() => dialog.current?.close()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Cancel</button>
            )}
            <button type="button" disabled={!ready || busy} onClick={start} className="btn-dark rounded-[10px] px-4 py-2.5 text-sm font-semibold disabled:opacity-60">Upload</button>
          </div>
        </>
      )}
      {result && (
        <div className="mt-4 space-y-3 text-sm">
          <p role="status">{result.cancelled ? "Upload cancelled." : "Upload finished."} {result.added} files added{result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.</p>
          {result.skipped.length > 0 && (
            <ul className="max-h-40 overflow-auto rounded-[10px] bg-bg p-2 text-xs">
              {result.skipped.map((s) => <li key={s.path}><span className="font-mono">{s.path}</span>: {s.reason}</li>)}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={() => (result.projectId ? onDone(result.projectId) : dialog.current?.close())} className="btn-dark rounded-[10px] px-4 py-2.5 text-sm font-semibold">
              {result.projectId ? "Open project" : "Close"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export async function createEmptyProject(workspaceId: string, name: string) {
  return api<{ id: string }>(`/api/workspaces/${workspaceId}/projects`, { method: "POST", body: { name } });
}
```

- [ ] **Step 4: Write `frontend/src/app/w/[slug]/projects/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FolderSimple, Plus, UploadSimple } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { formatBytes, type ProjectSummary } from "@/lib/projects";
import { canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { createEmptyProject, UploadDialog } from "@/components/app/files/UploadDialog";

export default function ProjectsPage() {
  const { snapshot, wsPath } = useWorkspace();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const editable = canEdit(snapshot.role);
  const base = `/w/${snapshot.workspace.slug}/projects`;

  const load = useCallback(() => api<{ projects: ProjectSummary[] }>(wsPath("/projects")).then((r) => setProjects(r.projects)), [wsPath]);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function newProject() {
    const name = prompt("Project name");
    if (!name?.trim()) return;
    try {
      const { id } = await createEmptyProject(snapshot.workspace.id, name.trim());
      router.push(`${base}/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted">Upload a folder, ZIP, or files, then edit them here. Nothing you upload is run.</p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <button onClick={newProject} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><Plus size={14} /> New project</button>
            <button onClick={() => setUploading(true)} className="btn-dark flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><UploadSimple size={14} /> Open project</button>
          </div>
        )}
      </div>
      {error && <p role="alert" className="rounded-[10px] bg-[#fde8e6] px-4 py-3 text-sm text-[#7a1b12]">{error}</p>}
      {!projects && <div className="h-24 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
      {projects?.length === 0 && (
        <div className="rounded-[14px] border border-dashed border-line p-8 text-center">
          <FolderSimple size={28} className="mx-auto text-muted" />
          <p className="mt-2 font-medium">No projects yet</p>
          <p className="text-sm text-muted">{editable ? "Open a project by uploading a folder, ZIP, or files." : "An owner or member can upload one."}</p>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link href={`${base}/${p.id}`} className="block rounded-[14px] border border-line bg-paper p-4 hover:border-ink">
              <p className="font-semibold">{p.name}</p>
              <p className="text-sm text-muted">{p.fileCount} files · {formatBytes(p.totalBytes)}</p>
            </Link>
          </li>
        ))}
      </ul>
      {uploading && <UploadDialog onClose={() => setUploading(false)} onDone={(id) => router.push(`${base}/${id}`)} />}
    </main>
  );
}
```

- [ ] **Step 5: Add the nav item**

In `frontend/src/components/app/AppShell.tsx`, import `FolderSimple` and insert after the Office item:

```ts
    { href: `${base}/projects`, label: "Projects", icon: FolderSimple },
```

Change the active-link check to `const active = href === base ? pathname === href : pathname.startsWith(href);` so project pages keep "Projects" highlighted.

- [ ] **Step 6: Lint, type check, commit**

Run: `cd frontend && npm run lint && npx tsc --noEmit 2>&1 | grep -v '^\.next'; npm run test:unit 2>&1 | grep -E "^# (pass|fail)"`
Expected: lint 0, no `src/` errors, unit tests pass.

```bash
git add frontend backend/test/file-rules.test.ts
git commit -m "feat(frontend): projects page and upload dialog with preview"
```

---

### Task 7: Project workspace: tree, editor, history

**Files:**
- Install: `codemirror @codemirror/state @codemirror/view @codemirror/lang-javascript @codemirror/lang-json @codemirror/lang-html @codemirror/lang-css @codemirror/lang-markdown @codemirror/lang-python @codemirror/theme-one-dark`
- Create: `frontend/src/components/app/files/CodeEditor.tsx`, `frontend/src/components/app/files/FileTree.tsx`, `frontend/src/components/app/files/HistoryPanel.tsx`, `frontend/src/app/w/[slug]/projects/[pid]/page.tsx`

**Interfaces:**
- Consumes: Task 3 and Task 5 routes, `TreeEntry`, `UploadDialog`.
- Produces:
  - `CodeEditor({ value, path, readOnly, dark, onChange, onSave })` (client-only; `onSave` bound to Mod-s)
  - `FileTree({ entries, selected, filter, onOpen, onAction, editable })` with `onAction(kind: "rename" | "delete" | "download" | "history" | "newFile" | "newFolder" | "upload", path: string | null)`
  - `HistoryPanel({ path, base, editable, onRestored, onClose })`

- [ ] **Step 1: Install CodeMirror**

```bash
cd frontend && npm i codemirror@6 @codemirror/state@6 @codemirror/view@6 @codemirror/lang-javascript@6 @codemirror/lang-json@6 @codemirror/lang-html@6 @codemirror/lang-css@6 @codemirror/lang-markdown@6 @codemirror/lang-python@6 @codemirror/theme-one-dark@6
```

- [ ] **Step 2: Write `frontend/src/components/app/files/CodeEditor.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

function languageFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext && ["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext)) return javascript({ typescript: ext.startsWith("t"), jsx: ext.endsWith("x") });
  if (ext === "json") return json();
  if (ext === "html" || ext === "htm") return html();
  if (ext === "css") return css();
  if (ext === "md" || ext === "markdown") return markdown();
  if (ext === "py") return python();
  return [];
}

/** CodeMirror 6. Remounts per path so each file gets its own undo history. */
export function CodeEditor({ value, path, readOnly, dark, onChange, onSave }: { value: string; path: string; readOnly: boolean; dark: boolean; onChange: (v: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  const theme = useRef(new Compartment());
  callbacks.current = { onChange, onSave };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageFor(path),
          theme.current.of(dark ? oneDark : []),
          EditorState.readOnly.of(readOnly),
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (callbacks.current.onSave(), true) }]),
          EditorView.updateListener.of((u) => u.docChanged && callbacks.current.onChange(u.state.doc.toString())),
          EditorView.contentAttributes.of({ "aria-label": `Editing ${path}` }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Value is the initial document; later changes come from the editor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  // Replace the document when the parent loads a different version (reload, restore).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-full min-h-[300px] overflow-auto text-sm [&_.cm-editor]:h-full" />;
}
```

Note: the `run` callback uses a comma expression; if lint flags `no-unused-expressions`, write it as `run: () => { callbacks.current.onSave(); return true; }`.

- [ ] **Step 3: Write `frontend/src/components/app/files/FileTree.tsx`**

```tsx
"use client";

import { useState } from "react";
import { CaretDown, CaretRight, File, Folder } from "@phosphor-icons/react";
import type { TreeEntry } from "@/lib/projects";

export type TreeAction = "rename" | "delete" | "download" | "history" | "newFile" | "newFolder" | "upload";

export function FileTree({ entries, selected, filter, editable, onOpen, onAction }: {
  entries: TreeEntry[];
  selected: string | null;
  filter: string;
  editable: boolean;
  onOpen: (path: string) => void;
  onAction: (kind: TreeAction, path: string | null) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const q = filter.trim().toLowerCase();
  const visible = entries.filter((e) => {
    if (q) return e.kind === "file" && e.path.toLowerCase().includes(q);
    const parts = e.path.split("/");
    return !parts.slice(0, -1).some((_, i) => closed.has(parts.slice(0, i + 1).join("/")));
  });
  const toggle = (p: string) => setClosed((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  if (!entries.length) return <p className="p-3 text-sm text-muted">This project is empty. {editable ? "Upload files or create one." : ""}</p>;
  return (
    <ul role="tree" aria-label="Project files" className="text-sm">
      {visible.map((e) => {
        const depth = q ? 0 : e.path.split("/").length - 1;
        const name = q ? e.path : e.path.split("/").pop();
        const isOpen = !closed.has(e.path);
        return (
          <li key={e.path} role="treeitem" aria-selected={selected === e.path} aria-expanded={e.kind === "dir" ? isOpen : undefined} className="group flex items-center">
            <button
              onClick={() => (e.kind === "dir" ? toggle(e.path) : onOpen(e.path))}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] py-1 pr-2 text-left hover:bg-bg ${selected === e.path ? "bg-bg font-medium" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {e.kind === "dir" ? (isOpen ? <CaretDown size={12} /> : <CaretRight size={12} />) : <span className="w-3" />}
              {e.kind === "dir" ? <Folder size={14} className="shrink-0 text-muted" /> : <File size={14} className="shrink-0 text-muted" />}
              <span className="truncate">{name}</span>
            </button>
            <details className="relative">
              <summary aria-label={`Actions for ${e.path}`} className="cursor-pointer rounded-[6px] px-1.5 text-muted opacity-60 hover:bg-bg group-hover:opacity-100">⋯</summary>
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-[10px] border border-line bg-paper p-1 shadow-lg">
                {e.kind === "file" && <button onClick={() => onAction("download", e.path)} className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-bg">Download</button>}
                {e.kind === "file" && <button onClick={() => onAction("history", e.path)} className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-bg">History</button>}
                {editable && e.kind === "dir" && <button onClick={() => onAction("newFile", e.path)} className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-bg">New file here</button>}
                {editable && e.kind === "dir" && <button onClick={() => onAction("newFolder", e.path)} className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-bg">New folder here</button>}
                {editable && <button onClick={() => onAction("rename", e.path)} className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-bg">Rename or move</button>}
                {editable && <button onClick={() => onAction("delete", e.path)} className="block w-full rounded-[6px] px-2 py-1.5 text-left text-[#b42318] hover:bg-bg">Delete</button>}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Write `frontend/src/components/app/files/HistoryPanel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Rev = { id: string; revision: number; reason: string; size: number; fromPath: string | null; createdAt: string; createdBy: string };
const REASON: Record<string, string> = { upload: "Uploaded", edit: "Edited", restore: "Restored", rename: "Renamed" };

export function HistoryPanel({ path, base, editable, onRestored, onClose }: { path: string; base: string; editable: boolean; onRestored: () => void; onClose: () => void }) {
  const [revs, setRevs] = useState<Rev[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; content: string } | null>(null);
  const [error, setError] = useState("");
  const q = `path=${encodeURIComponent(path)}`;

  useEffect(() => {
    api<{ revisions: Rev[] }>(`${base}/history?${q}`).then((r) => setRevs(r.revisions), (e) => setError((e as Error).message));
  }, [base, q]);

  return (
    <aside aria-label="File history" className="flex h-full flex-col border-l border-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">History</h2>
        <button onClick={onClose} className="rounded-[8px] px-2 py-1 text-sm hover:bg-bg">Close</button>
      </div>
      <p className="truncate text-xs text-muted">{path}</p>
      {error && <p role="alert" className="mt-2 text-sm text-[#b42318]">{error}</p>}
      <ul className="mt-3 space-y-2 overflow-auto text-sm">
        {revs?.map((r, i) => (
          <li key={r.id} className="rounded-[10px] border border-line p-2.5">
            <p className="font-medium">Version {r.revision}{i === 0 ? " (current)" : ""}</p>
            <p className="text-xs text-muted">{REASON[r.reason] ?? r.reason}{r.fromPath ? ` from ${r.fromPath}` : ""} by {r.createdBy}, {new Date(r.createdAt).toLocaleString()}</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => api<{ content: string }>(`${base}/history/${r.id}`).then((v) => setPreview({ id: r.id, content: v.content }), (e) => setError((e as Error).message))} className="btn-light rounded-[8px] px-2.5 py-1 text-xs font-semibold">View</button>
              {editable && i > 0 && (
                <button
                  onClick={async () => {
                    if (!confirm(`Restore version ${r.revision}? Your current text becomes an older version, so nothing is lost.`)) return;
                    try {
                      await api(`${base}/restore`, { method: "POST", body: { path, revisionId: r.id } });
                      onRestored();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                  className="btn-dark rounded-[8px] px-2.5 py-1 text-xs font-semibold"
                >
                  Restore
                </button>
              )}
            </div>
            {preview?.id === r.id && <pre className="mt-2 max-h-48 overflow-auto rounded-[8px] bg-bg p-2 text-xs">{preview.content}</pre>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 5: Write `frontend/src/app/w/[slug]/projects/[pid]/page.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DownloadSimple, FilePlus, FolderPlus, UploadSimple } from "@phosphor-icons/react";
import { api, ApiError } from "@/lib/api";
import { formatBytes, type ProjectSummary, type TreeEntry } from "@/lib/projects";
import { canAdmin, canEdit } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { FileTree, type TreeAction } from "@/components/app/files/FileTree";
import { HistoryPanel } from "@/components/app/files/HistoryPanel";
import { UploadDialog } from "@/components/app/files/UploadDialog";

const CodeEditor = dynamic(() => import("@/components/app/files/CodeEditor").then((m) => m.CodeEditor), { ssr: false, loading: () => <div className="h-full animate-pulse bg-bg" /> });

type Open = { path: string; content: string; saved: string; revision: number; kind: "text" } | { path: string; kind: "image" | "binary"; size: number };
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

export default function ProjectWorkspace() {
  const { snapshot, wsPath } = useWorkspace();
  const { pid } = useParams<{ pid: string }>();
  const base = wsPath(`/projects/${pid}`);
  const editable = canEdit(snapshot.role);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pane, setPane] = useState<"tree" | "editor">("tree");
  const dark = snapshot.preferences.theme === "dark" || (snapshot.preferences.theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const loadTree = useCallback(() => api<{ project: ProjectSummary; entries: TreeEntry[] }>(`${base}/tree`).then((r) => { setProject(r.project); setEntries(r.entries); }), [base]);
  useEffect(() => {
    loadTree().catch((e) => setNotice((e as Error).message));
  }, [loadTree]);

  const dirty = open?.kind === "text" && open.content !== open.saved;
  const q = (p: string) => `path=${encodeURIComponent(p)}`;

  async function openFile(path: string) {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    setConflict(false);
    setNotice("");
    setPane("editor");
    const entry = entries.find((e) => e.path === path);
    if (IMAGE.test(path)) return setOpen({ path, kind: "image", size: entry?.size ?? 0 });
    try {
      const f = await api<{ content: string; revision: number }>(`${base}/files?${q(path)}`);
      setOpen({ path, kind: "text", content: f.content, saved: f.content, revision: f.revision });
    } catch (e) {
      if (e instanceof ApiError && e.status === 415) setOpen({ path, kind: "binary", size: entry?.size ?? 0 });
      else setNotice((e as Error).message);
    }
  }

  async function save() {
    if (open?.kind !== "text" || busy) return;
    setBusy(true);
    try {
      const r = await api<{ revision: number }>(`${base}/files`, { method: "PUT", body: { path: open.path, content: open.content, baseRevision: open.revision } });
      setOpen({ ...open, saved: open.content, revision: r.revision });
      setNotice(`Saved version ${r.revision}.`);
      await loadTree();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(kind: TreeAction, path: string | null) {
    setNotice("");
    try {
      if (kind === "download" && path) window.location.assign(`${base}/download?${q(path)}`);
      if (kind === "history" && path) setHistory(path);
      if (kind === "upload") setUploading(true);
      if (kind === "newFile" || kind === "newFolder") {
        const name = prompt(kind === "newFile" ? "New file name (for example notes.md)" : "New folder name");
        if (!name?.trim()) return;
        const target = path ? `${path}/${name.trim()}` : name.trim();
        if (kind === "newFile") {
          await api(`${base}/files`, { method: "PUT", body: { path: target, content: "", baseRevision: 0 } });
          await loadTree();
          await openFile(target);
        } else {
          await api(`${base}/folders`, { method: "POST", body: { path: target } });
          await loadTree();
        }
      }
      if (kind === "rename" && path) {
        const to = prompt("New path", path);
        if (!to?.trim() || to.trim() === path) return;
        await api(`${base}/move`, { method: "POST", body: { from: path, to: to.trim() } });
        if (open && (open.path === path || open.path.startsWith(`${path}/`))) setOpen(null);
        await loadTree();
      }
      if (kind === "delete" && path) {
        if (!confirm(`Delete ${path}? Its history is deleted too.`)) return;
        await api(`${base}/entries?${q(path)}`, { method: "DELETE" });
        if (open && (open.path === path || open.path.startsWith(`${path}/`))) setOpen(null);
        await loadTree();
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  const projectsHref = `/w/${snapshot.workspace.slug}/projects`;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-3">
        <Link href={projectsHref} className="text-sm text-muted hover:underline">Projects</Link>
        <span className="text-muted">/</span>
        <h1 className="mr-auto truncate font-semibold">{project?.name ?? "Project"}</h1>
        {project && <span className="text-xs text-muted">{project.fileCount} files · {formatBytes(project.totalBytes)}</span>}
        <a href={`${base}/download.zip`} className="btn-light flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold"><DownloadSimple size={14} /> Download ZIP</a>
        {canAdmin(snapshot.role) && (
          <button
            onClick={async () => {
              if (!confirm(`Delete the project ${project?.name}? This can't be undone.`)) return;
              await api(base, { method: "DELETE" }).then(() => window.location.assign(projectsHref), (e) => setNotice((e as Error).message));
            }}
            className="rounded-[10px] px-3 py-2 text-sm font-semibold text-[#b42318] hover:bg-bg"
          >
            Delete project
          </button>
        )}
      </div>
      {notice && <p role="status" className="bg-bg px-4 py-2 text-sm">{notice}</p>}
      <div className="flex gap-1 border-b border-line p-1 lg:hidden" role="group" aria-label="View">
        {(["tree", "editor"] as const).map((p) => (
          <button key={p} aria-pressed={pane === p} onClick={() => setPane(p)} className={`flex-1 rounded-[8px] py-1.5 text-sm ${pane === p ? "bg-ink text-paper" : ""}`}>{p === "tree" ? "Files" : "Editor"}</button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1">
        <section aria-label="Files" className={`${pane === "tree" ? "flex" : "hidden"} w-full flex-col border-r border-line bg-paper lg:flex lg:w-72`}>
          <div className="flex items-center gap-1 border-b border-line p-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Filter files</span>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" className="w-full rounded-[8px] border border-line bg-bg px-2.5 py-1.5 text-sm" />
            </label>
            {editable && (
              <>
                <button aria-label="New file" onClick={() => act("newFile", null)} className="rounded-[8px] p-1.5 hover:bg-bg"><FilePlus size={16} /></button>
                <button aria-label="New folder" onClick={() => act("newFolder", null)} className="rounded-[8px] p-1.5 hover:bg-bg"><FolderPlus size={16} /></button>
                <button aria-label="Upload into project" onClick={() => act("upload", null)} className="rounded-[8px] p-1.5 hover:bg-bg"><UploadSimple size={16} /></button>
              </>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            <FileTree entries={entries} selected={open?.path ?? null} filter={filter} editable={editable} onOpen={openFile} onAction={act} />
          </div>
        </section>
        <section aria-label="Editor" className={`${pane === "editor" ? "flex" : "hidden"} min-w-0 flex-1 flex-col lg:flex`}>
          {!open && <p className="m-auto p-6 text-sm text-muted">Choose a file to open it.</p>}
          {open && (
            <>
              <div className="flex items-center gap-2 border-b border-line bg-paper px-3 py-2">
                <p className="min-w-0 flex-1 truncate font-mono text-sm">{open.path}{dirty ? " ●" : ""}</p>
                {open.kind === "text" && <button onClick={() => setHistory(open.path)} className="rounded-[8px] px-2.5 py-1.5 text-sm hover:bg-bg">History</button>}
                {open.kind === "text" && editable && <button disabled={!dirty || busy} onClick={save} className="btn-dark rounded-[10px] px-3 py-1.5 text-sm font-semibold disabled:opacity-60">{busy ? "Saving..." : "Save"}</button>}
              </div>
              {conflict && (
                <div role="alert" className="flex flex-wrap items-center gap-2 bg-[#fff4d6] px-3 py-2 text-sm text-[#5c4300]">
                  This file changed since you opened it. Your text is still here.
                  <button onClick={() => navigator.clipboard?.writeText(open.kind === "text" ? open.content : "")} className="underline">Copy my text</button>
                  <button onClick={() => { setConflict(false); setOpen(null); openFile(open.path); }} className="underline">Load the latest version</button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {open.kind === "text" && (
                  <CodeEditor key={open.path} value={open.content} path={open.path} readOnly={!editable} dark={dark} onChange={(v) => setOpen((o) => (o && o.kind === "text" ? { ...o, content: v } : o))} onSave={save} />
                )}
                {open.kind === "image" && (
                  <div className="grid h-full place-items-center bg-bg p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${base}/download?${q(open.path)}`} alt={open.path} className="max-h-full max-w-full rounded-[8px] border border-line" />
                  </div>
                )}
                {open.kind === "binary" && (
                  <div className="m-auto grid h-full place-items-center p-6 text-center text-sm">
                    <div>
                      <p>This file can&apos;t be opened in the editor ({formatBytes(open.size)}).</p>
                      <a href={`${base}/download?${q(open.path)}`} className="btn-dark mt-3 inline-block rounded-[10px] px-4 py-2 font-semibold">Download</a>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
        {history && (
          <div className="fixed inset-y-0 right-0 z-30 w-[min(360px,100vw)] lg:static lg:z-auto">
            <HistoryPanel
              path={history}
              base={base}
              editable={editable}
              onClose={() => setHistory(null)}
              onRestored={async () => {
                setHistory(null);
                await loadTree();
                if (open?.path === history) {
                  setOpen(null);
                  await openFile(history);
                }
                setNotice("Version restored.");
              }}
            />
          </div>
        )}
      </div>
      {uploading && <UploadDialog projectId={pid} onClose={() => setUploading(false)} onDone={() => { setUploading(false); loadTree(); }} />}
    </div>
  );
}
```

- [ ] **Step 6: Lint, type check, browser check**

Run: `npm run lint && npx tsc --noEmit 2>&1 | grep -v '^\.next'; echo checked`
Expected: lint 0, no `src/` errors.

Browser (dev servers running; backend restarted for new routes): Projects → Open project → Upload folder (a nested sample folder with a `node_modules` subfolder and a `.env`), preview lists exclusions, upload, open the project, open a `.ts` file (syntax colors), edit, Cmd+S saves ("Saved version 2"), History shows versions 2 and 1, Restore version 1, rename a folder, delete a file, Download ZIP downloads. Repeat at 390px width (Files/Editor toggle) and in dark theme. Edit the same file in two tabs: the second save shows the conflict banner and keeps the text.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(frontend): project workspace with file tree, code editor, and history"
```

---

### Task 8: End-to-end test, docs, verification

**Files:**
- Create: `frontend/e2e/projects.spec.ts`, `frontend/e2e/fixtures/sample-app/package.json`, `frontend/e2e/fixtures/sample-app/src/app/page.tsx`, `frontend/e2e/fixtures/sample-app/src/lib/math.ts`, `frontend/e2e/fixtures/sample-app/README.md`, `frontend/e2e/fixtures/sample-app/node_modules/left-pad/index.js`, `frontend/e2e/fixtures/sample-app/.env`
- Modify: `README.md`, `.gitignore` (un-ignore the fixture's `.env` and `node_modules`)

- [ ] **Step 1: Create the fixture**

```bash
cd frontend/e2e/fixtures && mkdir -p sample-app/src/app sample-app/src/lib sample-app/node_modules/left-pad
printf '{ "name": "sample-app", "version": "1.0.0" }\n' > sample-app/package.json
printf 'export default function Page() {\n  return <h1>Hello</h1>;\n}\n' > sample-app/src/app/page.tsx
printf 'export const add = (a: number, b: number) => a + b;\n' > sample-app/src/lib/math.ts
printf '# Sample app\n' > sample-app/README.md
printf 'module.exports = () => "";\n' > sample-app/node_modules/left-pad/index.js
printf 'SECRET_TOKEN=do-not-upload\n' > sample-app/.env
```

Append to the root `.gitignore`:

```
!frontend/e2e/fixtures/sample-app/.env
!frontend/e2e/fixtures/sample-app/node_modules/
```

- [ ] **Step 2: Write `frontend/e2e/projects.spec.ts`**

```ts
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const fixture = fileURLToPath(new URL("./fixtures/sample-app", import.meta.url));

test("upload a folder, edit a file, restore a version, and download the ZIP", async ({ page }) => {
  mkdirSync(`${fixture}/assets/empty`, { recursive: true });
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("File Owner");
  await page.getByLabel("Email").fill(`files-${Date.now()}@test.dev`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Company name").fill("File Bakery");
  await page.getByRole("radio", { name: /Just the head agent/ }).check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/w\/file-bakery/);

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Open project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Choose a folder").setInputFiles(fixture);
  await expect(dialog.getByText(/node_modules folders are excluded/)).toBeVisible();
  await expect(dialog.getByText(/secret or credential file/)).toBeVisible();
  await dialog.getByLabel("Project name").fill("Sample app");
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(dialog.getByRole("status")).toContainText("files added");
  await dialog.getByRole("button", { name: "Open project" }).click();

  await expect(page.getByRole("heading", { name: "Sample app" })).toBeVisible();
  const tree = page.getByRole("tree", { name: "Project files" });
  await expect(tree.getByText("math.ts")).toBeVisible();
  await expect(tree.getByText("left-pad")).toHaveCount(0);
  await tree.getByText("math.ts").click();

  const editor = page.getByLabel("Editing sample-app/src/lib/math.ts");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("export const add = (a: number, b: number) => a + b + 0;");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved version 2.")).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  const history = page.getByRole("complementary", { name: "File history" });
  await expect(history.getByText("Version 2 (current)")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await history.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Version restored.")).toBeVisible();
  await expect(page.getByLabel("Editing sample-app/src/lib/math.ts")).toContainText("a + b;");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ZIP" }).click();
  expect((await download).suggestedFilename()).toBe("Sample app.zip");
});
```

- [ ] **Step 3: Run E2E**

Run: `cd frontend && npm run e2e`
Expected: `3 passed`. If Playwright can't find the hidden inputs by label, replace `hidden` with `className="sr-only"` on the three inputs and re-run.

- [ ] **Step 4: Update `README.md`**

Add after the AI providers section:

````markdown
## Projects and files

Open **Projects** in the sidebar to upload a folder, a ZIP, or files, then browse and edit them in the built-in code editor. Every save is a version you can restore. Download single files or the whole project as a ZIP.

- Skipped automatically: `node_modules`, `.git`, build output, caches, `.env` files (except `.env.example`), private keys and credential files.
- Limits: 2,000 files and folders, 50 MB per project, 10 MB per file, 1 MB for files edited in the browser.
- Files are stored on the server's disk under `backend/data/blobs` (set `FILES_DIR` to change). Nothing uploaded is ever run.
````

- [ ] **Step 5: Full verification gates**

```bash
cd backend && caffeinate -i npm test && npx tsc --noEmit
cd ../frontend && npm run lint && npx tsc --noEmit && npm run test:unit && npm run build && npm run e2e
```

All must pass. Then screenshot at 1440px light and 390px dark: projects list (empty and with projects), upload dialog with preview, project workspace with an open file, history panel, conflict banner. Fix overflow and contrast before finishing.

- [ ] **Step 6: Commit**

```bash
git add frontend README.md .gitignore
git commit -m "test: end-to-end project upload, edit, restore, and download; docs"
```

---

## Self-Review Notes

- **Spec coverage:** criteria 1 (Tasks 4, 6), 2 (Task 6 preview + include toggles), 3 (Tasks 1, 2, 4), 4 (Tasks 5, 7), 5 (Tasks 5, 7), 6 (Tasks 5, 7), 7 (Task 3), 8 (Task 3 `sendFile`), 9 (Tasks 3-5 role tests), 10 (Task 4 cleanup tests), 11 (Task 8).
- **Spec deviations recorded:** ZIP symlink entries are stored as ordinary files (fflate does not expose entry modes), which is safe because storage never creates filesystem paths from user input; folder moves record a "rename" version only for single-file moves.
- **Known limits marked in code:** abandoned imports (browser closed mid-upload) keep the files uploaded so far.
