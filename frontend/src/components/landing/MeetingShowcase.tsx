"use client";

import Image from "next/image";
import { useState } from "react";
import { CaretLeft, CaretRight, Gavel } from "@phosphor-icons/react";
import { Pixels } from "./ui";

const meetings = [
  {
    question: "Pricing page: render on the server or the client?",
    proposals: ["Sana: server, for a faster first paint and better SEO", "Kofi: client, because prices change every hour"],
    decision: "Server render with hourly revalidation",
    by: "Rhea, Engineering manager",
  },
  {
    question: "Which opening for the cafe launch video?",
    proposals: ["Tomás: a slow pour behind the bar", "Ari: a regular telling their story"],
    decision: "The regular's story, opened with the pour shot",
    by: "Ines, Content lead",
  },
  {
    question: "Signup form: one step or three?",
    proposals: ["Lina: one step, fewer drop-offs", "Jun: three steps, better data quality"],
    decision: "One step now, profile questions after signup",
    by: "Maya, Design manager",
  },
];

export function MeetingShowcase() {
  const [i, setI] = useState(0);
  const m = meetings[i];
  const go = (d: number) => setI((i + d + meetings.length) % meetings.length);

  return (
    <section aria-label="Example meetings" className="relative grid border-b border-line bg-dark md:min-h-[560px] md:grid-cols-[1fr_440px]">
      <div className="relative min-h-[300px]">
        <Image src="/img/meeting.jpg" alt="A person working on a laptop" fill sizes="(min-width: 768px) 60vw, 100vw" className="object-cover" />
        <Pixels className="left-0 top-0 h-[124px] w-[124px]" color="bg-bg" blocks={[[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1]]} />
      </div>
      <div className="flex flex-col justify-end bg-gradient-to-b from-[#55595f] to-dark text-paper md:self-end">
        <div className="p-7" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-paper/60">Example meeting</p>
          <p className="mt-3 text-2xl font-semibold leading-snug">{m.question}</p>
          <ul className="mt-5 space-y-2 text-sm text-paper/80">
            {m.proposals.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="mt-6 rounded-[10px] border border-lime/40 bg-lime/10 p-4">
            <p className="flex items-center gap-2 text-xs font-medium text-lime">
              <Gavel size={14} /> Decided by {m.by}
            </p>
            <p className="mt-1.5 text-sm">{m.decision}</p>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] border-t border-paper/15">
          <p className="px-7 py-5 text-sm text-paper/70">
            {i + 1} of {meetings.length}
          </p>
          <button type="button" onClick={() => go(-1)} aria-label="Previous meeting" className="grid w-20 place-items-center border-l border-paper/15 hover:bg-paper/10">
            <CaretLeft size={22} />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next meeting" className="grid w-20 place-items-center border-l border-paper/15 hover:bg-paper/10">
            <CaretRight size={22} />
          </button>
        </div>
      </div>
    </section>
  );
}
