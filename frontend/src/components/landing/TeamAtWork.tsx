"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, FileText, Pause, Play, SealCheck } from "@phosphor-icons/react";
import { Corners, Label, SectionHeading } from "./ui";

// An example goal played out the way the team works on one: Nova plans and assigns, everyone works in parallel
// (some wait for a teammate's result), Nova checks each result (once asking for a fix), and a summary comes back.
type Lane = {
  id: string;
  name: string;
  role: string;
  task: string;
  output: string;
  start: number; // seconds into the loop
  end: number;
  waitFor?: string;
  fix?: { until: number; note: string };
};

const LOOP = 17.5;
const CHECK = 0.7; // how long Nova takes to check a result
const lanes: Lane[] = [
  { id: "tomas", name: "Tomás", role: "Scriptwriter", task: "Writing 7 launch posts", output: "posts.md", start: 2, end: 6, fix: { until: 7.6, note: "Adding a call to action" } },
  { id: "lina", name: "Lina", role: "UI designer", task: "Designing the hero and colours", output: "hero.png", start: 2.2, end: 5.2 },
  { id: "kofi", name: "Kofi", role: "Backend developer", task: "Adding the order form", output: "order.js", start: 2.4, end: 8.4 },
  { id: "sana", name: "Sana", role: "Frontend developer", task: "Building the landing page", output: "index.html", start: 5.9, end: 11, waitFor: "Lina" },
  { id: "mei", name: "Mei", role: "QA engineer", task: "Testing on phone and desktop", output: "qa-report.md", start: 11.7, end: 13.6, waitFor: "Sana" },
];
// When each lane is finally checked and done.
const doneAt = (l: Lane) => (l.fix ? l.fix.until : l.end) + CHECK;
const ALL_DONE = Math.max(...lanes.map(doneAt));
const SUMMARY_AT = ALL_DONE + 0.8;

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

function novaState(t: number) {
  if (t < 0.9) return "Reading your goal";
  if (t < 1.8) return "Writing the brief and assigning 5 tasks";
  if (t < ALL_DONE) return `Checking work as it comes in · ${lanes.filter((l) => t >= doneAt(l)).length} of 5 checked`;
  if (t < SUMMARY_AT) return "Writing your summary";
  return "All done";
}

// The activity feed: every event in the story, shown once its time has come.
const events = [
  { at: 0.1, who: "you", text: "You asked for: Launch week for Crumb Bakery" },
  { at: 1, who: "nova", text: "Nova wrote the brief" },
  { at: 1.8, who: "nova", text: "Nova assigned 5 tasks" },
  ...lanes.map((l) => ({ at: l.start, who: l.id, text: `${l.name} started: ${l.task.toLowerCase()}` })),
  ...lanes.filter((l) => l.fix).map((l) => ({ at: l.end + CHECK, who: "nova", text: `Nova asked ${l.name} for one fix` })),
  ...lanes.map((l) => ({ at: doneAt(l), who: "nova", text: `Nova checked ${l.name}'s work` })),
  { at: SUMMARY_AT, who: "nova", text: "Nova wrote your summary" },
].sort((a, b) => a.at - b.at);

// Without motion, the board shows one busy moment instead of the loop.
const REDUCED = "(prefers-reduced-motion: reduce)";
const STILL_AT = 9.2;
const watchReduced = (onChange: () => void) => {
  const m = window.matchMedia(REDUCED);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
};

const tone: Record<State["kind"], string> = {
  idle: "border-cream/10 text-haze",
  waiting: "border-cream/15 text-haze",
  working: "border-lime/50 bg-lime/10 text-lime",
  checking: "border-teal/50 bg-teal/10 text-teal",
  fixing: "border-[#ffb86b]/50 bg-[#ffb86b]/10 text-[#ffb86b]",
  done: "border-teal/40 text-cream",
};

