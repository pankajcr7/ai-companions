"use client";

import { useEffect, useRef, useState } from "react";
import { Asterisk, CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react";
import { Corners, DarkButton, Glow, Label, SectionHeading } from "./ui";

function Box({ children, lit = false, className = "" }: { children?: React.ReactNode; lit?: boolean; className?: string }) {
  return (
    <span className={`grid h-12 place-items-center rounded-[10px] px-3 text-center text-xs font-medium sm:text-sm ${lit ? "bg-lime text-night" : "border border-cream/10 bg-cream/5 text-cream"} ${className}`}>
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
        <p className="ml-auto w-fit max-w-[85%] rounded-[16px] rounded-br-[4px] bg-cream/10 px-4 py-3">Launch a 7-day campaign for our cafe</p>
        <div className="max-w-[88%] rounded-[16px] rounded-bl-[4px] border border-cream/10 bg-night px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-medium text-lime">
            <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" /> Nova
          </p>
          <p className="mt-1.5 text-cream/90">Two questions first: what is the cafe called, and which days should the posts go out?</p>
        </div>
        <div className="flex items-center gap-3 rounded-full border border-cream/15 bg-night py-2 pl-5 pr-2 text-cream/50">
          <span className="flex-1 truncate">Reply to Nova</span>
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
        <Box>Content lead</Box>
        <span />
        <Box>Marketing lead</Box>
        <Box className="opacity-60">Scriptwriter</Box>
        <Box className="opacity-60">Editor</Box>
        <Box className="opacity-60">Strategist</Box>
      </div>
    ),
  },
  {
    title: "Debate and build",
    text: "Two scriptwriters pitch alternatives, the editor critiques both, and the content lead decides.",
    art: (
      <div className="grid w-full max-w-md grid-cols-2 gap-2.5">
        <Box>Script A: behind the bar</Box>
        <Box>Script B: regulars&apos; stories</Box>
        <Box lit className="col-span-2">
          Decision: B, with the opening shot from A
        </Box>
      </div>
    ),
  },
  {
    title: "Deliver",
    text: "Finished work with the evidence behind it. Anything public waits for your approval.",
    art: (
      <div className="w-full max-w-md rounded-[16px] border border-cream/10 bg-night p-5 text-left">
        <p className="font-medium">Publish 7 posts to Instagram?</p>
        <p className="mt-1.5 text-sm text-haze">Requested by the content lead. Version 3, reviewed by QA.</p>
        <div className="mt-4 flex gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-lime px-3.5 py-2 text-sm font-medium text-night">
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
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const step = steps[active];

  return (
    <>
      <section ref={ref} id="process" className="relative isolate scroll-mt-4 overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
        <Glow className="-left-72 bottom-0" />
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <Label>Process</Label>
            <SectionHeading className="mt-6 max-w-3xl">From one sentence to finished work</SectionHeading>
            <p className="mt-6 max-w-[46ch] text-haze">Every step leaves a record you can open: who did what, why, and with which result.</p>
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
                  className={`relative block w-full border-b border-cream/10 py-6 text-left transition-colors ${on ? "" : "text-cream/45 hover:text-cream/80"}`}
                >
                  <span className="flex items-baseline gap-5">
                    <span className={`w-6 font-wide text-sm ${on ? "text-lime" : ""}`}>0{i + 1}</span>
                    <span className="font-wide text-2xl font-medium tracking-[-0.03em] md:text-3xl">{s.title}</span>
                  </span>
                  {on && <span className="mt-3 block max-w-[44ch] pl-11 text-sm leading-relaxed text-haze">{s.text}</span>}
                  {on &&
                    (auto && seen ? (
                      <span
                        aria-hidden="true"
                        onAnimationEnd={() => setActive((active + 1) % steps.length)}
                        className="absolute -bottom-px left-0 h-px animate-[grow_6s_linear_forwards] bg-lime group-hover/steps:[animation-play-state:paused] motion-reduce:hidden"
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
            className="relative grid min-h-[360px] place-items-center overflow-hidden rounded-[24px] border border-cream/10 bg-cream/[0.02] bg-[radial-gradient(rgb(255_241_230/0.07)_1px,transparent_1px)] px-5 pb-8 pt-16 [background-size:22px_22px] md:min-h-[440px] md:px-10"
          >
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgb(216_105_78/0.22),transparent)]" />
            <p className="absolute left-6 top-5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-haze">
              <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" />
              Step 0{active + 1} of 04 · {step.title}
            </p>
            <div key={active} className="rise relative flex w-full justify-center">
              {step.art}
            </div>
            <Corners />
          </div>
        </div>
      </section>

      <section aria-hidden="true" className="overflow-hidden border-b border-cream/10 py-4">
        {words.map((row, r) => (
          <div key={r} className={`flex w-max ${r === 0 ? "marquee-left" : "marquee-right"}`}>
            {[...row, ...row, ...row, ...row].map((w, i) => (
              <span
                key={i}
                className={`flex items-center gap-8 px-8 py-3 font-wide text-[clamp(52px,7vw,104px)] font-semibold uppercase leading-none tracking-[-0.05em] ${(i + r) % 2 ? "outline-text" : ""}`}
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
