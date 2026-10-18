# Mobile App Design: Matching Phone Screens from One Request

Date: 2026-10-18
Status: Draft for owner review
Builds on: team goals (planning, tasks, Nova's quality check), project previews, image generation, website study
Part 1 of 2 (next: turning approved screens into a working app)

## 1. Goal

When the owner asks for a mobile app design ("design a mobile app for a hiking club"), the team designs every screen of the app in one matching style and the owner sees them side by side in phone frames, can ask for changes per screen, and can download them as code.

This is our own version of the idea behind [Sleek](https://sleek.design/), studied with REA on its public page only (no login):

- Observed (REA evidence `ev_5e5e620e…` screenshot, `ev_6c70fae7…` bundle analysis, and the public page text): a prompt, spec or reference screenshot goes in; Sleek "plans the look" (fonts, colours, style), then plans the screens, then draws every screen in that style, shown side by side in phone frames; screens can be changed by hand or by chat; they export as React with Tailwind, plain HTML, Figma layers or an agent prompt; layouts follow iOS and Android conventions, device sizes and tap-target sizes. The public page is Next.js and React; the only server calls in its public code are billing ones.
- Not observable: how Sleek generates screens, its models and prompts. They run on Sleek's servers behind login. Nothing of Sleek's code, assets or wording is used here.

Owner decisions: designs first, a working app later as its own spec; our own version built on the existing team, not a copy; it must run on Render's free plan with no new dependencies and no database changes.

Out of scope: editing screens by dragging on a canvas; screen version history; Figma export; share links; turning screens into a working app (part 2).

## 2. Success criteria

### 2.1 Starting

1. The chat's starter examples gain "Design a mobile app" with the prompt "Design a mobile app for ". Asking in any wording works the same way: Nova suggests a goal, as for any work.
2. A goal is a mobile design goal when its text matches `isMobileDesign` (owner's choice, 2026-10-18: an app plus design words): a mobile, iOS, Android, iPhone, smartphone or phone app (also "mobile-app", "mobile application") named together with a design word (design, redesign, screens, UI, UX, mockup, wireframe, prototype), or "mobile design / screens / UI / UX / mockups / wireframes / prototypes" (any case). "Web app" never counts. Goals started from the Mobile App page ("Design a mobile app: …", "Mobile app design changes: …") always count. "Make an iOS app" alone is building an app (part 2), not designing one.

### 2.2 Planning

3. For a mobile design goal, Nova's planning instructions add:
   - The first task is "The look and the screen list": it writes `design/identity.md` (app name, audience, feeling, colours as hex values, fonts from Google Fonts, spacing scale, corner radius, the shared components: header, tab bar, buttons, cards, inputs) and `design/screens.md` (the numbered screen list: file name, purpose, key content, how it is reached).
   - The other tasks draw 3 or 4 screens each, named `screens/NN-name.html` to match the list, and depend on the first task.
   - 6 to 10 screens unless the owner asked for a number; at most 6 tasks in all, as for any goal.
   - The plan's brief is a short summary of the look.
   - A follow-up to an app design (a goal with a parent, such as Ask for changes) is planned as changes instead: change only the screens the owner names, keep `design/identity.md` and `design/screens.md` unless asked, as few tasks as the change needs.
   - If the owner attached a screenshot, the look matches it ("Match a design"). If the goal names a website, the existing site look covers it.

### 2.3 Drawing screens

4. Tasks of a mobile design goal get the mobile screen guide in addition to the design guide:
   - read `design/identity.md` and `design/screens.md` before drawing;
   - each screen is one standalone HTML file with `<title>` set to the screen's name and `<meta name="viewport" content="width=390, initial-scale=1">`, laid out for a 390×844 phone;
   - Tailwind from `https://cdn.tailwindcss.com` with the same `tailwind.config` (colours, fonts) copied into every screen, and the same Google Fonts link;
   - the top 47 px (status bar) and bottom 34 px (home indicator) stay clear of content; native patterns: a tab bar or navigation bar as the screen list says, the same header, tab bar and buttons on every screen;
   - tap targets at least 44 px, text at least 12 px, real content (no placeholders), icons as inline SVG (no emoji, no icon fonts), pictures from `generate_image` only when they matter (about 6 free images a day), otherwise colour and shape;
   - it must look like a real app, not a website squeezed into a phone.
5. Nova's quality check of these tasks uses the same guide.

### 2.4 Seeing the screens

6. A project with at least one `screens/*.html` file shows **Phone screens**:
   - on the project page, a "Phone screens" button next to Preview;
   - in the chat's preview panel, the phone gallery replaces the single-page preview for such projects.
7. The gallery shows every `screens/*.html` file in name order, each in an iframe of 390×844 inside a phone frame (rounded corners, thin border), scaled to fit: several per row on a laptop, one per row on a phone. Above each: the screen's name from its file name (`01-home.html` → "Home").
8. Screens load through the existing sandboxed preview (one preview link for the project, the screen's path appended); nothing new is served.
9. Clicking a screen opens it at full size; Escape or Close returns to the gallery.
10. In the chat's preview panel, each screen has **Ask for changes**, which uses the existing request-changes action with that screen's path: the chat opens on that project with the draft "Please update screens/01-home.html in <project>: ". The project page has no chat, so its gallery has no Ask for changes.
11. The gallery has **Download screens**, the existing project ZIP download.
12. A project without screens looks exactly as today.

### 2.5 Code

13. The screens are the code: plain HTML with Tailwind, downloadable today. A React + Tailwind version is an ordinary chat request to the team; no converter is built.

## 3. Architecture

```
backend/src/goals/mobile.ts     isMobileDesign(text), MOBILE_PLAN (planning text), MOBILE_GUIDE (screen guide)
backend/src/goals/prompts.ts    planInstructions(..., mobile) adds MOBILE_PLAN; taskInstructions(..., mobile) adds MOBILE_GUIDE
backend/src/goals/planner.ts    passes isMobileDesign(goal.text)
backend/src/goals/runner.ts     passes it to taskInstructions and to Nova's review
backend/src/goals/quality.ts    reviewPrompt adds MOBILE_GUIDE when asked
frontend/src/lib/screens.ts     phoneScreens(paths) → [{ path, name }] in order
frontend/src/components/app/files/PhoneScreens.tsx   the gallery, full-size view, Ask for changes, Download screens
frontend: project page button, chat preview panel switch, chat starter example
```

- `mobile.ts` holds plain text and one regular expression; the guide stays under 2,000 characters like the design guide.
- No new routes, packages or tables.

## 4. Testing

- Backend unit (no database): `isMobileDesign` matches the phrases in item 2 and not "Build a landing page" or "Write app store copy"; `planInstructions` with `mobile` contains the planning text and without it doesn't; `MOBILE_GUIDE` names the 390×844 size, the Tailwind CDN, `design/identity.md` and the 44 px tap target, and is under 2,000 characters.
- Backend with the fake AI: a mobile design goal's planning instructions contain the mobile plan; its tasks' instructions and Nova's review contain the mobile guide; an ordinary goal's don't.
- Frontend unit: `phoneScreens` keeps only `screens/*.html`, sorts by file name and turns `01-home.html` into "Home" and `03-order-history.html` into "Order history".
- E2E (Playwright, existing setup): a project with `screens/01-home.html` and `screens/02-profile.html` shows Phone screens on the project page with two named phone frames; clicking one opens it full size; a project without screens shows no Phone screens button. In the chat's preview panel, Ask for changes on "Home" fills the chat draft with "Please update screens/01-home.html in".
- Manual check before pushing: on the owner's Mac, "Design a mobile app for a hiking club" plans the look first, draws screens into `screens/`, and the gallery shows them in phone frames.

## 5. Part 1b: the Mobile App page

Owner decision (2026-10-18): a "Mobile App" item in the sidebar, under Chat, opens a page of its own, like Sleek's start screen, built on the same team goals.

### 5.1 Sidebar

14. The sidebar gains **Mobile App** (phone icon) right after Chat, linking to `/w/<slug>/mobile` and marked current on every `/mobile` page.

### 5.2 Start page (`/w/<slug>/mobile`)

15. Heading "Mobile App", the line "Make your app look designed.", a text box labelled "Describe your app, or paste your spec", an **Add screenshot** button (one PNG, JPEG or WebP image, uploaded with the existing attachment upload and shown as a removable chip), and **Design it**.
16. Example chips fill the box: "Hiking trails" → "A hiking trails app: saved trails, a trail map and a trip log", "Cycle tracker" → "A cycle tracker app: rides, weekly goals and a ride map", "Recipe planner" → "A recipe planner app: weekly meal plan, recipes and a shopping list".
17. **Design it** (disabled while the box is empty or a screenshot is uploading; hidden for viewers) creates the goal directly: `POST /goals` with `text` "Design a mobile app: <the box>", `newProject: true` and the screenshot's id in `attachmentIds`, then opens `/w/<slug>/mobile/<goal id>`. The team busy (409 with code `busy`) shows "Your team is busy with another goal. Try again when it finishes."; any other error, including Nova having no model, shows its own message.
18. **Your apps** lists, newest first, every goal that is a mobile design (the goals list's `mobile` flag) and has no parent goal (`GET /goals?roots=1`, up to 100): its name (the goal text without "Design a mobile app: ", cut at 60 characters), its status in plain words (Planning, Ready to start, Working, Done, Needs a fix) and, when its project exists, the screen count from the projects list. Each links to its app page. With none: "Your app designs will appear here."

### 5.3 App page (`/w/<slug>/mobile/<goal id>`)

19. Shows the app's name and, for the newest goal in this app (the given goal, or the newest goal on the same project from `GET /goals?projectId=`), the existing goal card: plan, Start, progress. When that card's goal changes status or gets edits applied, the page loads its files once more.
20. Once the app has a project, the phone screens gallery shows its `screens/*.html`, refreshed every 5 seconds while that goal is planning, waiting to start or working, and once otherwise. With no screens yet: "Screens will appear here as the team draws them."
21. **Ask for changes**: a text box "What should change?" and **Send changes**, shown to members once the app has a project. It creates a follow-up goal: `POST /goals` with `text` "Mobile app design changes: <the box>", the app's `projectId` and `parentGoalId` set to the newest goal. The team busy (409) shows the same message as item 17.

### 5.4 Backend

22. `POST /goals` accepts `attachmentIds` (at most 4): the caller's own attachments not yet sent with a message, checked like chat attachments, and linked to the new goal before Nova plans it, so they appear in the plan's attached files and are copied into the project at Start.
23. `GET /goals` adds `parentGoalId` and `mobile` (`isMobileDesign(text)`) to each goal, and accepts `roots=1` (goals without a parent, up to 100) and `projectId=` (one project's goals, newest first).
24. The projects list with `overview=1` adds `screens`: the number of `screens/*.html` files.

### 5.5 Testing (part 1b)

- Backend: a goal created with an attachment lists it among the goal's files and in the planning prompt's attached files; someone else's attachment is refused (404); `GET /goals` returns `mobile` and `parentGoalId`; the overview counts `screens/*.html` only.
- E2E: the sidebar's Mobile App opens the start page; typing a description and pressing Design it (with the fake model) opens the app page with the plan card and the app listed under Your apps; an app whose project has screens shows them on its app page; Ask for changes creates a follow-up goal whose card replaces the first.

## 6. Part 2 (later, its own spec)

Turning approved screens into a working React Native (Expo) app: project layout, navigation from `design/screens.md`, running it on a phone with Expo Go, and how the team tests it.