export function TeamAtWork() {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [seen, setSeen] = useState(false);
  const still = useSyncExternalStore(watchReduced, () => window.matchMedia(REDUCED).matches, () => false);
  const t = still ? STILL_AT : time;
  const ref = useRef<HTMLElement>(null);

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
      setTime((v) => (v + 0.1) % LOOP);
    }, 100);
    return () => clearInterval(id);
  }, [still, playing, seen]);

  const done = lanes.filter((l) => t >= doneAt(l)).length;
  const shown = events.filter((e) => e.at <= t).slice(-6).reverse();

  return (
    <section ref={ref} id="product" className="relative scroll-mt-4 border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-3xl">
          <Label>See it work</Label>
          <SectionHeading className="mt-6">
            One goal, <span className="font-serif font-normal italic tracking-[-0.01em] text-haze">the whole team at work</span>
          </SectionHeading>
          <p className="mt-6 max-w-[56ch] text-base leading-relaxed text-haze">
            An example goal, played out the way your team works on one: Nova plans it and hands out the tasks, everyone works at the same time, and every result is
            checked before it comes back to you.
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

      <div className="mt-12 grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* The board: the goal, Nova, and one lane per teammate. */}
        <div className="relative overflow-hidden rounded-[24px] border border-cream/10 bg-cream/[0.02] bg-[radial-gradient(rgb(238_244_240/0.06)_1px,transparent_1px)] [background-size:22px_22px]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream/10 px-5 py-4 md:px-6">
            <div>
              <p className="text-xs text-haze">Goal</p>
              <p className="mt-0.5 font-display text-lg font-medium tracking-[-0.02em]">Launch week for Crumb Bakery</p>
            </div>
            <div className="flex items-center gap-3 text-sm text-haze">
              <span className="tabular-nums">
                {done} of {lanes.length} tasks done
              </span>
              <span className="h-1.5 w-28 overflow-hidden rounded-full bg-cream/10">
                <span className="block h-full rounded-full bg-lime transition-[width] duration-500" style={{ width: `${(done / lanes.length) * 100}%` }} />
              </span>
            </div>
          </div>

          {/* Nova leads: the bus line runs from her down to every lane. */}
          <div className="relative px-5 py-4 md:px-6">
            <div aria-hidden="true" className="absolute bottom-0 left-[44px] top-12 w-px bg-cream/15 md:left-[48px]" />
            <div className="relative flex items-center gap-3">
              <span className={`relative grid size-12 shrink-0 place-items-center rounded-full bg-deep ring-2 ${t < ALL_DONE ? "breathe ring-lime" : "ring-teal"}`}>
                <Image src="/companions/nova.svg" alt="" width={40} height={40} className="size-9" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Nova <span className="font-normal text-haze">· Head agent</span>
                </p>
                <p key={novaState(t)} className="step-in text-sm text-lime md:truncate">
                  {novaState(t)}
                </p>
              </div>
            </div>

            <ul className="mt-3 space-y-2">
              {lanes.map((l) => {
                const s = laneState(l, t);
                const active = s.kind === "working" || s.kind === "fixing" || s.kind === "checking";
                const assigned = t >= l.start && t < l.start + 0.8;
                const returned = t >= doneAt(l) && t < doneAt(l) + 0.8;
                return (
                  <li
                    key={l.id}
                    className={`relative grid items-center gap-x-4 gap-y-2 rounded-[14px] py-3 pl-[52px] pr-3 transition-colors duration-500 md:grid-cols-[160px_1fr_190px_116px] md:pl-[60px] ${active ? "bg-cream/[0.04]" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* The avatar sits on the line from Nova: a lime pulse when the task arrives, a teal one when it is checked. */}
                      <span
                        className={`absolute left-[8px] grid size-9 place-items-center rounded-full bg-deep ring-2 transition-colors md:left-[12px] ${
                          s.kind === "done" ? "ring-teal" : active ? "ring-lime" : "ring-cream/10"
                        } ${assigned ? "pulse-lime" : returned ? "pulse-teal" : ""}`}
                      >
                        <Image src={`/companions/${l.id}.svg`} alt="" width={32} height={32} className="size-7" />
                      </span>
                      <div>
                        <p className="text-sm font-medium">{l.name}</p>
                        <p className="text-xs text-haze">{l.role}</p>
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

          {/* The finale: the board softly blurs and the summary that comes back to you takes the stage, then the story replays. */}
          <div
            aria-hidden={t < SUMMARY_AT}
            className={`pointer-events-none absolute inset-0 grid place-items-center bg-night/55 p-6 backdrop-blur-[3px] transition-opacity duration-700 ${t >= SUMMARY_AT ? "opacity-100" : "opacity-0"}`}
          >
            <div className={`flex items-center gap-4 rounded-[20px] border border-lime/40 bg-deep/95 px-6 py-5 shadow-[0_30px_80px_-30px_rgb(166_255_0/0.5)] transition-transform duration-700 ${t >= SUMMARY_AT ? "scale-100" : "scale-95"}`}>
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-lime text-night">
                <SealCheck size={24} weight="fill" />
              </span>
              <div>
                <p className="font-display text-xl font-medium tracking-[-0.02em]">Your work is ready</p>
                <p className="mt-0.5 text-sm text-haze">5 tasks · 1 fix · 5 files · checked by Nova</p>
              </div>
            </div>
          </div>
          <Corners />
        </div>

        {/* The live feed of what just happened. */}
        <div className="rounded-[24px] border border-cream/10 bg-cream/[0.02] p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="relative flex size-2">
              <span className="absolute inset-0 rounded-full bg-lime" />
            </span>
            Team activity
          </p>
          <ol className="mt-4 space-y-3" aria-live="off">
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
      <p className="mt-6 text-sm text-haze">An example goal. Your own goals, teams and files will differ.</p>
    </section>
  );
}
