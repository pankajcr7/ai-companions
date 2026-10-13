# Website Study with REA: Look at and Learn from a Site the Owner Names

Date: 2026-10-13
Status: Draft for owner review
Builds on: companion harness (tools in a loop), tool-result images (chat attachments part 1), web search

## 1. Goal

When the owner says "clone this", "make a page like this site" or "build a feature like this product" and gives a URL, a companion can look at the site and work out how it is built, then build its own version in the project.

Two new companion tools do this through [REA](https://github.com/morluto/rea) (MIT, `rea-agents` on npm), which inspects a page running in a headless Chrome on the backend server:

- `look_at_website`: a screenshot of the page plus its outline (headings, menus, buttons, links, form fields). For "make it look like this".
- `study_website`: what the site is built with, the API calls and page routes in its scripts, and the outside services it loads. For "make it work like this".

Measured locally on `vercel.com/pricing`: page capture 2.1 s, screenshot 1.0 s, script analysis 4.1 s. The raw REA result is 1.4 MB, so companions get a short summary, never the raw result.

Owner decisions: websites only; companions rebuild the idea and layout and never copy the site's code, images, logos or wording; the Render backend moves to the Standard plan (about $25 a month, 2 GB) to fit Chrome.

Out of scope: desktop apps, phone apps, binaries and firmware (REA needs Ghidra, Hopper or IDA on a desktop for those); clicking, scrolling, typing or logging in; full-page and phone-sized screenshots; fetching source maps; showing screenshots to the owner or saving them to projects; a better `open_url` reader.

Relation to the web visuals spec (2026-10-11, moli): that spec is not built. `look_at_website` covers its screenshot-for-the-AI part with the Chrome that REA needs anyway. If that spec is built later, its `screenshot` tool is dropped in favour of `look_at_website`; its `open_url` upgrade and owner-visible screenshots stay separate work.

## 2. Success criteria

### 2.1 look_at_website

1. `{"url": "https://..."}`, label: the host. Purpose line: "Shows a screenshot and outline of a public web page. Use it when asked to build something like an existing site."
2. Returns a picture (PNG of the top of the page, 1280×900 desktop view) through the existing tool-result image path, plus text, wrapped with `untrusted(...)`:
   ```
   Website: <page title> — <final url>
   Screenshot: top of the page, 1280×900 desktop view.
   Outline:
   - navigation: Main navigation
   - heading 1: Scale your app, control your costs
   - link: Start deploying
   ...
   Rebuild the idea and layout in your own code. Don't copy this site's code, images, logos or wording.
   ```
3. The outline comes from REA's accessibility tree, in page order: landmarks (banner, navigation, main, complementary, contentinfo, region, form, search), headings with their level (REA's `level` state), buttons, links, text boxes, search boxes, combo boxes, checkboxes, radios, tabs, tables, and named images. Nodes without a name are skipped, names are cut to 120 characters, a line identical to the one before it is dropped, and the outline stops at 200 lines or 15,000 characters with "[outline truncated]".
4. A screenshot over the existing picture limit (`imageFits`) is left out and the text says "The screenshot is too large to show." Models that can't see images get the existing fallback note.

### 2.2 study_website

5. `{"url": "https://..."}`, label: the host. Purpose line: "Studies how a public web page is built: frameworks, API calls, page routes and outside services."
6. Returns text only, wrapped with `untrusted(...)`:
   ```
   Website: <page title> — <final url>
   Built with: Next.js, React
   API calls in its scripts: /api/feedback, /api/geolocation, ...
   Page routes in its scripts: /, /pricing, /enterprise, ...
   Outside services it contacted: www.googletagmanager.com, js.stripe.com, ...
   Scripts: 92 files, 2.4 MB
   Rebuild the idea and how it works in your own code. Don't copy this site's code, images, logos or wording.
   ```
7. "Built with" lists REA's vendor fingerprints once each, with "(likely)" after medium-confidence ones and low-confidence ones left out. API calls are endpoint values that start with `/` or `http`. Page routes are route values that start with `/` and aren't files (`.js`, `.css`, `.map`, images, fonts) or under `/_next/`. Outside services are the hosts the fence (item 9) connected to while the page loaded, other than the page's own host; REA itself leaves other origins out of its results. Each list is de-duplicated, keeps the first 40 entries, and reads "none found" when empty.

### 2.3 Running Chrome safely

