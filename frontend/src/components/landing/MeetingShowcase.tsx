"use client";

import Image from "next/image";
import { useState } from "react";
import { CaretLeft, CaretRight, Gavel } from "@phosphor-icons/react";

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
    <section aria-label="Example meetings" className="relative grid border-b border-cream/10 md:min-h-[600px] md:grid-cols-[1fr_460px]">
      <div className="duotone relative min-h-[320px]">
        <Image src="/img/meeting.jpg" alt="A person working on a laptop" fill sizes="(min-width: 768px) 60vw, 100vw" className="object-cover" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-night/80 to-transparent" />
        <p className="absolute bottom-8 left-4 max-w-md font-display text-[clamp(28px,3vw,44px)] font-medium leading-[1.05] tracking-[-0.03em] md:left-12">
          How your team decides
        </p>
      </div>
      <div className="flex flex-col justify-end border-cream/10 bg-gradient-to-b from-deep to-night md:border-l">
        <div className="p-7" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-haze">Example meeting</p>
          <p className="mt-4 font-display text-xl font-medium leading-snug tracking-[-0.02em]">{m.question}</p>
          <ul className="mt-6 space-y-2.5 text-sm text-cream/80">
            {m.proposals.map((p) => (
              <li key={p} className="flex gap-3">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-teal" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-7 rounded-[14px] border border-lime/40 bg-lime/10 p-4">
            <p className="flex items-center gap-2 text-xs font-medium text-lime">
              <Gavel size={14} /> Decided by {m.by}
            </p>
            <p className="mt-1.5 text-sm">{m.decision}</p>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] border-t border-cream/10">
          <p className="px-7 py-5 text-sm text-haze">
            {i + 1} of {meetings.length}
          </p>
          <button type="button" onClick={() => go(-1)} aria-label="Previous meeting" className="grid w-20 place-items-center border-l border-cream/10 hover:bg-cream/10">
            <CaretLeft size={22} />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next meeting" className="grid w-20 place-items-center border-l border-cream/10 hover:bg-cream/10">
            <CaretRight size={22} />
          </button>
        </div>
      </div>
    </section>
  );
}
