# Agent Company Desktop: the online app on Windows and Mac, with projects synced to local folders

Date: 2026-10-30
Status: Draft for owner review

## 1. Intent

The owner wants Agent Company as installable software on **Windows and Mac**, not only a website. It stays the
same online service (same accounts, companies, teams, AI, and data), with one desktop-only feature:
**a project can be linked to a folder the owner picks on their computer**, and the two are kept in step.
The team's saved files appear in that folder; the owner's edits in that folder (in VS Code, Finder, any app)
go back to the project; and when the computer is offline, the folder still has everything and edits are sent
once it's back online.

## 2. Goals

1. An installer for each platform: a `.dmg` for Mac (Apple Silicon and Intel) and an `.exe` installer for
   Windows (x64). Installing gives an app icon in the Dock / Applications and the Start menu / desktop.
2. The app window shows the live Agent Company (https://ai-companions-five.vercel.app). Every web feature
   works as in Chrome, including the 3D landing page, previews built in the browser, and Google sign-in.
   Pushing to the website updates the app with no reinstall.
3. Sign-in is remembered between launches (the website's own session cookie, kept by the app).
4. On a project's page, the desktop app shows **"Sync with a folder on this computer"**. The owner picks a
   folder (native folder picker); the project and folder are then linked. A project links to at most one
   folder; a folder links to at most one project. The link can be removed ("Stop syncing"), which leaves both
   sides as they are.
5. While linked (and the app is open), sync runs both ways:
   - **Project → folder:** every saved file in the project is written to the folder (same paths), and later
     saved changes follow within a few seconds (checking every 10 seconds, and right away when the app gains
     focus).
   - **Folder → project:** files created or changed in the folder are saved to the project within a few
     seconds of the change (watching the folder).
   - Text and binary files (pictures, PDFs, fonts) both sync.
6. **First link** (the folder and the project may both already have files):
   - Files only in the project are written to the folder; files only in the folder are uploaded.
   - Files on both sides with the same content: nothing to do.
   - Files on both sides with different content: a conflict (see 8).
7. **Offline:** the app shows a simple offline page listing the linked folders, each with **Open folder**.
   Local edits made while offline are remembered and sent when the connection returns; the project's newer
   changes are fetched then too.
8. **Conflicts** (a file changed on both sides since the last sync): nothing is lost. The project's version
   is written to the folder and the owner's local version is kept next to it as
   `name (my copy).ext`; the sync status shows "1 conflict" with the file names. The owner resolves it by
   keeping the content they want and deleting the copy, which then syncs normally.
9. **Deletions:**
   - A file deleted in the project moves the local file to the computer's **Trash / Recycle Bin**
     (recoverable).
   - A file deleted in the folder is **not** deleted from the project automatically. The status shows
     "3 files deleted on this computer" with **Delete them in the project too** and **Bring them back**
     (re-download). Nothing is deleted from the project without that click.
10. **Sync status** next to the button on the project page: "Synced just now", "Syncing 4 files…",
    "Offline: 2 changes waiting", "1 conflict", "3 files deleted on this computer", or an error in plain words.
11. Builds are made by GitHub Actions on a Mac and a Windows runner (free: the repository is public) when a
    version tag is pushed, and attached to a GitHub Release. The owner downloads the installers from there.

## 3. Non-goals

- No offline use of the team itself: planning, building, AI chat and previews still need the internet.
- No local database and no local copy of the server: the online service stays the single source of truth.
- No sync without the app open (no background service), no syncing of projects that aren't linked, and no
  folder-picking from the website in a normal browser (the button only appears in the desktop app).
- No code signing in this version (see 5). No auto-update of the app shell itself in this version; the web
  content updates on its own.
- No Linux build.

## 4. What must not happen (anti-goals)

- Losing work on either side: no silent overwrite of a changed file, and no permanent delete of a local file.
- Uploading things that aren't project work: skip `node_modules/`, `.git/`, `.next/`, `dist/`, `build/`,
  `.DS_Store`, `Thumbs.db`, editor temp files (`~$*`, `*.swp`, `.~lock.*`), and anything over the server's
  per-file upload limit (shown in the status as "skipped: too big").
- Any website page gaining access to the computer: only the app's own pages on the live site may call the
  desktop features, through a small, fixed set of functions (pick a folder, link, unlink, status, open a
  folder). Other sites opened from links open in the normal browser, not inside the app.
- A sync loop: a file the app just wrote must not be uploaded back as a "change", and vice versa.

## 5. Constraints and decisions

- **Electron** (owner's need: file access, folder watching, and the same Chromium the website is tested in).
  Installer size is about 100 MB; that is accepted. Packaged with electron-builder.
- **Unsigned builds** for now: Mac shows "can't be opened because Apple cannot check it" the first time
  (right-click → Open fixes it); Windows SmartScreen shows "Windows protected your PC" (More info → Run
  anyway). Signing later needs an Apple Developer account ($99/year) and a Windows code-signing certificate;
  the build is set up so adding them is configuration only. A short "How to install" note goes in the release.
- The sync engine runs in the app's main process (Node), talking to the existing API with the signed-in
  session (the cookie the window uses) and the `Origin` header the API expects.
- The server gains one endpoint: save a binary file with a base revision (the same conflict rule as text
  saves), so changed pictures and other binary files can be updated, not only added.
- Sync state (per link: last-synced revision and content hash per path) is stored in the app's own data
  folder, so restarts don't re-upload or re-download everything.
- The project's existing rules still apply: changes the team suggests to existing files wait in the app
  until applied, and only then reach the folder. Viewers (read-only members) can link a folder but only
  receive; their local edits are not sent and the status says why.

## 6. Left to the builder

The app's file layout in the repository (a new `desktop/` folder is expected), the exact window chrome and
menus, the offline page's look (in the landing page's style), the change-detection details (content hashes,
debounce timing within "a few seconds"), the GitHub Actions workflow details, the icon (made from the
existing logo), and how the website detects the desktop app (a preload-exposed object).

## 7. Testing

- The sync engine is written as plain functions over a small "remote" and "local" interface, so it is tested
  without Electron: first link (all four cases), project → folder, folder → project, conflicts, both delete
  rules, offline queue then catch-up, skip lists, and no sync loop.
- A test against the real API (the existing test server) for linking, two-way changes and a conflict.
- The new binary save endpoint has server tests like the text save (revision bump, stale revision refused).
- The website's sync button and status are tested with the desktop object stubbed.
- A manual check before release: install on this Mac, sign in, link a project, edit both sides, go offline,
  come back; and on a Windows machine or VM from the built installer.
