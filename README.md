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

The home screen is a chat with Nova. Ask a question and Nova answers; ask for work ("Build a landing page for my bakery") and Nova's plan appears in the chat: press **Start**, or **Change** it first. While the team works, the top bar and the Send button show a red **Stop**; a stopped goal can **Resume**. Results, Nova's summary, suggested file changes, and any files created (with **Preview**) appear in the same chat, and you can keep asking about them. Past chats are listed on the left. The "Working on" picker under the chat chooses a project, or a new one.

After you press Start, ask Nova about the goal right in the panel: why something was done, what a piece of code does, or what to do next. **Continue with a new goal** plans the next step with this goal's results in mind. Code in any AI message shows as a code card with a Copy button, and every message, result, and summary can be copied.

To build something new, pick **New project** in the bar's project picker. Nova names the project in its plan, the project is created when you press Start, and files the companions create are saved straight into it (changes to existing files still wait for Apply). The goal lists **Files created** with View, Download, Download ZIP, and **Preview**, which shows a website project live in a sandboxed frame. Projects with HTML files have a Preview button too.

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
