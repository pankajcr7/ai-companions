"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, DeviceMobile, FileText, Globe, Megaphone, Pause, Play, PresentationChart, SealCheck, Wrench } from "@phosphor-icons/react";
import { Corners, Label, SectionHeading } from "./ui";

// Example goals played out the way the team works on one: Nova plans and assigns, everyone works in parallel
// (some wait for a teammate's result), Nova checks each result (sometimes asking for a fix), and a summary comes back.
type Person = "rhea" | "sana" | "kofi" | "mei" | "lina" | "tomas";
type Lane = { who: Person; task: string; output: string; start: number; end: number; waitFor?: string; fix?: { until: number; note: string } };
type Goal = { chip: string; icon: React.ReactNode; text: string; ready: string; lanes: Lane[] };

const people: Record<Person, { name: string; role: string }> = {
  rhea: { name: "Rhea", role: "Engineering manager" },
  sana: { name: "Sana", role: "Frontend developer" },
  kofi: { name: "Kofi", role: "Backend developer" },
  mei: { name: "Mei", role: "QA engineer" },
  lina: { name: "Lina", role: "UI designer" },
  tomas: { name: "Tomás", role: "Scriptwriter" },
};

const goals: Goal[] = [
  {
    chip: "Website",
    icon: <Globe size={15} />,
    text: "Build a website for my coffee shop",
    ready: "Your website is ready",
    lanes: [
      { who: "lina", task: "Designing the look and colours", output: "style-guide.md", start: 2, end: 4.6 },
      { who: "tomas", task: "Writing the menu and page text", output: "copy.md", start: 2.2, end: 5.4, fix: { until: 6.8, note: "Making the menu text shorter" } },
      { who: "kofi", task: "Adding online ordering", output: "order.js", start: 2.4, end: 7.6 },
      { who: "sana", task: "Building the pages", output: "index.html", start: 5.4, end: 9.6, waitFor: "Lina" },
      { who: "mei", task: "Testing on phone and desktop", output: "qa-report.md", start: 10.4, end: 12, waitFor: "Sana" },
    ],
  },
  {
    chip: "Mobile app",
    icon: <DeviceMobile size={15} />,
    text: "Design a mobile app for my gym",
    ready: "Your app design is ready",
    lanes: [
      { who: "lina", task: "Choosing the colours and fonts", output: "identity.md", start: 2, end: 4.4 },
      { who: "rhea", task: "Planning the 8 app screens", output: "screens.md", start: 2.2, end: 4 },
      { who: "tomas", task: "Writing the buttons and menus", output: "app-copy.md", start: 2.4, end: 5.6 },
      { who: "sana", task: "Drawing the 8 screens", output: "screens/", start: 5.2, end: 9.4, waitFor: "Lina", fix: { until: 10.6, note: "Making the buttons bigger" } },
      { who: "mei", task: "Checking tap sizes and contrast", output: "checks.md", start: 11.4, end: 12.8, waitFor: "Sana" },
    ],
  },
  {
    chip: "Social posts",
    icon: <Megaphone size={15} />,
    text: "Write a week of Instagram posts for my bakery",
    ready: "Your posts are ready",
    lanes: [
      { who: "rhea", task: "Planning the posting calendar", output: "calendar.md", start: 2, end: 3.8 },
      { who: "tomas", task: "Writing 7 posts with captions", output: "posts.md", start: 2.2, end: 5.6, fix: { until: 7, note: "Adding a call to action" } },
      { who: "lina", task: "Making 7 matching images", output: "images/", start: 2.4, end: 7.4 },
      { who: "mei", task: "Checking spelling and tone", output: "review.md", start: 7.8, end: 9.4, waitFor: "Tomás" },
    ],
  },
  {
    chip: "Fix an app",
    icon: <Wrench size={15} />,
    text: "Fix the slow checkout in my online store",
    ready: "Your fix is ready to apply",
    lanes: [
      { who: "kofi", task: "Finding why checkout is slow", output: "findings.md", start: 2, end: 5 },
      { who: "rhea", task: "Planning the fix", output: "plan.md", start: 5.8, end: 6.8, waitFor: "Kofi" },
      { who: "sana", task: "Speeding up the cart page", output: "cart.tsx", start: 7.6, end: 10.6, waitFor: "Rhea" },
      { who: "mei", task: "Testing checkout end to end", output: "qa-report.md", start: 11.4, end: 13, waitFor: "Sana" },
    ],
  },
  {
    chip: "Pitch deck",
    icon: <PresentationChart size={15} />,
    text: "Make a pitch deck for my startup",
    ready: "Your pitch deck is ready",
    lanes: [
      { who: "rhea", task: "Researching your market", output: "research.md", start: 2, end: 4.6 },
      { who: "tomas", task: "Writing the story and slide text", output: "slides.md", start: 5.4, end: 8, waitFor: "Rhea", fix: { until: 9.2, note: "Making the story shorter" } },
      { who: "lina", task: "Designing 10 slides", output: "deck.html", start: 10, end: 12.4, waitFor: "Tomás" },
      { who: "mei", task: "Checking numbers and spelling", output: "review.md", start: 13.2, end: 14.4, waitFor: "Lina" },
    ],
  },
];

