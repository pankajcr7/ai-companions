# Website Study: Look at and Learn from a Site the Owner Names

Date: 2026-10-13
Status: Draft for owner review
Builds on: companion harness (tools in a loop), tool-result images (chat attachments part 1), web search
Replaces: the REA version of this spec (same day), which needed Chrome on the $25 Render plan

## 1. Goal

When the owner says "clone this", "make a page like this site" or "build a feature like this product" and gives a URL, a companion can look at the site and work out how it is built, then build its own version in the project.

Two new companion tools:

- `look_at_website`: a screenshot of the page plus its text as Markdown, with its sections listed first. For "make it look like this".
- `study_website`: what the site is built with, the API calls in its scripts, the pages it links to and the outside services it loads. For "make it work like this".

The backend runs on Render's free plan (512 MB, 0.1 CPU), so nothing heavy runs on the server. Screenshots and page text come from [Jina Reader](https://jina.ai/reader) (free, no key; the reader Agent Reach uses), which renders the page in its own browser. `study_website` is a light check of the page's HTML and scripts done by the backend itself.

Measured without a key on `stripe.com/pricing`: page text as Markdown in 9.3 s; a 1280×1280 PNG screenshot (250 KB) in 11.3 s.

Owner decisions: websites only; companions rebuild the idea and layout and never copy the site's code, images, logos or wording; everything must work on Render's free plan at no cost.

Out of scope: REA and Chrome on the server; desktop apps, phone apps and binaries; clicking, scrolling, typing or logging in; full-page and phone-sized screenshots; showing screenshots to the owner or saving them to projects; using Jina for `open_url`.

Relation to the web visuals spec (2026-10-11, moli): that spec is not built. `look_at_website` covers its screenshot-for-the-AI part. If that spec is built later, its `screenshot` tool is dropped in favour of `look_at_website`; its `open_url` upgrade and owner-visible screenshots stay separate work.

## 2. Success criteria

### 2.1 Both tools

1. Both take `{"url": "https://..."}` and are labelled with the host.
2. The URL is checked with the same rules as `open_url` (`checkBaseUrl`: `http` or `https`, no username or password, no private host or address) before any request. A refused URL returns "That address isn't allowed: only public web pages can be opened."
3. Results are wrapped with `untrusted(...)` and end with a rebuild line: "Rebuild the idea and layout in your own code. Don't copy this site's code, images, logos or wording." (`study_website` says "the idea and how it works".)
4. Both are added in `webTools()` next to `open_url`, so every place companions have `open_url` gets them: chats, goal chat, planning and tasks. No setting turns them on.

### 2.2 look_at_website

5. Purpose line: "Shows a screenshot of a public web page and its text. Use it when asked to build something like an existing site."
6. Two Jina requests run side by side through `safeFetch`, to `${JINA_URL ?? "https://r.jina.ai"}/<url>` with `Accept: application/json`: one plain (title and Markdown), one with `X-Respond-With: screenshot` (title and `screenshotUrl`). When `JINA_API_KEY` is set it is sent as `Authorization: Bearer <key>` (a free Jina key raises the limit from about 20 to 500 pages a minute). The screenshot is then downloaded from `screenshotUrl` through `safeFetch`.
7. Each part has its own 17 s deadline (and stops when the tool is cancelled), so a result arrives inside the loop's 20 s tool limit.
8. Text:
   ```
   Website: <title> — <url>
   Screenshot: top of the page.
   Sections:
   - # Pricing built for businesses of all sizes
   - ## Payments
   ...
   Page text (Markdown):
   <markdown, cut at 12,000 characters with "[truncated]">
   Rebuild the idea and layout in your own code. Don't copy this site's code, images, logos or wording.
   ```
   Sections are the Markdown's `#`, `##` and `###` lines in order, links reduced to their text, empty ones skipped, at most 60.
9. The picture is sent only if the download is `image/png`, `image/jpeg` or `image/webp` and fits the existing picture limit (`imageFits`). Models that can't see images get the existing fallback note.
10. Partial results: if only the screenshot fails, the Screenshot line reads "No screenshot this time." If only the text fails, the result is the picture with "Couldn't read the page text." and no Sections or Page text. If both fail, the tool fails with the first part's message.
11. Messages: Jina answering 429 → "The free page reader is busy. Try again in a minute."; Jina reporting the page's own `httpStatus` of 400 or more → "The page answered with an error (<status>)."; a deadline → "That page took too long to load."; anything else → "Couldn't open that page through the page reader."