8. URLs must be `http` or `https`, carry no username or password, and not name a private host or address, using the same rules as `open_url`. A refused URL returns "That address isn't allowed: only public web pages can be opened."
9. Every request Chrome makes goes through a small proxy inside the backend (`--proxy-server` with `--proxy-bypass-list=<-loopback>`, so localhost goes through it too). The proxy resolves each host with the existing `guardedLookup` and refuses private addresses, which covers redirects, images, scripts and WebSockets as well as the first URL. It records each host it connects to, for `study_website`. WebRTC is limited to proxied connections (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`).
10. Each call starts a new Chrome with a fresh temporary profile, a 1280×900 window, no extensions, muted audio, DevTools on a random loopback port (read from `DevToolsActivePort`) and a minimal environment (`PATH` and a temporary `HOME`), so Chrome never sees the server's database URL or keys. Chrome is killed and the profile deleted when the call ends, whether it succeeded, failed or was cancelled.
11. Chrome's sandbox stays on. `CHROME_NO_SANDBOX=true` turns it off, off by default and only for a host that can't run the sandbox; the deploy notes say what that costs.
12. One Chrome at a time: a first-in, first-out queue in the server process, and a cancelled waiter leaves the queue. Each call has an 18 s deadline, inside the loop's 20 s tool limit: wait up to 8 s for the page to load, then 1.5 s for it to settle, then run REA. A page that doesn't load in time returns "That page took too long to load."
13. REA runs as a child process (`rea <command> --json`) with the same minimal environment, output capped at 32 MB, and is killed on cancel. `look_at_website` runs `inspect-web-page --include-accessibility-text` and `capture-web-screenshot` side by side; `study_website` runs `inspect-web-page` and `analyze-web-bundle` side by side.
14. If Chrome won't start or REA fails, the companion gets "Couldn't study that page right now. Use open_url for its text." and the server logs the error.

### 2.4 Turning it on

15. The tools are added wherever `open_url` is (chats, goal chat, planning and tasks), but only when `CHROME_PATH` is set. Without it nothing changes.
16. `rea-agents` becomes a pinned backend dependency (`6.4.0`).
17. `backend/scripts/install-chrome.sh`, run by `npm run chrome:install`, downloads the current stable `chrome-headless-shell` with `npx @puppeteer/browsers` into `backend/.chrome/` and links the binary to `backend/.chrome/chrome`. `backend/.chrome/` is git-ignored.
18. On start the server logs one line: `website tools on (<chrome path>)` or `website tools off: CHROME_PATH not set`.
19. Owner steps on Render: change the plan to Standard; set the build command to `npm install && npm run chrome:install && npm run db:deploy`; add `CHROME_PATH=/opt/render/project/src/backend/.chrome/chrome`. On a Mac, `CHROME_PATH` can point at Google Chrome.

## 3. Architecture

```
harness/browser.ts   withPage(url, signal, fn): queue of 1, URL check, proxy, launch Chrome, wait for load, cleanup
harness/fence.ts     startFence(): loopback HTTP proxy (CONNECT + plain HTTP) that refuses private addresses via guardedLookup and records hosts
harness/rea.ts       runRea(command, args, signal) → parsed JSON; outline(), studySummary() turn REA results into text
harness/tools.ts     webTools(searchKey) adds look_at_website and study_website when CHROME_PATH is set
scripts/install-chrome.sh   chrome-headless-shell into backend/.chrome/
```

- `outline()` and `studySummary()` are pure functions over REA's JSON, so they test without Chrome.
- No database changes and no frontend changes: the activity line already shows tool labels.

## 4. Testing

- Unit tests (no Chrome, no database):
  - `outline()` on a small sample with REA's accessibility shape: keeps landmarks, headings, buttons and links in order, skips unnamed nodes, drops repeats, truncates at the cap;
  - `studySummary()` on a small sample with REA's bundle and inspect shapes: frameworks once each with "(likely)", API calls and routes filtered, outside origins only, "none found" for empty lists;
  - the fence refuses `CONNECT` and plain requests to private addresses when `ALLOW_LOCAL_ENDPOINTS` is off, passes them when it is on, and records the hosts it connected to;
  - private and non-http URLs are refused before Chrome starts;
  - the tools are absent without `CHROME_PATH` and present with it.
- Browser test, skipped when `CHROME_PATH` isn't set: against a local test page, `look_at_website` returns a PNG and an outline with the page's heading, `study_website` returns its title and lists, and no Chrome process or temporary profile is left behind.
- Manual check before pushing: on the owner's Mac, a companion chat asked to "make a pricing page like vercel.com/pricing" calls `look_at_website` and describes the page correctly.
