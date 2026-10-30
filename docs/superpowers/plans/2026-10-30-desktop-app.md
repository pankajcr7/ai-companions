# Agent Company Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron app for Mac and Windows that shows the live Agent Company and keeps owner-picked folders in two-way sync with projects.

**Architecture:** A new `desktop/` package. The window loads the live site; a preload exposes a small `window.agentDesktop` bridge only to the site's own pages. Sync is a pure decision engine (`engine.ts`) over two adapters: `ProjectApi` (the existing REST API, signed in with the window's session cookie) and `LocalFolder` (the file system). A manager runs a sync round every 10 s, on focus, and 1.5 s after a folder change, and stores per-link state in the app's data folder. The server gains file hashes in the tree and a binary save; the website gains the sync button and status on the project page.

**Tech Stack:** Electron 45, electron-builder 26, TypeScript, Node 22 (`fs.watch` recursive, `crypto`, global `fetch`), vitest; existing Fastify + Prisma backend; Next.js frontend; Playwright (`_electron`) for the app smoke test; GitHub Actions (macos-latest, windows-latest).

**Spec:** `docs/superpowers/specs/2026-10-30-desktop-app-design.md`

## Global Constraints

- Live site: `https://ai-companions-five.vercel.app` (one constant, `APP_URL`, in `desktop/src/config.ts`; overridable with env `AGENT_COMPANY_URL` for local testing).
- Installers: Mac `.dmg` for arm64 and x64; Windows NSIS `.exe` for x64. Unsigned. No Linux. Product name "Agent Company", appId `com.agentcompany.desktop`.
- Sync timing: a round every 10 s while the window is focused, every 60 s while it's in the background, none while the computer has been idle 15+ minutes (`powerMonitor.getSystemIdleTime()`, so the free Neon database can sleep); right away on window focus, and 1.5 s after the last change in a linked folder (always, idle or not).
- Google sign-in stays in the window; the window's user agent is the normal Chrome one (the `Electron/…` and app tokens removed). Email sign-in is the fallback if Google ever refuses.
- A rename in the folder is a new file plus "N files deleted on this computer" (no rename detection in this version).
- Mac builds are ad-hoc signed (`mac.identity: "-"`) so Apple Silicon doesn't call them "damaged"; the install note uses System Settings → Privacy & Security → Open Anyway (macOS 15+).
- Never skipped silently and never synced: `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`, `.DS_Store`, `Thumbs.db`, `~$*`, `*.swp`, `.~lock.*`; plus the server's own exclusions (`backend/src/files/rules.ts`). Files over 10 MB (`LIMITS.maxFileBytes`) are skipped and reported "skipped: too big".
- Conflict copy name: `name (my copy).ext` (for `notes.md` → `notes (my copy).md`; no extension → `name (my copy)`).
- Deleted in the project → local file to Trash/Recycle Bin (`shell.trashItem`). Deleted locally → never deleted in the project without the owner's click.
- One folder per project and one project per folder.
- The bridge is available only on pages from `APP_URL`'s origin and on the bundled offline page; every IPC handler re-checks the sender's URL.
- Status copy (exact): "Synced just now", "Synced N minutes ago", "Syncing N files…", "Offline: N changes waiting", "1 conflict" / "N conflicts", "N files deleted on this computer", "You can view this project; your changes stay on this computer.", "skipped: too big".

## Review Focus

- A linked folder that is moved, renamed or deleted while the app runs: the link's status shows "Folder not found" and nothing is uploaded or deleted remotely.
- The session expiring (401): the status says "Sign in again to keep syncing" and the round stops; no local file is touched.
- Hitting the save rate limit (429) or a server error mid-round: the round stops where it is and the next round continues; no file is marked synced that wasn't.
- Two quick edits to the same local file during an upload: the second edit is uploaded in the next round (the synced hash is the uploaded content's, not the file's newest).
- Paths that differ only in case on Windows/Mac (case-insensitive disks): `Readme.md` in the project and `README.md` locally are treated as the same file (the server compares lower-case paths).