### 2.3 study_website

12. Purpose line: "Checks how a public web page is built: frameworks, API calls in its scripts, pages it links to and outside services."
13. The page is fetched through `safeFetch` with today's `open_url` rules and messages (no redirects, private addresses refused, 2 MB cap, `text/html` only).
14. Up to 5 scripts on the page's own host (`<script src>`, in page order) are fetched side by side through `safeFetch`, each capped at 1 MB; a script that fails is skipped.
15. Text:
    ```
    Website: <title> — <url>
    Built with: Next.js, React (from page markers)
    API calls in its scripts: /api/cart, /api/checkout, https://api.example.com/v1/prices
    Pages it links to: /pricing, /about, /docs
    Outside services it loads: js.stripe.com, www.googletagmanager.com
    Scripts: 12 on the page, looked through 5.
    These are clues from the page's HTML and scripts, not a full analysis.
    Rebuild the idea and how it works in your own code. Don't copy this site's code, images, logos or wording.
    ```
16. Built with: the `<meta name="generator">` content first, then these markers found in the HTML or script URLs, in this order: Next.js (`/_next/`, `__NEXT_DATA__`), Nuxt (`/_nuxt/`, `__NUXT__`), Gatsby (`___gatsby`), Remix (`__remixContext`), SvelteKit (`__sveltekit`), Astro (`astro-island`), Angular (`ng-version`), Vue (`data-v-`), React (`data-reactroot`, `react-dom`, or Next.js / Gatsby / Remix found), WordPress (`wp-content`), Shopify (`cdn.shopify.com`), Webflow (`data-wf-page`), Framer (`framerusercontent.com`), Wix (`wixstatic.com`), Squarespace (`squarespace`), Bootstrap (`bootstrap`), jQuery (`jquery`). Each name appears once.
17. API calls: in the fetched scripts and the page's inline scripts, quoted strings passed to `fetch(` or `axios.get/post/put/patch/delete(`, and any quoted string starting with `/api/` or `/graphql`.
18. Pages it links to: `<a href>` paths on the page's own host, without query or fragment, skipping files (`.png`, `.jpg`, `.svg`, `.pdf`, `.css`, `.js` and similar).
19. Outside services: hosts in `src` or `href` of `script`, `link`, `img`, `iframe` and `source` tags that differ from the page's host.
20. Every list is de-duplicated, keeps its first 40 entries, and reads "none found" when empty.

### 2.4 Activity line

21. Live labels: `look_at_website` → "🖼️ Looking at <host>…", `study_website` → "🔎 Studying <host>…". Finished replies: "Looked at 1 website" / "Looked at 2 websites", "Studied 1 website" / "Studied 2 websites".

## 3. Architecture

```
harness/site.ts    lookAtWebsite(url, signal): ToolOutput; studyWebsite(url, signal): string
harness/web.ts     exports readCapped (today private) for site.ts
harness/tools.ts   webTools() adds look_at_website and study_website
frontend lib/activity.ts   labels and counts for the two tools
```

- `site.ts` reuses `safeFetch`, `checkBaseUrl`, `untrusted`, `imageFits` and `ToolError`. The HTML is read with regular expressions: the clues are best effort and say so.
- No new dependencies, no database changes, no new screens.

## 4. Testing

- Backend, with fake servers (no real Jina, no internet), in `backend/test/site.test.ts`:
  - `look_at_website` returns the picture, the title, the sections and the Markdown, wrapped as untrusted, ending with the rebuild line;
  - it sends `Authorization: Bearer` only when `JINA_API_KEY` is set;
  - a failed screenshot gives text with "No screenshot this time."; a failed text part gives the picture with "Couldn't read the page text."; both failing gives the first message;
  - Jina 429 gives the busy message; a page `httpStatus` of 404 gives "The page answered with an error (404).";
  - a private URL is refused before any request reaches the fake Jina;
  - `study_website` on a fake page with a generator tag, `__NEXT_DATA__`, own and outside scripts, inline `fetch("/api/cart")` and links returns each line as specified, looks through at most 5 scripts, skips a failing script, and reports "none found" for empty lists;
  - `study_website` refuses a redirect and a non-HTML page with today's `open_url` messages.
- `harness-tools.test.ts` and `chat-harness.test.ts`: the web tool list now includes the two tools.
- Frontend `activity.test.ts`: the new live labels and counts.
- Manual check before pushing: on the owner's Mac, a companion chat asked to "make a pricing page like stripe.com/pricing" calls `look_at_website` and describes the page correctly.
