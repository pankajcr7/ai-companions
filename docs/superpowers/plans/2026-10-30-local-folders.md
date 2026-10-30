# Local Folder Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the desktop app, the owner opens a folder on their computer as a project; the AI team, the editor and the preview work directly on the files in that folder, and nothing from the folder is stored on the server.

**Architecture:** A project gets an optional `deviceId`: the desktop app install that holds its folder. The server's file layer (`backend/src/files/source.ts`) lists, reads and writes a project's files either from the database (as today) or, for a device project, by sending the request to that device through a relay (`backend/src/files/desktop.ts`): the app long-polls `GET /api/desktop/poll`, runs each request on the folder, and answers with `POST /api/desktop/reply`. Every place that touches project files (team tools, goal context, summaries, editor routes, preview) goes through the file layer, so they all work on folders unchanged. The desktop app drops folder sync (replaced) and becomes the device.

**Tech Stack:** existing Fastify + Prisma backend, Electron app in `desktop/`, Next.js frontend; vitest, Playwright.

**Spec:** owner direction in conversation (2026-10-30), replacing the sync design in `docs/superpowers/specs/2026-10-30-desktop-app-design.md`: "it directly opens local folder, we don't have to upload or save on db, our AI companions work on these local folders and edit files, like Cursor"; "team edits files directly in folder, I check in app preview"; owner skipped further questions, defaults stated below are mine.

## Global Constraints

- Folder files are never written to the database (no ProjectEntry, Blob or FileRevision rows for device projects). File contents only pass through the server while a request runs.
- The team writes directly into the folder for device projects (no "suggestion to review" step).
- A write is refused (409, "This file changed since you opened it…") when the file on disk changed since it was read: edits made in VS Code are never overwritten by the team or the web editor.
- Before the app overwrites or restores a file, it keeps the previous content in the app's data folder (`versions/<projectId>/…`, newest 20 per file); the History panel lists and restores them. Deletes go to the Trash / Recycle Bin.
- Only the project's creator can use a device project's files (their own device); other members get 403 "This project's folder is on another person's computer."
- When the app isn't connected: 409 `desktop_offline`, "Open the Agent Company app on the computer that has this folder."
- A device project's revision for a file is derived from its content hash (`parseInt(sha256.slice(0, 12), 16) + 1`), the same on server and app.
- Skip rules: the existing `SKIP_DIRS`/`skipFile` in `desktop/src/sync/local-folder.ts` (moved to `desktop/src/folder.ts`) plus the server's `exclusionReason`.
- Not available for device projects (400, "Not available for a folder on your computer; use Finder or Explorer."): upload into the project, ZIP download.
- App shell fixes carried from the final review: only `accounts.google.com` stays in the window (also on redirects); permission requests (camera, mic, location…) are denied except for the site's own pages.

## Review Focus

- The app quits while the team is mid-task: tool calls fail with the offline message; the goal's task fails clearly, nothing half-written beyond the file being written.
- A request arrives for a project the app doesn't know (folder forgotten, other install): answered with an error, never guessed.
- Path tricks (`../`, absolute paths, symlinks) in any request: refused by the server's path rules and by the app's folder confinement; symlinked files are neither read nor written through.
- Two requests for the same file at once (team writes while the editor saves): each is checked against the file's current content right before writing.
- A large app preview (many source files): served within the 5 MB source cap, or the existing "too big" message.

---

### Task 1: The relay between the server and the desktop app

**Files:** Create `backend/src/files/desktop.ts`, `backend/src/routes/desktop.ts`; register in `backend/src/app.ts`. Test `backend/test/desktop-relay.test.ts`.

**Interfaces:** Produces `desktopCall(project: { id: string; deviceId: string | null; createdById: string }, op: string, args: object, timeoutMs = 30_000): Promise<unknown>`; throws `HttpError(409, "desktop_offline", …)` when the device hasn't polled in 40 s or belongs to another user; rejects with `HttpError(502, "desktop_error", message)` when the app answers an error. `GET /api/desktop/poll?device=<id>` (signed in; waits up to 20 s; `{ calls: { id, projectId, op, args }[] }`; a device is bound to the first user who polls it, others get 403). `POST /api/desktop/reply` `{ device, id, ok: boolean, result?, error? }`.

- [ ] Tests: a call reaches a waiting poll and its reply resolves it; a call made before the poll is delivered on the next poll; no poll in 40 s → 409 desktop_offline; another user's poll of the same device → 403; an error reply rejects with the app's message; a reply after the timeout is ignored.
- [ ] Implement (in-memory maps; `ponytail:` one server instance). The poll route caches the signed-in user per cookie for 60 s so polling doesn't query the database.