---

### Task 1: Server — file hashes in the tree, and saving any file (binary included) with a revision

**Files:**
- Modify: `backend/src/files/service.ts` (`entryDTO`, new `saveFile`), `backend/src/routes/files.ts` (new route)
- Test: `backend/test/files-sync.test.ts`

**Interfaces:**
- Produces: tree entries gain `hash: string | null` (the blob's sha256 hex; null for folders). `PUT /api/workspaces/:id/projects/:pid/files/raw?path=<p>&baseRevision=<n>` with body `application/octet-stream` → `200 { revision: number }`; `baseRevision=0` creates (409 if it exists); otherwise 409 when the revision moved. `isText` is set from the content (`isTextContent`). Rate limit 600 per minute per user. Same 400/413 rules as text saves (exclusions, private keys in text, 10 MB file, 50 MB project, 2,000 entries).
- `saveFile(project, userId, path, data: Buffer, baseRevision): Promise<{ revision: number }>` in `service.ts`; `saveText` becomes a thin wrapper that keeps its 1 MB editor limit and text-only update rule.

- [ ] **Step 1: Write the failing tests** in `backend/test/files-sync.test.ts`: `"the tree lists each file's content hash"` (save "hi" → entry.hash equals sha256("hi") hex; folders have hash null); `"raw saves create and update binary files with revision checks"` (PNG bytes with baseRevision 0 → revision 1, download returns the same bytes, isText false; update with baseRevision 1 → 2; stale baseRevision 1 again → 409; baseRevision 0 on an existing path → 409; 11 MB body → 413; `node_modules/x.js` → 400); `"a viewer can't save"` (403).
- [ ] **Step 2: Run** `cd backend && npx vitest run test/files-sync.test.ts` — expect FAIL (no `hash`, route 404).
- [ ] **Step 3: Implement** `saveFile` and the route (register an `application/octet-stream` buffer parser on the route with `bodyLimit` `LIMITS.maxFileBytes + 1`, and return 413 above `LIMITS.maxFileBytes`), and `hash: e.kind === "file" ? e.blobHash : null` in `entryDTO`. Keep `saveText` behaviour and messages unchanged (its existing tests must still pass).
- [ ] **Step 4: Run** `npx vitest run test/files-sync.test.ts test/files.test.ts` — expect PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5: Commit** `feat(backend): file hashes in the tree and a binary-safe raw save for desktop sync`

### Task 2: Desktop package and the sync decision engine

**Files:**
- Create: `desktop/package.json`, `desktop/tsconfig.json`, `desktop/vitest.config.ts`, `desktop/src/config.ts`, `desktop/src/sync/types.ts`, `desktop/src/sync/engine.ts`
- Test: `desktop/test/engine.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type RemoteFile = { path: string; rev: number; hash: string; size: number }`
  - `type LocalFile = { path: string; hash: string; size: number }`
  - `interface Remote { list(): Promise<RemoteFile[]>; read(path): Promise<Buffer>; save(path, data: Buffer, baseRev: number): Promise<number>; remove(path): Promise<void> }` — errors are `RemoteError { kind: "offline" | "signed-out" | "read-only" | "conflict" | "busy" | "too-big" | "failed"; message }`.
  - `interface Local { list(): Promise<LocalFile[] | "missing">; read(path): Promise<Buffer>; write(path, data): Promise<string /* hash */>; trash(path): Promise<void>; copy(from, to): Promise<void> }`
  - `type LinkState = { synced: Record<string /* lower-case path */, { path: string; rev: number; hash: string }>; deletedHere: string[] }`
  - `type SyncStatus = { kind: "synced" | "syncing" | "offline" | "error"; at: number; waiting: number; conflicts: string[]; deletedHere: string[]; skipped: string[]; readOnly: boolean; message?: string }`
- Produces (`engine.ts`): `syncOnce(remote: Remote, local: Local, state: LinkState, now: number): Promise<{ state: LinkState; status: SyncStatus }>`, `confirmDeletes(remote, state): Promise<LinkState>`, `restoreDeleted(remote, local, state): Promise<LinkState>`, `copyName(path: string): string`.

The decision table (per lower-cased path; s = synced, r = remote, l = local):

| r | l | s | situation | action |
|---|---|---|---|---|
| ✓ | ✓ | any | same hash | record synced (r.rev, hash) |
| ✓ | — | — | new in project | download |
| — | ✓ | — | new here | upload with baseRev 0 |
| ✓ | ✓ | ✓ | only project changed (l = s) | download |
| ✓ | ✓ | ✓ | only local changed (r = s) | upload with baseRev s.rev |
| ✓ | ✓ | ✓ or — | both changed / first link differs | copy local → `copyName`, download project version, conflict listed |
| ✓ | — | ✓ | deleted here, project unchanged | add to `deletedHere` (no remote change) |
| ✓ | — | ✓ | deleted here, project changed | download (project's newer version comes back) |
| — | ✓ | ✓ | deleted in project, local unchanged | trash local, drop synced |
| — | ✓ | ✓ | deleted in project, local changed | upload with baseRev 0 (nothing lost) |
| — | — | ✓ | gone on both sides | drop synced |

Errors: `offline` before listing → status offline with `waiting` = number of local adds/changes; `signed-out` → error "Sign in again to keep syncing"; `read-only` on the first upload → `readOnly: true`, no more uploads this round, downloads continue; `busy`/`failed` → stop the round, keep state as is; `conflict` on upload → leave it for the next round (which sees the new remote). Local `"missing"` → error "Folder not found". Conflicts = local paths matching `(my copy)` before the extension.

- [ ] **Step 1: Scaffold** `desktop/` (package `agent-company-desktop`, private, scripts `build` = `tsc -p .`, `test` = `vitest run`; devDependencies `typescript`, `vitest`, `@types/node`; `tsconfig` module commonjs, target es2022, outDir `dist`, strict). `config.ts`: `export const APP_URL = process.env.AGENT_COMPANY_URL ?? "https://ai-companions-five.vercel.app"`.
- [ ] **Step 2: Write the failing tests** with in-memory `Remote` and `Local` fakes, one test per table row plus: `"first link: four cases"`, `"no sync loop: a second round after any round does nothing"`, `"offline counts waiting changes and changes nothing"`, `"signed out stops the round and touches no local file"`, `"read-only keeps local edits and still downloads"`, `"busy mid-round keeps what wasn't done for the next round"`, `"case-only differences are the same file"`, `"too-big local files are skipped and listed"`, `"confirmDeletes removes them in the project; restoreDeleted brings them back"`, `"copyName"` (`notes.md` → `notes (my copy).md`, `a/b.tar.gz` → `a/b.tar (my copy).gz`, `LICENSE` → `LICENSE (my copy)`).
- [ ] **Step 3: Run** `cd desktop && npm install && npx vitest run` — expect FAIL (engine missing).
- [ ] **Step 4: Implement** `engine.ts` from the table (process downloads/trash before uploads; one remote list and one local list per round; update `state.synced` only after each action succeeds).
- [ ] **Step 5: Run** `npx vitest run` — PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 6: Commit** `feat(desktop): the two-way sync engine`

### Task 3: The file-system and API adapters, tested against the real server

**Files:**
- Create: `desktop/src/sync/local-folder.ts`, `desktop/src/sync/project-api.ts`
- Test: `desktop/test/local-folder.test.ts`, `backend/test/desktop-sync.test.ts`

**Interfaces:**
- Consumes: Task 1's tree `hash` and raw save; Task 2's `Remote`, `Local`, `syncOnce`.
- Produces: `class LocalFolder implements Local` (`constructor(root: string, trash: (absPath) => Promise<void>)`; `list()` walks the folder with the skip rules, hashing with sha256 and caching hashes by `mtimeMs`+`size`); `class ProjectApi implements Remote` (`constructor(o: { baseUrl: string; workspaceId: string; projectId: string; cookie: () => Promise<string> })`; sends `Origin: baseUrl` and the cookie; maps fetch failure → `offline`, 401 → `signed-out`, 403 → `read-only`, 409 → `conflict`, 429/5xx → `busy`, 413 → `too-big`).

- [ ] **Step 1: Write the failing tests:** `local-folder.test.ts` in a temp dir — writes create parent folders and return the hash; `list()` skips the skip-list and the server exclusions and reports `size`; `trash` calls the injected function with the absolute path; a missing root returns `"missing"`. `backend/test/desktop-sync.test.ts` (listens the real app on a random port, signs up, makes a project, links a temp folder via `ProjectApi` + `LocalFolder`): `"two-way sync against the real API"` — project files arrive locally; a local edit and a new local PNG reach the project (download matches bytes); a project-side save arrives locally; the same file changed on both sides produces `(my copy)` and the project version; a second round does nothing.
- [ ] **Step 2: Run** both — expect FAIL.
- [ ] **Step 3: Implement** the two adapters.
- [ ] **Step 4: Run** `cd desktop && npx vitest run` and `cd backend && npx vitest run test/desktop-sync.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(desktop): file-system and API adapters for sync`

### Task 4: The Electron app — window, bridge, sync manager, offline page, packaging

**Files:**
- Create: `desktop/src/main.ts`, `desktop/src/preload.ts`, `desktop/src/sync/manager.ts`, `desktop/src/offline.html`, `desktop/build/icon.png` (1024×1024, from the logo), `desktop/electron-builder.yml`
- Modify: `desktop/package.json` (dependencies `electron` 45, devDependency `electron-builder` 26, `@playwright/test`; scripts `start` = `npm run build && electron dist/main.js`, `dist` = `npm run build && electron-builder`)
- Test: `desktop/test/app.e2e.ts` (Playwright `_electron`)

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `window.agentDesktop` = `{ version: string; pickFolder(): Promise<string | null>; link(o: { workspaceId; projectId; projectName; folder }): Promise<SyncStatus>; unlink(projectId): Promise<void>; linkOf(projectId): Promise<{ folder: string; status: SyncStatus } | null>; links(): Promise<{ projectId; projectName; folder }[]>; onStatus(cb: (projectId, status) => void): () => void; openFolder(projectId): Promise<void>; confirmDeletes(projectId): Promise<void>; restoreDeleted(projectId): Promise<void> }`. `link` refuses a folder already linked to another project, or a project already linked ("This folder is already synced with <name>").
- `SyncManager` persists links and `LinkState` in `app.getPath("userData")/sync.json`, runs rounds per link (never two at once for one link), watches each folder with `fs.watch(root, { recursive: true })` (1.5 s debounce), and broadcasts status.

- [ ] **Step 1: Write the failing smoke test** `app.e2e.ts`: launches the app with `AGENT_COMPANY_URL` pointing at a local static server that serves one page; asserts the window shows that page, `window.agentDesktop.version` is defined there, and a page from another origin opened in the window gets no `agentDesktop`; links to other sites open externally (stub `shell.openExternal` via `app.evaluate`).
- [ ] **Step 2: Run** `cd desktop && npm run build && npx playwright test test/app.e2e.ts` — FAIL.
- [ ] **Step 3: Implement** `main.ts` (single-instance lock; one window loading `${APP_URL}/app`; `setWindowOpenHandler` and `will-navigate`: stay in the app for `APP_URL`'s origin, `accounts.google.com` and `auth.openai.com` (sign-in), else `shell.openExternal`; `did-fail-load` with a network error → `offline.html`, with a Retry that reloads `${APP_URL}/app`; IPC handlers that check `event.senderFrame.url`), `preload.ts` (`contextBridge.exposeInMainWorld("agentDesktop", …)` only when `location.origin` is `APP_URL`'s origin or the page is the bundled offline page), `manager.ts` (cookie for `ProjectApi` from `session.defaultSession.cookies.get({ url: APP_URL })`), `offline.html` (the landing page's dark look; lists `links()` with Open folder buttons), and `electron-builder.yml` (mac dmg arm64+x64, win nsis x64, `build/icon.png`, `publish: github`).
- [ ] **Step 4: Run** the smoke test — PASS. Then `npm start` against the live site: the sign-in page appears; record a screenshot.
- [ ] **Step 5: Commit** `feat(desktop): the Electron app with the sync bridge and offline page`

### Task 5: The website's sync button and status

**Files:**
- Create: `frontend/src/lib/desktop.ts`, `frontend/src/lib/desktop.test.ts`, `frontend/src/components/app/files/FolderSync.tsx`
- Modify: `frontend/src/app/w/[slug]/projects/[pid]/page.tsx` (render `<FolderSync>` in the toolbar)
- Test: `frontend/e2e/folder-sync.spec.ts`

**Interfaces:**
- Consumes: Task 4's `window.agentDesktop` and `SyncStatus` (types copied into `desktop.ts`).
- Produces: `desktopBridge(): AgentDesktop | null`; `statusText(s: SyncStatus, now: number): string` (the Global Constraints copy, most urgent first: error message, read-only, conflicts, deleted here, offline, syncing, synced).

- [ ] **Step 1: Write the failing tests:** `desktop.test.ts` for `statusText` (each status line, "1 conflict" vs "2 conflicts", "Synced just now" under a minute, "Synced 3 minutes ago"); `folder-sync.spec.ts` with a stubbed `window.agentDesktop` (`page.addInitScript`): no button in a normal browser; in the "desktop" it shows "Sync with a folder on this computer", picking a folder shows the folder name and "Synced just now", deleted-here status shows both buttons and calls `confirmDeletes`, and "Stop syncing" calls `unlink`.
- [ ] **Step 2: Run** `npm run test:unit` and `npx playwright test e2e/folder-sync.spec.ts` — FAIL.
- [ ] **Step 3: Implement** `desktop.ts` and `FolderSync.tsx` (viewers see it too; the read-only line explains).
- [ ] **Step 4: Run** both — PASS; `npx tsc --noEmit -p .` and eslint clean.
- [ ] **Step 5: Commit** `feat(frontend): sync a project with a folder in the desktop app`

### Task 6: Installers from GitHub, and how to install

**Files:**
- Create: `.github/workflows/desktop.yml`, `desktop/README.md`
- Modify: root `README.md` (a Desktop app section linking to the releases page)

- [ ] **Step 1: Write** the workflow: on push of tags `desktop-v*` and `workflow_dispatch`; matrix `macos-latest` and `windows-latest`; Node 22; `cd desktop && npm ci && npm test && npx electron-builder --publish always` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` and `permissions: contents: write`; `CSC_IDENTITY_AUTO_DISCOVERY: false`.
- [ ] **Step 2: Build the Mac installer locally** `cd desktop && npm run dist -- --mac --arm64` — produces `dist-app/Agent Company-<version>-arm64.dmg`; open it, install, launch, sign in.
- [ ] **Step 3: Write** `desktop/README.md`: install steps for both systems, including the unsigned-app warnings (Mac: right-click → Open; Windows: More info → Run anyway), and what sync does.
- [ ] **Step 4: Commit** `ci(desktop): build Mac and Windows installers on version tags`
- [ ] **Step 5 (owner says push):** push, then push tag `desktop-v0.1.0`; check the Actions run and that the release has the `.dmg` files and the `.exe`.