const LONGEST = goals.reduce((a, g) => (g.lanes.length > a.length ? g.lanes : a), goals[0].lanes);
const CHECK = 0.7; // how long Nova takes to check a result
const FINALE = 2.6; // how long the "ready" card stays before the next goal
const doneAt = (l: Lane) => (l.fix ? l.fix.until : l.end) + CHECK;
const timing = (g: Goal) => {
  const allDone = Math.max(...g.lanes.map(doneAt));
  return { allDone, summaryAt: allDone + 0.8, length: allDone + 0.8 + FINALE };
};

type State = { kind: "idle" | "waiting" | "working" | "checking" | "fixing" | "done"; label: string; progress: number };

function laneState(l: Lane, t: number): State {
  if (t < 1.8) return { kind: "idle", label: "Waiting for the plan", progress: 0 };
  if (t < l.start) return { kind: "waiting", label: l.waitFor ? `Waiting for ${l.waitFor}` : "Getting ready", progress: 0 };
  if (t < l.end) return { kind: "working", label: "Working", progress: (t - l.start) / (l.end - l.start) };
  if (t < l.end + CHECK) return { kind: "checking", label: "Nova is checking", progress: 1 };
  if (l.fix && t < l.fix.until) return { kind: "fixing", label: "Fixing: 1 note from Nova", progress: (t - l.end - CHECK) / (l.fix.until - l.end - CHECK) };
  if (l.fix && t < l.fix.until + CHECK) return { kind: "checking", label: "Nova is checking", progress: 1 };
  return { kind: "done", label: "Done · checked by Nova", progress: 1 };
}

function novaState(g: Goal, t: number) {
  const { allDone, summaryAt } = timing(g);
  const n = g.lanes.length;
  if (t < 0.9) return "Reading your goal";
  if (t < 1.8) return `Writing the brief and assigning ${n} tasks`;
  if (t < allDone) return `Checking work as it comes in · ${g.lanes.filter((l) => t >= doneAt(l)).length} of ${n} checked`;
  if (t < summaryAt) return "Writing your summary";
  return "All done";
}

// The activity feed: every event in the story, shown once its time has come.
function events(g: Goal) {
  const name = (l: Lane) => people[l.who].name;
  return [
    { at: 0.1, who: "you", text: `You asked: ${g.text}` },
    { at: 1, who: "nova", text: "Nova wrote the brief" },
    { at: 1.8, who: "nova", text: `Nova assigned ${g.lanes.length} tasks` },
    ...g.lanes.map((l) => ({ at: l.start, who: l.who, text: `${name(l)} started: ${l.task.toLowerCase()}` })),
    ...g.lanes.filter((l) => l.fix).map((l) => ({ at: l.end + CHECK, who: "nova", text: `Nova asked ${name(l)} for one fix` })),
    ...g.lanes.map((l) => ({ at: doneAt(l), who: "nova", text: `Nova checked ${name(l)}'s work` })),
    { at: timing(g).summaryAt, who: "nova", text: "Nova wrote your summary" },
  ].sort((a, b) => a.at - b.at);
}

const tone: Record<State["kind"], string> = {
  idle: "border-cream/10 text-haze",
  waiting: "border-cream/15 text-haze",
  working: "border-lime/50 bg-lime/10 text-lime",
  checking: "border-teal/50 bg-teal/10 text-teal",
  fixing: "border-[#ffb86b]/50 bg-[#ffb86b]/10 text-[#ffb86b]",
  done: "border-teal/40 text-cream",
};

// Without motion, the board shows one busy moment of the chosen goal instead of playing.
const REDUCED = "(prefers-reduced-motion: reduce)";
const watchReduced = (onChange: () => void) => {
  const m = window.matchMedia(REDUCED);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
};

/** Advances the story by one tick; at the end of a goal, the next goal starts. */
const tick = (c: { index: number; time: number }) => {
  const time = c.time + 0.1;
  return time >= timing(goals[c.index]).length ? { index: (c.index + 1) % goals.length, time: 0 } : { ...c, time };
};