### Task 2: The file layer reads and writes device projects through the relay

**Files:** Migration adding `Project.deviceId String?`; create `backend/src/files/source.ts`; modify `files/service.ts` (`saveText`, DTOs), `harness/tools.ts`, `goals/context.ts` (`pickFiles` loader takes the entry), `goals/load.ts`, `goals/summary.ts`, `goals/runner.ts` (direct save for device projects), `routes/projects.ts`, `routes/files.ts`, `routes/preview.ts`, `routes/goals.ts`, `routes/chat-edits.ts`, `routes/uploads.ts`. Test `backend/test/device-projects.test.ts`.

**Interfaces:** `isDevice(p)`, `listEntries(project): Promise<Entry[]>`, `findEntry(project, path)`, `readBytes(project, e)`, `readText(project, e)` where `Entry` has the ProjectEntry fields the callers use (`path, pathLower, kind, size, isText, revision, blobHash, updatedAt`; for device files `blobHash` is the content hash). App ops used: `list` → `{ entries: { path, kind, size, isText, hash, mtime }[] }`; `read {path}` → `{ base64 }`; `write {path, content, base}` (base 0 = must not exist, else rev of current must equal base) → `{ hash }` or error `conflict`; `remove {path}`; `mkdir {path}`; `move {from, to}`; `versions {path}` → `{ versions: { id, at, size }[] }`; `version {path, id}` → `{ base64 }`; `restore {path, id}` → `{ hash }`. `POST /api/workspaces/:id/projects` accepts `deviceId`; `projectDTO` adds `onDevice: deviceId | null`.

- [ ] Tests (a fake app answering polls from an in-memory folder): tree lists the folder; editor read and save; a save on a changed file → 409; the team's `projectTools` list/read/search/write; `goalContext` reads the brief from the folder; preview serves an HTML file and the app runner; history lists and restores versions; upload and ZIP → 400; another member → 403; app not polling → 409 desktop_offline; no ProjectEntry/Blob rows are created.
- [ ] Implement; keep every existing test passing (DB projects unchanged).

### Task 3: The desktop app becomes the device

**Files:** Delete `desktop/src/sync/` and its tests; create `desktop/src/folder.ts` (from local-folder.ts: walk + skip rules + confinement + ops + versions), `desktop/src/device.ts` (device id, folder map, poll loop, op dispatch); modify `main.ts`, `preload.ts`, `static/offline.html`. Tests `desktop/test/folder.test.ts`, `desktop/test/device.test.ts`, `desktop/test/app.e2e.ts`.

**Interfaces:** bridge `window.agentDesktop` = `{ version, deviceId, pickFolder(): Promise<string|null>, attach(projectId, folder): Promise<void>, folderOf(projectId): Promise<string|null>, projectOf(folder): Promise<string|null>, showFolder(projectId): Promise<void>, forget(projectId): Promise<void> }` (`attach` only for a folder picked in the dialog this session; one folder per project). Offline page lists folders (`folders()` → `{ projectId, folder }[]`).

- [ ] Tests: folder ops (list with folders and text detection, read, write creates parents / refuses on changed content / keeps a version, versions + restore, remove → trash, mkdir, move, confinement, symlinks refused); device dispatch answers ops for attached projects and an error for unknown ones; smoke test: bridge only on the site, `accounts.google.com` only, permission requests denied.
- [ ] Implement. Poll while signed in and the computer isn't idle 15+ minutes; back off 5 s when offline/signed out.

### Task 4: The website opens folders

**Files:** Modify `frontend/src/app/w/[slug]/projects/page.tsx` (Open folder), `frontend/src/app/w/[slug]/projects/[pid]/page.tsx` (device bar, hide Upload/ZIP, offline message), `frontend/src/lib/desktop.ts` (new bridge type), `frontend/src/lib/projects.ts` (`onDevice`); delete `FolderSync.tsx`, `e2e/folder-sync.spec.ts`. Test `frontend/e2e/local-folder.spec.ts`, `frontend/src/lib/desktop.test.ts`.

- [ ] Tests: no Open folder button in a browser; with a stubbed bridge, Open folder creates a project named after the folder with the device id, attaches it and opens it; opening the same folder again opens the existing project; the project page shows "Open the Agent Company app…" when the app isn't connected.
- [ ] Implement.

### Task 5: Build and check

- [ ] Full desktop tests, backend tests touched, frontend unit + the two e2e specs; build the Mac dmg; launch the packaged app against a local backend + frontend, open a folder, read/write through the editor, preview.
