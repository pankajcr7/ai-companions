"use client";

import { useEffect, useRef, useState } from "react";
import { Asterisk, CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";
import { DarkButton, Glow, Label } from "./ui";

/** Staggered arrival: rises and sharpens from a blur, in order (see .step-in). */
const at = (i: number) => ({ "--i": i }) as React.CSSProperties;

function Box({ children, lit = false, className = "", i = 0 }: { children?: React.ReactNode; lit?: boolean; className?: string; i?: number }) {
  return (
    <span
      style={at(i)}
      className={`step-in grid h-12 place-items-center rounded-[10px] px-3 text-center text-xs font-medium sm:text-sm ${lit ? "bg-lime text-night shadow-[0_0_30px_-6px_rgb(166_255_0/0.7)]" : "border border-cream/10 bg-cream/5 text-cream"} ${className}`}
    >
      {children}
    </span>
  );
}

const steps = [
  {
    title: "Tell",
    text: "Type one goal in plain words. Your head agent asks only what it really needs to know.",
    art: (
      <div className="w-full max-w-md space-y-3 text-sm">
        <p style={at(0)} className="step-in ml-auto w-fit max-w-[85%] rounded-[16px] rounded-br-[4px] bg-cream/10 px-4 py-3">
          Launch a 7-day campaign for our cafe
        </p>
        <div style={at(2)} className="step-in max-w-[88%] rounded-[16px] rounded-bl-[4px] border border-cream/10 bg-night px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-medium text-lime">
            <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" /> Nova
          </p>
          {/* Nova types for a moment, then her reply appears in the same place. */}
          <div className="relative mt-1.5">
            <span aria-hidden="true" className="typing absolute left-0 top-1.5 gap-1">
              {[0, 1, 2].map((d) => (
                <span key={d} style={at(d)} className="size-1.5 rounded-full bg-cream/70" />
              ))}
            </span>
            <p className="after-typing text-cream/90">Two questions first: what is the cafe called, and which days should the posts go out?</p>
          </div>
        </div>
        <div style={at(3)} className="step-in flex items-center gap-3 rounded-full border border-cream/15 bg-night py-2 pl-5 pr-2 text-cream/50">
          <span className="flex flex-1 items-center truncate">
            Reply to Nova<span aria-hidden="true" className="caret ml-0.5 inline-block h-4 w-px bg-lime" />
          </span>
          <span className="grid size-9 place-items-center rounded-full bg-lime text-night">
            <PaperPlaneTilt size={15} weight="fill" />
          </span>
        </div>
      </div>
    ),
  },
  {
    title: "Plan",
    text: "A brief with deliverables and acceptance criteria, a team, and tasks routed through managers.",
    art: (
      <div className="grid w-full max-w-md grid-cols-3 gap-2.5">
        <span />
        <Box lit>Nova, head agent</Box>
        <span />
        <Box i={2}>Content lead</Box>
        <span />
        <Box i={2}>Marketing lead</Box>
        <Box i={4} className="opacity-60">Scriptwriter</Box>
        <Box i={5} className="opacity-60">Editor</Box>
        <Box i={6} className="opacity-60">Strategist</Box>
      </div>
    ),
  },
  {
    title: "Debate and build",
    text: "Two scriptwriters pitch alternatives, the editor critiques both, and the content lead decides.",
    art: (
      <div className="grid w-full max-w-md grid-cols-2 gap-2.5">
        <Box>Script A: behind the bar</Box>
        <Box i={2}>Script B: regulars&apos; stories</Box>
        <Box lit i={5} className="col-span-2">
          Decision: B, with the opening shot from A
        </Box>
      </div>
    ),
  },
  {
    title: "Deliver",
    text: "Finished work with the evidence behind it. Anything public waits for your approval.",
    art: (
      <div style={at(0)} className="step-in w-full max-w-md rounded-[16px] border border-cream/10 bg-night p-5 text-left">
        <p className="font-medium">Publish 7 posts to Instagram?</p>
        <p className="mt-1.5 text-sm text-haze">Requested by the content lead. Version 3, reviewed by QA.</p>
        <div className="mt-4 flex gap-2">
          <span className="ping-twice inline-flex items-center gap-1.5 rounded-[8px] bg-lime px-3.5 py-2 text-sm font-medium text-night">
            <CheckCircle size={15} /> Approve
          </span>
          <span className="rounded-[8px] border border-cream/20 px-3.5 py-2 text-sm">Request changes</span>
        </div>
      </div>
    ),
  },
];

const words = [
  ["Plan", "Build", "Review"],
  ["Debate", "Decide", "Deliver"],
];

export function Process() {
  const [active, setActive] = useState(0);
  // Plays through the steps once the section is on screen; a click on a step stops it there.
  const [auto, setAuto] = useState(true);
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const step = steps[active];
  // Before the section is seen, the heading waits hidden so it can arrive; without motion it simply shows.
  const arrive = seen ? "step-in" : "motion-safe:opacity-0";

  // A soft spotlight follows the pointer across the screen panel.
  const spot = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <>
      <section ref={ref} id="process" className="relative isolate scroll-mt-4 overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
        <Glow className="-left-72 bottom-0" />
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <Label>Process</Label>
            <h2 className="mt-6 font-display text-[clamp(40px,5.6vw,84px)] font-medium leading-[0.98] tracking-[-0.045em] text-cream">
              <span className={`block ${arrive}`}>From one sentence</span>
              <span className={`block pb-[0.08em] font-serif text-[1.1em] font-normal italic tracking-[-0.02em] ${arrive}`} style={at(1)}>
                <span className="bg-gradient-to-r from-[#7fd8ca] via-[#b8e05a] to-lime bg-clip-text pr-[0.15em] text-transparent">to finished work</span>
              </span>
            </h2>
            <p className={`mt-6 max-w-[46ch] text-haze ${arrive}`} style={at(2)}>
              Every step leaves a record you can open: who did what, why, and with which result.
            </p>
          </div>
          <div className="shrink-0">
            <DarkButton href="#early-access">Get early access</DarkButton>
          </div>
        </div>

        {/* Hovering pauses the progress line, and with it the move to the next step. */}
        <div className="group/steps mt-14 grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:gap-10">
          <div role="tablist" aria-label="Steps" className="border-t border-cream/10">
            {steps.map((s, i) => {
              const on = i === active;
              return (
                <button
                  key={s.title}
                  type="button"
                  role="tab"
                  id={`step-${i}`}
                  aria-selected={on}
                  aria-controls="step-panel"
                  onClick={() => {
                    setActive(i);
                    setAuto(false);
                  }}
                  className={`relative block w-full border-b border-cream/10 py-6 text-left transition-[color,transform] duration-300 ${on ? "" : "text-cream/40 hover:translate-x-1.5 hover:text-cream/80"}`}
                >
                  <span className="flex items-baseline gap-5">
                    <span className={`w-6 font-display text-sm tabular-nums transition-colors ${on ? "text-lime [text-shadow:0_0_14px_rgb(166_255_0/0.8)]" : ""}`}>0{i + 1}</span>
                    <span className="font-display text-[26px] font-medium tracking-[-0.035em] md:text-[34px]">{s.title}</span>
                  </span>
                  {on && (
                    <span key={active} className="step-in mt-3 block max-w-[44ch] pl-11 text-sm leading-relaxed text-haze">
                      {s.text}
                    </span>
                  )}
                  {on &&
                    (auto && seen ? (
                      <span
                        aria-hidden="true"
                        onAnimationEnd={() => setActive((active + 1) % steps.length)}
                        className="absolute -bottom-px left-0 h-px animate-[grow_6s_linear_forwards] bg-lime shadow-[0_0_10px_rgb(166_255_0/0.9)] group-hover/steps:[animation-play-state:paused] motion-reduce:hidden"
                      />
                    ) : (
                      <span aria-hidden="true" className="absolute -bottom-px left-0 h-px w-full bg-lime" />
                    ))}
                </button>
              );
            })}
          </div>

          <div
            id="step-panel"
            role="tabpanel"
            aria-labelledby={`step-${active}`}
            onPointerMove={spot}
            className="beam relative grid min-h-[360px] place-items-center overflow-hidden rounded-[24px] bg-cream/[0.02] bg-[radial-gradient(rgb(238_244_240/0.07)_1px,transparent_1px)] px-5 pb-8 pt-16 ring-1 ring-inset ring-cream/10 [background-size:22px_22px] md:min-h-[440px] md:px-10"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgb(79_179_169/0.18),transparent)]" />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(320px_circle_at_var(--mx,50%)_var(--my,30%),rgb(79_179_169/0.16),transparent_70%)]" />
            <div className="absolute inset-x-6 top-5 flex items-center justify-between gap-4">
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-haze">
                <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" />
                Step 0{active + 1} of 04 · {step.title}
              </p>
              <span className="flex gap-1.5" aria-hidden="true">
                {steps.map((s, i) => (
                  <span key={s.title} className={`h-1 w-6 rounded-full transition-colors duration-500 ${i < active ? "bg-lime" : i === active ? "bg-lime/60" : "bg-cream/15"}`} />
                ))}
              </span>
            </div>
            {/* Drawn once the section is on screen, so each step's animation plays where it can be seen. */}
            {seen && (
              <div key={active} className="relative flex w-full justify-center">
                {step.art}
              </div>
            )}
          </div>
        </div>
      </section>

      <section aria-hidden="true" className="overflow-hidden border-b border-cream/10 py-4">
        {words.map((row, r) => (
          <div key={r} className={`flex w-max ${r === 0 ? "marquee-left" : "marquee-right"}`}>
            {[...row, ...row, ...row, ...row].map((w, i) => (
              <span
                key={i}
                className={`flex items-center gap-8 px-8 py-3 font-display text-[clamp(52px,7vw,104px)] font-semibold uppercase leading-none tracking-[-0.05em] ${(i + r) % 2 ? "outline-text" : ""}`}
              >
                {w}
                <Asterisk size={40} weight="bold" className={r ? "text-teal" : "text-lime"} />
              </span>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}
