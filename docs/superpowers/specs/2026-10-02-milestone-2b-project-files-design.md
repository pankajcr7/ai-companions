# Milestone 2b: Projects, File Upload, and In-App Editing

Date: 2026-10-02
Status: Draft for owner review
Builds on: milestones 1 and 2a (branch `milestone-1`)

## 1. Goal

A member creates a project in their company, or opens one by uploading a folder, a ZIP, or individual files. They see the file tree, open text files in a code editor, edit and save them (every save is a version), create, rename, move and delete files and folders, view a file's history and restore an older version, and download one file or the whole project as a ZIP. Nothing uploaded is ever executed.

### Success criteria

1. "Upload folder" (browser folder picker or drag-and-drop of a folder), "Upload ZIP", and "Upload files" import into a new or existing project with relative paths and nesting preserved, including empty folders.
2. Before uploading, the user sees the included tree, file count, total size, and every excluded item with its reason. Excluded top-level folders can be re-included.
3. The server re-applies every rule: default exclusions, secret checks, limits (2,000 files, 50 MB total, 10 MB per file), path safety (no `..`, absolute paths, drive letters, NUL, or control characters; case-insensitive collisions rejected), and ZIP safety (expanded size and file count limits, no symlink entries). Violations are skipped with a reason or rejected with a clear message; nothing unsafe is written.
4. Text files up to 1 MB open in a CodeMirror editor with syntax highlighting by file type. Saving creates a version. If the file changed since it was opened, the save is refused with "This file changed since you opened it" and the user can reload or copy their text.
5. New file, new folder, rename/move, and delete work from the tree. Delete asks for confirmation and removes the file and its history; a deleted file can be recovered only by uploading it again in this milestone.
6. Each file's history lists versions (who, when, why) and any version can be viewed and restored (restore creates a new version).
7. "Download ZIP" returns the project's current files with the original structure; single files download with their original name.
8. Images (PNG, JPEG, GIF, WebP) preview inline. SVG, HTML, and every other file type are never rendered by the app: they download as attachments. All file responses send `X-Content-Type-Options: nosniff`.
9. Viewers can browse and download; members upload and edit; owners and admins delete projects. Every route checks workspace membership as in milestone 1.
10. Interrupted uploads leave no half-created project: a project created by an upload that fails is removed, and the import record shows what happened.
11. Lint, type checks, backend tests, E2E tests, and builds pass; screens are checked at 1440px and 390px, light and dark.

### Out of scope

GitHub import, companions reading or editing files (arrives with the company command bar), running code or builds, live previews, content search across files, resumable uploads, collaborative real-time editing, cloud storage (the storage module is the single place to swap later).

## 2. Architecture

```
Browser ──► Next.js ──/api──► Fastify
  - folder picker / drag-drop / ZIP          ├─ routes/projects.ts   project CRUD, tree, download ZIP
  - client-side filter + preview             ├─ routes/files.ts      read, save, create, rename, delete, history, restore
  - CodeMirror editor                        ├─ routes/uploads.ts    multipart upload of files or one ZIP
                                             ├─ files/rules.ts       path safety, exclusions, secret check, limits (shared logic)
                                             ├─ files/store.ts       content-addressed blobs on disk (the only module touching storage)
                                             └─ files/zip.ts         safe ZIP read and write (fflate)
```

- **Storage**: `backend/data/blobs/<first 2 hex>/<sha256>` written atomically (temp file then rename). Identical content is stored once. Blobs are never deleted in this milestone (history references them). Root configurable via `FILES_DIR` (default `backend/data/blobs`).
- **Uploads**: `@fastify/multipart` with per-file and total byte limits enforced while streaming. Browser uploads in batches of up to 100 files per request so progress can be shown; each batch is validated independently, and the first batch creates the project.
- **ZIP**: read with `fflate` from an in-memory buffer (ZIP upload itself capped at 50 MB), checking each entry's declared and actual expanded size against the limits before writing.
- **Text vs binary**: a file is text if it is valid UTF-8 and contains no NUL byte in its first 8 KB.

## 3. Rules (shared by browser preview and server)

`files/rules.ts` exports pure functions; the frontend has its own copy of the same rule list (kept identical by a unit test that compares the two lists):