export function TeamAtWork() {
  const [clock, setClock] = useState({ index: 0, time: 0 });
  const [playing, setPlaying] = useState(true);
  const [seen, setSeen] = useState(false);
  const still = useSyncExternalStore(watchReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const ref = useRef<HTMLElement>(null);

  const goal = goals[clock.index];
  const { allDone, summaryAt, length } = timing(goal);
  const t = still ? allDone * 0.6 : clock.time;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (still || !playing || !seen) return;
    const id = setInterval(() => {
      if (document.documentElement.dataset.motion === "off" || document.hidden) return;
      setClock(tick);
    }, 100);
    return () => clearInterval(id);
  }, [still, playing, seen]);

  const done = goal.lanes.filter((l) => t >= doneAt(l)).length;
  const shown = events(goal).filter((e) => e.at <= t).slice(-6).reverse();
  const fixes = goal.lanes.filter((l) => l.fix).length;

  return (
    <section ref={ref} id="product" className="relative scroll-mt-4 border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-3xl">
          <Label>See it work</Label>
          <SectionHeading className="mt-6">
            One goal, <span className="font-serif font-normal italic tracking-[-0.01em] text-haze">the whole team at work</span>
          </SectionHeading>
          <p className="mt-6 max-w-[56ch] text-base leading-relaxed text-haze">
            Pick an example. Nova plans it and hands out the tasks, everyone works at the same time, and every result is checked before it comes back to you.
          </p>
        </div>
        {!still && (
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            aria-pressed={!playing}
            className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-cream/20 px-3 py-1.5 text-xs font-medium text-cream/80 transition-colors hover:text-cream"
          >
            {playing ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
            {playing ? "Pause" : "Play"}
          </button>
        )}
      </div>

      {/* The examples: click one to watch it; they also play one after another. */}
      <div role="group" aria-label="Example goals" className="mt-12 flex flex-wrap gap-2">
        {goals.map((g, i) => {
          const on = i === clock.index;
          return (
            <button
              key={g.chip}
              type="button"
              onClick={() => setClock({ index: i, time: 0 })}
              aria-pressed={on}
              className={`relative inline-flex items-center gap-2 overflow-hidden rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                on ? "border-lime/60 bg-lime/10 text-cream" : "border-cream/15 text-cream/70 hover:border-cream/30 hover:text-cream"
              }`}
            >
              <span className={on ? "text-lime" : "text-haze"}>{g.icon}</span>
              {g.chip}
              {on && !still && (
                <span aria-hidden="true" className="absolute bottom-0 left-0 h-[2px] bg-lime transition-[width] duration-100" style={{ width: `${Math.min(1, clock.time / length) * 100}%` }} />
              )}
            </button>
          );
        })}
      </div>

      <div key={clock.index} className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* The board: the goal, Nova, and one lane per teammate. */}
        <div className="relative overflow-hidden rounded-[24px] border border-cream/10 bg-cream/[0.02] bg-[radial-gradient(rgb(238_244_240/0.06)_1px,transparent_1px)] [background-size:22px_22px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream/10 px-5 py-4 md:px-6">
            <div>
              <p className="text-xs text-haze">Goal</p>
              <p className="step-in mt-0.5 font-display text-lg font-medium tracking-[-0.02em]">{goal.text}</p>
            </div>
            <div className="flex items-center gap-3 text-sm text-haze">
              <span className="tabular-nums">
                {done} of {goal.lanes.length} tasks done
              </span>
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-cream/10">
                <span className="block h-full rounded-full bg-lime transition-[width] duration-500" style={{ width: `${(done / goal.lanes.length) * 100}%` }} />
              </span>
            </div>
          </div>

          {/* Nova leads: the line runs from her down through every teammate. */}
          <div className="relative px-5 py-4 md:px-6">
            <div aria-hidden="true" className="absolute bottom-0 left-[44px] top-12 w-px bg-cream/15 md:left-[48px]" />
            <div className="relative flex items-center gap-3">
              <span className={`relative grid size-12 shrink-0 place-items-center rounded-full bg-deep ring-2 ${t < allDone ? "breathe ring-lime" : "ring-teal"}`}>
                <Image src="/companions/nova.svg" alt="" width={40} height={40} className="size-9" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Nova <span className="font-normal text-haze">· Head agent</span>
                </p>
                <p key={novaState(goal, t)} className="step-in text-sm text-lime md:truncate">
                  {novaState(goal, t)}
                </p>
              </div>
            </div>

            <ul className="mt-3 space-y-2">
              {/* Shorter goals get invisible rows, so the board keeps one height and the page never jumps. */}
              {[...goal.lanes, ...LONGEST.slice(goal.lanes.length)].map((l, i) => {
                const ghost = i >= goal.lanes.length;
                const s = laneState(l, t);
                const p = people[l.who];
                const active = s.kind === "working" || s.kind === "fixing" || s.kind === "checking";
                const assigned = t >= l.start && t < l.start + 0.8;
                const returned = t >= doneAt(l) && t < doneAt(l) + 0.8;
                return (
                  <li
                    key={ghost ? `ghost-${i}` : l.who}
                    aria-hidden={ghost || undefined}
                    style={{ "--i": i } as React.CSSProperties}
                    className={`${ghost ? "invisible" : "step-in"} relative grid items-center gap-x-4 gap-y-2 rounded-[14px] py-3 pl-[52px] pr-3 transition-colors duration-500 md:grid-cols-[160px_1fr_190px_116px] md:pl-[60px] ${active ? "bg-cream/[0.04]" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* The avatar sits on the line from Nova: a lime pulse when the task arrives, a teal one when it is checked. */}
                      <span
                        className={`absolute left-[8px] grid size-9 place-items-center rounded-full bg-deep ring-2 transition-colors md:left-[12px] ${
                          s.kind === "done" ? "ring-teal" : active ? "ring-lime" : "ring-cream/10"
                        } ${assigned ? "pulse-lime" : returned ? "pulse-teal" : ""}`}
                      >
                        <Image src={`/companions/${l.who}.svg`} alt="" width={32} height={32} className="size-7" />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-haze">{p.role}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className={`truncate text-sm ${s.kind === "idle" || s.kind === "waiting" ? "text-haze" : "text-cream/90"}`}>
                        {s.kind === "fixing" ? l.fix!.note : l.task}
                      </p>
                      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-cream/10">
                        <span
                          className={`block h-full rounded-full transition-[width] duration-100 ${s.kind === "fixing" ? "bar-live bg-[#ffb86b]" : s.kind === "done" ? "bg-teal" : "bar-live bg-lime"}`}
                          style={{ width: `${Math.min(1, s.progress) * 100}%` }}
                        />
                      </span>
                    </div>
                    {/* Status and file each keep their own column, so rows never change height as work finishes. */}
                    <div className="flex items-center gap-2 md:contents">
                      <span className="md:flex md:justify-end">
                        <span key={s.kind} className={`step-in inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs ${tone[s.kind]}`}>
                          {s.kind === "done" && <Check size={11} weight="bold" className="text-teal" />}
                          {s.label}
                        </span>
                      </span>
                      <span className="md:flex md:justify-end">
                        {s.kind === "done" && (
                          <span className="step-in inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] bg-cream/10 px-2 py-1 font-mono text-[11px] text-cream/85">
                            <FileText size={11} /> {l.output}
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* The finale: the board softly blurs and the summary that comes back to you takes the stage. */}
          <div
            aria-hidden={t < summaryAt}
            className={`pointer-events-none absolute inset-0 grid place-items-center bg-night/55 p-6 backdrop-blur-[3px] transition-opacity duration-700 ${t >= summaryAt ? "opacity-100" : "opacity-0"}`}
          >
            <div className={`flex items-center gap-4 rounded-[20px] border border-lime/40 bg-deep/95 px-6 py-5 shadow-[0_30px_80px_-30px_rgb(166_255_0/0.5)] transition-transform duration-700 ${t >= summaryAt ? "scale-100" : "scale-95"}`}>
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-lime text-night">
                <SealCheck size={24} weight="fill" />
              </span>
              <div>
                <p className="font-display text-xl font-medium tracking-[-0.02em]">{goal.ready}</p>
                <p className="mt-0.5 text-sm text-haze">
                  {goal.lanes.length} tasks · {fixes ? `${fixes} fix · ` : ""}checked by Nova
                </p>
              </div>
            </div>
          </div>
          <Corners />
        </div>

        {/* The live feed of what just happened. */}
        <div className="rounded-[24px] border border-cream/10 bg-cream/[0.02] p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="size-2 rounded-full bg-lime" aria-hidden="true" />
            Team activity
          </p>
          <ol className="mt-4 space-y-3">
            {shown.map((e) => (
              <li key={`${e.at}-${e.text}`} className="step-in flex gap-3 text-sm">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-deep">
                  {e.who === "you" ? (
                    <span className="text-[10px] font-semibold text-cream">You</span>
                  ) : (
                    <Image src={`/companions/${e.who}.svg`} alt="" width={24} height={24} className="size-5" />
                  )}
                </span>
                <span className="text-cream/85">{e.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <p className="mt-6 text-sm text-haze">Examples of how a goal moves through your team. Your own goals, teams and files will differ.</p>
    </section>
  );
}
