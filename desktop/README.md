# Agent Company for Mac and Windows

The desktop app shows the live Agent Company (https://ai-companions-five.vercel.app) in its own window and adds one thing a
browser can't do: **sync a project with a folder on your computer**.

## Install

Download the installer from the repository's [Releases](https://github.com/pankajcr7/ai-companions/releases) page: the
newest release whose name starts with `desktop-v`.

**Mac**: `Agent-Company-<version>-arm64.dmg` for Apple Silicon (M1 and later), `…-x64.dmg` for Intel Macs.
Open the `.dmg` and drag Agent Company into Applications. The app isn't signed by Apple yet, so the first time:

1. Open Agent Company. macOS says it can't check the app; click **Done**.
2. Open **System Settings → Privacy & Security**, scroll down to the message about Agent Company and click **Open Anyway**.

**Windows**: run `Agent-Company-Setup-<version>.exe`. The app isn't signed yet, so Windows may show "Windows protected your PC":
click **More info**, then **Run anyway**.

## Syncing a folder

Open a project and click **Sync with a folder on this computer**, then pick a folder (empty, or with files you want in
the project). From then on, while the app is open:

- Files saved in the project appear in the folder; files you create or change in the folder (in VS Code, Finder,
  Explorer, any app) are saved to the project within a few seconds.
- Without internet, the folder still has everything. Changes you make are sent when you're back online.
- If a file changed on both sides, the project's version keeps the name and yours is kept next to it as
  `name (my copy).ext`. Keep what you want and delete the copy.
- A file deleted in the project goes to the Trash / Recycle Bin. A file you delete in the folder stays in the project
  until you click **Delete them in the project too** (or **Bring them back**).
- `node_modules`, `.git`, build output, `.env` and other secret files, and files over 10 MB never sync.

**Stop syncing** unlinks the folder; both sides stay as they are.

## Development

```bash
npm install
npm test            # sync engine and folder tests
npm run test:app    # launches the built app against a local test page
npm start           # runs the app against the live site (AGENT_COMPANY_URL=http://localhost:3000 for local)
npm run dist -- --mac --arm64 --publish never   # builds an installer into dist-app/
```

Pushing a tag `desktop-v<version>` (matching `version` in `package.json`) makes GitHub build both installers and publish
the release (`.github/workflows/desktop.yml`).
