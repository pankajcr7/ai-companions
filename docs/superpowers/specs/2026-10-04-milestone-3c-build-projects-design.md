# Milestone 3c: Companions Build Projects, and Live Preview

Date: 2026-10-04
Status: Draft for owner review
Builds on: milestones 3 and 3b

## 1. Goal

The owner can ask the team to build something new. Choosing "New project" (or accepting Nova's suggestion to build in a new project) makes the goal create a project when it starts; files the companions create are saved straight into it, ready to open, edit, download, and preview. Web projects get a live preview in a sandboxed frame.

### Success criteria

1. The office project picker offers "New project". A goal created with it plans with a project name chosen by Nova (1-60 characters), shown on the plan and editable before Start.
2. The project is created when the owner presses Start (not before), named from the plan; a taken name gets " 2", " 3", and so on. Cancelling before Start creates nothing.
3. In a goal that created its project, files a task creates (paths that don't exist yet) are saved immediately through the normal save path as revision 1, with the upload rules applied; rejected files show their reason. Changes to files that already exist stay proposals that need Apply, as today. Later tasks can read files created by earlier tasks.
4. Nova's suggestion cards can carry `"newProject": true` with a `projectName`; Plan it then creates a new-project goal.
5. The Goal panel lists "Files created" (path, size) with View (opens the file in the project editor), Download, and, for the whole project, Download ZIP, Open project, and Preview (when the project has an HTML file).
6. Live preview: the project page and the Goal panel can open a preview of the project's entry HTML file (the shallowest `index.html`, else the shallowest `.html` file). Relative links, styles, scripts, and images load from the project. The preview runs in an opaque origin (`sandbox="allow-scripts allow-forms"` on the frame and `Content-Security-Policy: sandbox allow-scripts allow-forms` on every response), so it cannot read the app's cookies, storage, or pages.
7. Preview access uses a signed, expiring token (1 hour) issued only to workspace members; the token names one project, files outside it are unreachable, and unsafe paths are rejected. Expired or tampered tokens get 403.
8. Lint, type checks, backend tests, unit tests, E2E, and builds pass; screens checked at 1440px and 390px, light and dark.

### Out of scope

Running server code or builds (preview serves static files only), npm installs, deployment, editing inside the preview.

## 2. Design

- **Data**: `Goal.newProject` (boolean) and `Goal.projectName` (string, nullable). The plan schema gains an optional `projectName`, required by the planner prompt when `newProject` is set.
- **Planning**: the planner prompt says the goal builds a new project and asks for `projectName`. `PUT /plan` accepts `projectName` for new-project goals.
- **Start**: inside the existing start transaction, a new-project goal creates the project (unique name per workspace) and sets `Goal.projectId` before the runner starts.
- **Runner**: after a task's edits are checked, for a goal with `newProject`, each pending edit with `baseRevision` 0 is saved with `saveText` as the goal's creator and marked `applied` (or `rejected` with the save error). Other edits stay `pending`.
- **Preview tokens**: `POST /api/workspaces/:id/projects/:pid/preview-token` (viewer) returns `{ url }` where `url = /api/preview/<token>/<entry path>`. The token is `base64url(projectId.expiry).hmac` signed with HMAC-SHA256 using a key derived from `CREDENTIALS_KEY`. `GET /api/preview/:token/*` verifies the token, normalizes the path, loads the file from that project, and responds with its content type (HTML, CSS, JS, JSON, SVG, images, fonts, text), `Content-Security-Policy: sandbox allow-scripts allow-forms`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, and `Referrer-Policy: no-referrer`. A missing file returns 404 with a short HTML message.
- **Frontend**: project picker option; plan editor project-name field; suggestion card "Plan it in a new project"; Goal panel "Files created"; project page "Preview" button and `?open=<path>` support; `PreviewFrame` component (iframe with the sandbox attribute, a reload button, and "Open in new tab").

## 3. Security

Previewed code is the owner's own project (often model-written). It runs only inside the opaque-origin sandbox: no access to app cookies, local storage, or the parent page; it may make its own network requests, like any static site. Tokens expire after an hour and cover one project.

## 4. Testing

- **Backend**: new-project goal plans with a name; Start creates the project (name collision gets a suffix); cancel before Start creates nothing; created files are saved at revision 1 and marked applied; a rejected created file (for example `.env`) is marked rejected with its reason; an edit to an existing file stays pending; a later task can read an earlier task's file; suggestion-free path unchanged for linked projects. Preview: members get a token, viewers too, other workspaces 404; served HTML and CSS have the right content type and sandbox header; tampered and expired tokens 403; `..` paths 400; another project's file is unreachable.
- **Unit**: preview entry selection; token sign and verify (round trip, tamper, expiry).
- **E2E**: pick New project, give a goal, see the project name on the plan, Start, see Files created (index.html, style.css), open Preview and see the page's heading inside the frame, download the ZIP.
