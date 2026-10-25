"use client";

import { useState } from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import { Label, SectionHeading } from "./ui";

// Drawn previews of each kind of result (no stock photos): a web page, posts, phone screens, a file change.
const bar = (w: string, tone = "bg-cream/20") => <span className={`block h-2 rounded-full ${tone}`} style={{ width: w }} />;

function WebPreview() {
  return (
    <div className="h-full rounded-[12px] border border-cream/10 bg-night p-3">
      <div className="flex items-center gap-1.5 border-b border-cream/10 pb-2">
        {bar("22%", "bg-cream/30")}
        <span className="ml-auto flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i}>{bar("28px", "bg-cream/15")}</span>
          ))}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-[1.2fr_1fr] gap-3">
        <div className="space-y-2 pt-1">
          {bar("90%", "bg-cream/60")}
          {bar("70%", "bg-cream/60")}
          {bar("80%")}
          <span className="mt-2 block h-5 w-16 rounded-[6px] bg-lime" />
        </div>
        <span className="block h-20 rounded-[8px] bg-gradient-to-br from-teal/70 to-deep" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-10 rounded-[6px] border border-cream/10 bg-cream/5" />
        ))}
      </div>
    </div>
  );
}

function PostsPreview() {
  const tones = ["from-teal/70 to-deep", "from-lime/60 to-deep", "from-cream/40 to-deep", "from-deep to-teal/60", "from-teal/50 to-lime/40", "from-lime/40 to-teal/40"];
  return (
    <div className="grid h-full grid-cols-3 gap-2">
      {tones.map((t, i) => (
        <div key={t} className="flex flex-col overflow-hidden rounded-[10px] border border-cream/10 bg-night">
          <span className={`block flex-1 bg-gradient-to-br ${t}`} />
          <span className="p-1.5">{bar(`${60 + ((i * 13) % 30)}%`, "bg-cream/30")}</span>
        </div>
      ))}
    </div>
  );
}

function PhonesPreview() {
  return (
    <div className="flex h-full items-end justify-center gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`flex w-[30%] flex-col gap-1.5 rounded-[14px] border border-cream/15 bg-night p-2 ${i === 1 ? "h-full" : "h-[88%]"}`}>
          <span className="mx-auto mb-1 block h-1 w-6 rounded-full bg-cream/20" />
          <span className={`block h-12 rounded-[8px] bg-gradient-to-br ${i === 1 ? "from-lime/60" : "from-teal/60"} to-deep`} />
          {bar("80%", "bg-cream/40")}
          {bar("60%")}
          {bar("70%")}
          <span className="mt-auto flex justify-around border-t border-cream/10 pt-1.5">
            {[0, 1, 2].map((d) => (
              <span key={d} className={`size-1.5 rounded-full ${d === i ? "bg-lime" : "bg-cream/25"}`} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChangePreview() {
  const lines: [string, string][] = [
    [" ", "70%"],
    ["-", "55%"],
    ["+", "62%"],
    ["+", "48%"],
    [" ", "66%"],
    ["-", "40%"],
    ["+", "58%"],
  ];
  return (
    <div className="h-full rounded-[12px] border border-cream/10 bg-night p-3 font-mono text-[11px]">
      <p className="flex items-center justify-between border-b border-cream/10 pb-2 text-haze">
        <span>src/pages/menu.tsx</span>
        <span className="text-lime">+3 −2</span>
      </p>
      <div className="mt-2 space-y-1.5">
        {lines.map(([sign, w], i) => (
          <p key={i} className={`flex items-center gap-2 rounded-[4px] px-1.5 py-0.5 ${sign === "+" ? "bg-lime/10" : sign === "-" ? "bg-[#ff8a7a]/10" : ""}`}>
            <span className={`w-2 ${sign === "+" ? "text-lime" : sign === "-" ? "text-[#ff8a7a]" : "text-haze"}`}>{sign}</span>
            {bar(w, sign === " " ? "bg-cream/15" : "bg-cream/30")}
          </p>
        ))}
      </div>
    </div>
  );
}

const cases = [
  {
    teams: "Design, engineering",
    title: "Build a landing page",
    text: "A brief, the page itself as real files, a live preview, and Nova's check before it reaches you. Download it as a ZIP when you like it.",
    preview: <WebPreview />,
  },
  {
    teams: "Content, marketing",
    title: "Run a social campaign",
    text: "A content plan and ready-to-post captions, with pictures made by the team when your company has image generation set up.",
    preview: <PostsPreview />,
  },
  {
    teams: "Design",
    title: "Design a mobile app",
    text: "Every screen of your app in one matching style, shown side by side in phone frames, ready to download as code.",
    preview: <PhonesPreview />,
  },
  {
    teams: "Engineering",
    title: "Improve a project you already have",
    text: "Upload a folder or a ZIP. The team reads it first, and every change to your files arrives as a suggestion you apply or skip.",
    preview: <ChangePreview />,
  },
];

export function UseCases() {
  const [open, setOpen] = useState(0);
  return (
    <section id="use-cases" className="relative scroll-mt-4 border-b border-cream/10">
      <div className="px-4 py-24 md:px-12 md:py-32">
        <Label>Use cases</Label>
        <SectionHeading className="mt-6">What you can hand over</SectionHeading>
        <p className="mt-6 max-w-[52ch] text-base leading-relaxed text-haze">Four kinds of work you can hand to your companions. Open one to see what comes back.</p>
      </div>
      <ul className="border-t border-cream/10">
        {cases.map((c, i) => {
          const isOpen = open === i;
          return (
            <li key={c.title} className={`border-b border-cream/10 transition-colors last:border-b-0 ${isOpen ? "bg-cream/[0.03]" : ""}`}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                aria-controls={`case-${i}`}
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 px-4 py-7 text-left md:grid-cols-[25%_1fr_auto] md:px-12"
              >
                <span aria-hidden="true" className={`font-display text-3xl font-semibold leading-none tracking-[-0.05em] md:text-5xl ${isOpen ? "text-teal" : "outline-text"}`}>
                  0{i + 1}
                </span>
                <span className="font-display text-lg font-medium tracking-[-0.03em] md:text-3xl">{c.title}</span>
                <span className={`grid size-9 place-items-center rounded-full transition-colors ${isOpen ? "bg-lime text-night" : "border border-cream/20 text-cream"}`}>
                  {isOpen ? <Minus size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
                </span>
              </button>
              <div id={`case-${i}`} hidden={!isOpen} className="grid gap-6 px-4 pb-10 md:grid-cols-[25%_1fr_340px] md:px-12">
                <div className="space-y-3 md:col-start-2">
                  <p className="text-sm text-haze">{c.teams}</p>
                  <p className="max-w-[52ch] text-base leading-relaxed text-cream/85">{c.text}</p>
                </div>
                <div aria-hidden="true" className="h-[220px] md:col-start-3 md:row-start-1">
                  {c.preview}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
