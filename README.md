# Agent Company

A virtual company of AI companions working in a live office.

- `frontend/` Next.js 16 (port 3000). Proxies `/api/*` to the backend.
- `backend/` Fastify + Better Auth + Prisma 7 on Neon Postgres (port 4000).

## Setup

1. Create a free Neon project and a second database named `test` in it.
2. Copy `.env.example` to `backend/.env` and fill in the values (never commit it).
3. Install and migrate:

```
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run db:migrate
```

Optional: Google sign-in needs a Google Cloud OAuth client with redirect URI
`http://localhost:3000/api/auth/callback/google`, then `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`.

## Run

```
npm run dev:backend
npm run dev:frontend   # http://localhost:3000
```

## AI providers

Open **AI providers** in the app sidebar.

- **ChatGPT account**: "Continue with ChatGPT" uses OpenAI's Sign in with ChatGPT. It works on a local or self-hosted install (`CHATGPT_LOCAL_LOGIN=true`). A hosted site needs OpenAI's approval through their interest form.
- **Claude**: Anthropic does not allow other apps to use Claude logins, so use an Anthropic API key.
- **OpenAI, Google Gemini**: paste an API key.
- **Custom endpoint**: OpenRouter, xAI, DeepSeek, Ollama, or any OpenAI-compatible URL. Local servers such as Ollama need `ALLOW_LOCAL_ENDPOINTS=true`.

Keys and tokens are encrypted with `CREDENTIALS_KEY` and never shown again.

Live check with a real key (optional, costs a few tokens):

```
LIVE_PROVIDER=openai LIVE_API_KEY=sk-... LIVE_MODEL=<model id> npm --prefix backend run smoke
```

## Projects and files

Open **Projects** in the sidebar to upload a folder, a ZIP, or files, then browse and edit them in the built-in code editor. Every save is a version you can restore. Download single files or the whole project as a ZIP.

- Skipped automatically: `node_modules`, `.git`, build output, caches, `.env` files (except `.env.example`), private keys and credential files.
- Limits: 2,000 files and folders, 50 MB per project, 10 MB per file, 1 MB for files edited in the browser.
- Files are stored on the server's disk under `backend/data/blobs` (set `FILES_DIR` to change). Nothing uploaded is ever run.

## Company goals

Type a goal in the bar at the bottom of the office and pick a project (optional). Nova plans tasks for your companions; edit, reassign, or remove tasks, then press **Start**. Each companion works with its own AI model and reads the files it needs from the project. Developers can propose file changes: open **View changes**, then **Apply** or **Reject**. When everything finishes, Nova reviews each result against its acceptance criteria and writes a summary. Start a message with `chat:` to talk to Nova directly instead.

- On a project page, **Read my project** asks Nova for a summary every companion reuses. `.company/brief.md` and `.company/brand.md` are shared with every companion on that project.
- Limits: 6 tasks per goal, 3 running at once, one goal in progress per company. Nothing runs until you press Start.
- Every AI call is logged with its tokens; rate each result with thumbs up or down to help improve the prompts.

## Test

```
npm --prefix backend test        # API tests against the Neon "test" database
npm --prefix frontend run e2e    # browser test, uses your installed Google Chrome
```

## Status

Milestone 1 (accounts, workspaces, Live Office shell, companion customization) is built.
Companions do not do work yet: every status is Idle, Paused, or Archived. AI providers arrive in milestone 2.
