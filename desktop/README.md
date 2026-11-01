# Agent Company for Mac and Windows

The desktop app shows the live Agent Company (https://ai-companions-five.vercel.app) in its own window and adds one thing a
browser can't do: **open a folder on your computer as a project**, so your AI team works on its files directly.

## Install

Download the installer from the repository's [Releases](https://github.com/pankajcr7/ai-companions/releases) page: the
newest release whose name starts with `desktop-v`.

**Mac**: `Agent-Company-<version>-arm64.dmg` for Apple Silicon (M1 and later), `…-x64.dmg` for Intel Macs.
Open the `.dmg` and drag Agent Company into Applications. The app isn't signed by Apple yet, so the first time:

1. Open Agent Company. macOS says it can't check the app; click **Done**.
2. Open **System Settings → Privacy & Security**, scroll down to the message about Agent Company and click **Open Anyway**.

**Windows**: run `Agent-Company-Setup-<version>.exe`. The app isn't signed yet, so Windows may show "Windows protected your PC":
click **More info**, then **Run anyway**.

## Opening a folder

Choose **File → Open Folder…** (⌘O on Mac, Ctrl+O on Windows), or **Open folder** on the Projects page, and pick a
folder. It becomes a project, and its files stay in the folder: nothing is uploaded. Opening the same folder again
goes back to the same project.

- Your AI team reads and edits the files right there, while the app is open. Keep the folder open in VS Code,
  Finder or Explorer at the same time; the project page and the preview show the latest files.
- If you change a file while the team is working on it, the team's older copy is refused, so your edit is never
  overwritten.
- Before a file is replaced, the app keeps its earlier version: open the file's **History** to see or restore it.
  Deleted files go to the Trash / Recycle Bin.
- `node_modules`, `.git`, build output, `.env` and other secret files, and links to places outside the folder are
  never read.
- The team needs the app open on this computer to reach the folder. Without internet, the folder is still yours to
  work on in any app.

## Development

```bash
npm install
npm test            # folder and device tests
npm run test:app    # launches the built app against a local test page
npm start           # runs the app against the live site (AGENT_COMPANY_URL=http://localhost:3000 for local)
npm run dist -- --mac --arm64 --publish never   # builds an installer into dist-app/
```

Pushing a tag `desktop-v<version>` (matching `version` in `package.json`) makes GitHub build both installers and publish
the release (`.github/workflows/desktop.yml`).