- **Excluded directories** (anywhere in the path): `node_modules`, `.git`, `.hg`, `.svn`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.turbo`, `.cache`, `coverage`, `__pycache__`, `.venv`, `venv`, `target`, `.gradle`, `.idea`, `.DS_Store` files.
- **Excluded files**: `.env` and `.env.*` except `.env.example` and `.env.sample`; `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*.keystore`, `credentials.json`, `.npmrc`, `.pypirc`, `.netrc`.
- **Secret content**: text containing `-----BEGIN ` followed by `PRIVATE KEY-----` is skipped ("contains a private key").
- **Path safety**: normalized to forward slashes; rejects empty segments, `.`/`..`, leading `/`, `C:` drive prefixes, NUL and control characters, segments over 255 bytes, total path over 1,024 characters, and depth over 32.
- **Collisions**: two paths equal when lower-cased are rejected within an upload and against existing project entries.
- **Limits**: 2,000 entries per project, 50 MB total current content per project, 10 MB per file, 1 MB for in-editor text.

## 4. Data model

| Model | Fields (beyond `id`, timestamps) | Notes |
|---|---|---|
| `Project` | `workspaceId`, `name` (1-60), `createdById`, `totalBytes`, `fileCount` | Unique (`workspaceId`, `name`). |
| `ProjectEntry` | `projectId`, `path`, `pathLower`, `kind` (`file`/`dir`), `blobHash` (null for dirs), `size`, `isText`, `revision` (int, increments per save), `updatedById` | Unique (`projectId`, `pathLower`). |
| `FileRevision` | `entryId`, `projectId`, `blobHash`, `size`, `revision`, `reason` (`upload`/`edit`/`restore`/`rename`), `createdById`, `fromPath` (rename only) | Index (`entryId`, `revision`). |
| `ProjectImport` | `projectId`, `source` (`folder`/`zip`/`files`), `status` (`running`/`complete`/`failed`), `added`, `skipped` (JSON list of `{ path, reason }`), `createdById` | |

Deleting an entry removes the `ProjectEntry` row and its revisions (no orphaned history to list in this milestone); blobs stay on disk.

## 5. API

| Method and path | Role | Purpose |
|---|---|---|
| `GET /api/workspaces/:id/projects` | viewer | List projects |
| `POST /api/workspaces/:id/projects` | member | Create empty project `{ name }` |
| `PATCH /api/workspaces/:id/projects/:pid` | member | Rename |
| `DELETE /api/workspaces/:id/projects/:pid` | admin | Delete project |
| `GET /api/workspaces/:id/projects/:pid/tree` | viewer | All entries `{ path, kind, size, isText, revision, updatedAt }` |
| `POST /api/workspaces/:id/projects/:pid/upload` | member | Multipart batch of files (field name = relative path) or one ZIP (`zip` field); returns `{ added, skipped, importId }` |
| `POST /api/workspaces/:id/projects/upload` | member | Same, creating a project named in the `name` field; returns `{ projectId, ... }` |
| `GET .../:pid/files?path=` | viewer | Text content + revision for text files ≤ 1 MB, else 415 with download hint |
| `GET .../:pid/download?path=` | viewer | Raw bytes; images inline, everything else attachment |
| `GET .../:pid/download.zip` | viewer | Whole project ZIP |
| `PUT .../:pid/files` | member | Save `{ path, content, baseRevision }`; 409 on mismatch; creates the file when `baseRevision` is 0 and the path is free |
| `POST .../:pid/folders` | member | Create folder `{ path }` |
| `POST .../:pid/move` | member | Rename or move `{ from, to }` (file or folder with children) |
| `DELETE .../:pid/entries?path=` | member | Delete file or folder (with children) |
| `GET .../:pid/history?path=` | viewer | Versions of a file |
| `GET .../:pid/history/:revisionId` | viewer | Content of one version (text) |
| `POST .../:pid/restore` | member | `{ path, revisionId }` makes that version current |

Rate limits per user (session token key): uploads 30 batches/min, saves 60/min.

## 6. Frontend

- **Sidebar**: Office, Projects, Organization, AI providers, Settings.
- **Projects page** (`/w/[slug]/projects`): list with name, file count, size, updated; "New project" (name) and "Open project" with Upload folder (input `webkitdirectory`), Upload ZIP, Upload files, and a drop zone accepting folders (DataTransfer entries traversed recursively) and files.
- **Upload preview dialog**: tree of included files (collapsible), counts and size, excluded list with reasons and "Include" toggles for excluded top-level folders, project name field (new project), Upload button, progress bar by batch, Cancel (stops sending further batches; a new project with zero files is deleted), result summary with skipped reasons.
- **Project workspace** (`/w/[slug]/projects/[pid]`): left tree with filename filter, New file, New folder, Upload into folder, and per-entry menu (Rename/Move, Delete, Download, History). Right side: open-file tabs, CodeMirror editor with language by extension, Save (Cmd/Ctrl+S) and unsaved indicator, conflict banner, read-only view for viewers, image preview, "Download" for binary files. History panel lists versions with View and Restore. "Download ZIP" in the header. On screens under 1024px, tree and editor toggle.
- **Editor**: CodeMirror 6 (`@codemirror/*` packages via a small wrapper) with languages: JavaScript/TypeScript/JSX, JSON, HTML, CSS, Markdown, Python; plain text otherwise. Dark and light themes follow the app theme.

## 7. Security

- Nothing uploaded is executed, interpreted, or rendered as HTML by the app.
- All paths are validated server-side; storage paths are derived only from content hashes, never from user paths.
- Downloads: `Content-Disposition` with an RFC 5987 encoded filename, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` on file responses, inline only for PNG/JPEG/GIF/WebP.
- Workspace and project scoping on every query; project IDs from other workspaces return 404.

## 8. Testing

- **Unit**: rules (exclusions, secret detection, every path-safety case, collisions, limits), text detection, ZIP reader rejecting traversal, absolute paths, symlinks, oversized entries and bombs.
- **Routes**: upload nested folder via multipart and ZIP (structure and empty folders preserved), skipped reasons, limits, collisions with existing files, failed upload cleanup, save with revision bump and conflict 409, create/rename/move/delete including folders, history and restore, downloads with correct headers, ZIP download round-trips, roles and cross-workspace isolation.
- **E2E**: create project by uploading a nested fixture folder, open and edit a file, save, see version 2 in history, restore version 1, download ZIP and verify contents.

## 9. Configuration

`FILES_DIR` (optional; default `backend/data/blobs`).

## 10. Risks

- **Local disk** is lost if the server's disk is; acceptable for local and self-hosted use, swap the store module for S3/R2 when deploying.
- **Large uploads** at Neon latency: each batch does a few database writes; batches of 100 keep request counts low.
- **Browser folder APIs** vary: `webkitdirectory` and DataTransfer directory entries are widely supported; ZIP upload is the fallback the UI always offers.
