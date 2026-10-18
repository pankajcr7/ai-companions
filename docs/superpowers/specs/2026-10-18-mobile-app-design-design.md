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

Out of scope: a separate design studio page; editing screens by dragging on a canvas; screen version history; Figma export; share links; turning screens into a working app (part 2).

## 2. Success criteria

### 2.1 Starting

1. The chat's starter examples gain "Design a mobile app" with the prompt "Design a mobile app for ". Asking in any wording works the same way: Nova suggests a goal, as for any work.
2. A goal is a mobile design goal when its text matches `isMobileDesign`: "mobile app", "iOS app", "Android app", "iPhone app", "phone app", "app screens", "app design", "app UI", "app mockups", "mobile design", "mobile screens" or "mobile UI" (any case).

### 2.2 Planning

3. For a mobile design goal, Nova's planning instructions add:
   - The first task is "The look and the screen list": it writes `design/identity.md` (app name, audience, feeling, colours as hex values, fonts from Google Fonts, spacing scale, corner radius, the shared components: header, tab bar, buttons, cards, inputs) and `design/screens.md` (the numbered screen list: file name, purpose, key content, how it is reached).
   - The other tasks draw 3 or 4 screens each, named `screens/NN-name.html` to match the list, and depend on the first task.
   - 6 to 10 screens unless the owner asked for a number; at most 6 tasks in all, as for any goal.
   - The plan's brief is a short summary of the look.
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

## 5. Part 2 (later, its own spec)

Turning approved screens into a working React Native (Expo) app: project layout, navigation from `design/screens.md`, running it on a phone with Expo Go, and how the team tests it.
