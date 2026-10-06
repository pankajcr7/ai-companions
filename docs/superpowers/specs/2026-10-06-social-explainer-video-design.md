# Social Explainer Video

Date: 2026-10-06
Status: Draft for owner review

## 1. Goal

A 30-second vertical (9:16) clip for X, LinkedIn and TikTok that shows what Agent Company does: one goal in, a team of AI companions plans it, builds it, checks it, and you see the real result. It shows real app footage with sound, and a script can render it again whenever the app changes.

Out of scope: other formats (landscape, long walkthrough), a call to action or URL, recorded human voice, licensed music.

## 2. Success criteria

1. `video/out/agent-company-social.mp4`: 1080×1920, 30 fps, H.264 + AAC, `+faststart`, 28–32 s long, with an audio track.
2. The app footage is the real frontend and backend running a scripted demo; no paid AI calls.
3. Narration, captions and picture line up: each scene starts with its narration line, and captions show the spoken words.
4. One command re-renders the whole clip: `npm --prefix video run build`.
5. Nothing in `frontend/` or `backend/` changes, and the e2e tests are untouched.

## 3. Storyboard

Look: the app's brand. Lime `#a6ff00` on near-black `#0e1013`, Space Grotesk for display text, Urbanist for captions, the companion avatars from `frontend/public/companions`.

Demo company "Crumb Bakery" on the small-team template (Nova head agent, Lina UI/UX designer, Tomás content writer, Sana full-stack developer). Goal: "Build a landing page for my bakery", as a new project.

| Time (approx.) | On screen | Narration |
|---|---|---|
| 0–3 s | Kinetic text: "One goal." then "A whole AI team." | "Give one goal to your AI team." |
| 3–8 s | App, zoomed: the goal typed into Chat with Nova, Send | "Tell Nova, your head agent, what you need." |
| 8–13 s | Nova's plan card fills in (Lina designs, Tomás writes, Sana builds), Start pressed | "Nova plans it and hands each task to the right teammate." |
| 13–19 s | The team at work: avatars, live "Working…" status | "The team builds it while you watch." |
| 19–24 s | "✓ Checked by Nova · 1 fix made", then Preview shows the bakery site | "Nova checks every result, then you see the real thing, live." |
| 24–30 s | End card: the app's logo (the SVG mark and lowercase "agent company" wordmark from `Logo` in `frontend/src/components/landing/ui.tsx`), then "Give one goal. Your AI team delivers." | "Agent Company. Give one goal. Your AI team delivers." |

Exact scene lengths come from the measured length of each narration line plus a short pause, and the total is held to 28–32 s. Captions show 2–3 words at a time, timed by splitting each line's length across its words in proportion to their length. Each cut gets a whoosh, and each on-screen button press gets a click.

## 4. Pipeline

All files are under `video/` at the repo root. `video/package.json` holds the only new dependency, `ffmpeg-static`, which supplies the ffmpeg binary. Playwright comes from `frontend/node_modules`. `video/out/` and the working frames are git-ignored.

1. **Record** (`video/record.spec.ts`, `video/playwright.config.ts`, `video/demo-llm.ts`).
   - Uses the same web servers as the e2e config (backend `dev:test` on 4100, frontend on 3100), after `db:reset:test`. Recording resets the test database, just like running the e2e tests does.
   - `demo-llm.ts` is a scripted fake AI server on port 4198, written for this video and modelled on `frontend/e2e/fake-llm.ts`. It plans three tasks for Lina, Tomás and Sana (agent ids parsed from the planning prompt), writes a polished one-page bakery site (`index.html` + `style.css`), asks for one fix in one review round, then approves and summarises. Replies are paced (about 1–2 s each) so the "Working…" state is visible.
   - The script signs up, creates the company, connects the demo AI to every AI companion, and runs the storyboard at human speed (typed text, pauses before clicks).
   - Frames: Chrome's screencast (CDP `Page.startScreencast`, PNG) at 1280×800 CSS px with device scale factor 2. Each frame is saved with its timestamp, and scene markers (the time each storyboard step starts) are written to `frames/markers.json`.
   - Every step uses Playwright `expect` on the button or text it needs. A missing element fails the recording with a clear message.
2. **Audio** (`video/audio.mjs`).
   - `say -v "$VOICE"` (default `Samantha`) writes each narration line to AIFF. ffmpeg measures each line's length, and from those lengths it writes `timeline.json` (scene start and end times, caption words with times).
   - A small WAV generator writes the music bed (soft chord pad, kick and hi-hat, about 100 BPM, 32 s, fades in and out) and the click and whoosh sound effects.
   - ffmpeg mixes the voice lines at their scene starts, the music at about −18 dB under the voice, and the effects at the cuts and clicks, into `mix.wav`.
3. **Compose** (`video/compose.html`).
   - One 1080×1920 page reads `timeline.json` and `markers.json` and exposes `seek(t)`, which draws the frame at time `t` without relying on wall-clock time.
   - App scenes show the recorded frame nearest to the matching moment of the recording, cropped and slowly zoomed or panned to the region that matters (the chat box, the plan card, the status, the preview), inside a rounded "screen" on the dark background.
   - It also draws the kinetic text, the captions in a fixed band and the end card.
4. **Render** (`video/render.mjs`).
   - Playwright loads `compose.html` at 1080×1920. For each of the frames (30 fps × duration) it calls `seek(t)`, takes a screenshot, and pipes the frames to ffmpeg.
   - ffmpeg encodes to the MP4 in criterion 1 with `mix.wav`: `libx264 -crf 18 -pix_fmt yuv420p`, AAC 192 kbps.

`npm --prefix video run build` runs record, audio and render in order. Each step can also run on its own (`record`, `audio`, `render`), so tweaking the composition doesn't need a new recording.

## 5. Verification

- ffprobe confirms criterion 1 (size, frame rate, length, an audio stream).
- One still frame from each scene is exported and inspected: text readable at phone size, nothing cut off, captions match the narration.
- The owner watches and listens to the final clip. The audio mix isn't checked automatically.
- `npm --prefix frontend run e2e` is not affected (no files outside `video/` change except `.gitignore`).
