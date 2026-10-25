"use client";

import Image from "next/image";
import { useState } from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import { Label, SectionHeading } from "./ui";

const cases = [
  {
    teams: "Product, design, engineering",
    title: "Build a landing page",
    text: "A product brief, two competing design proposals, a manager decision, the implementation, and a QA report.",
    image: "/img/usecase-landing.jpg",
  },
  {
    teams: "Content, social media",
    title: "Run a 7-day social campaign",
    text: "Audience research, a content calendar, two script alternatives, editorial critique, and publishing that waits for your approval.",
    image: "/img/usecase-social.jpg",
  },
  {
    teams: "Every department",
    title: "Launch a clothing brand",
    text: "Brand direction, a website brief, launch content, and a plan where every department's work depends on the others.",
    image: "/img/usecase-brand.jpg",
  },
  {
    teams: "Engineering",
    title: "Improve an app you already have",
    text: "Import a folder, ZIP, or GitHub repo. The team reads it first, makes changes on a branch, runs the tests, and hands you a diff.",
    image: "/img/usecase-existing.jpg",
  },
];

export function UseCases() {
  const [open, setOpen] = useState(0);
  return (
    <section className="relative border-b border-cream/10">
      <div className="px-4 py-24 md:px-12 md:py-32 md:pl-[25%]">
        <Label>Use cases</Label>
        <SectionHeading className="mt-6">What you can hand over</SectionHeading>
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
                className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-5 px-4 py-8 text-left md:grid-cols-[25%_1fr_auto] md:px-12"
              >
                <span aria-hidden="true" className={`font-display text-3xl font-semibold leading-none tracking-[-0.05em] md:text-5xl ${isOpen ? "text-teal" : "outline-text"}`}>
                  0{i + 1}
                </span>
                <span className="font-display text-lg font-medium tracking-[-0.03em] md:text-3xl">{c.title}</span>
                <span className={`grid size-9 place-items-center rounded-full transition-colors ${isOpen ? "bg-lime text-night" : "border border-cream/20 text-cream"}`}>
                  {isOpen ? <Minus size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
                </span>
              </button>
              <div id={`case-${i}`} hidden={!isOpen} className="grid gap-6 px-4 pb-10 md:grid-cols-[25%_1fr_auto] md:px-12">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-haze md:col-start-2">{c.teams}</p>
                <p className="max-w-[52ch] text-haze md:col-start-2">{c.text}</p>
                <div className="duotone relative aspect-[4/3] w-full overflow-hidden rounded-[16px] md:col-start-3 md:row-span-2 md:row-start-1 md:w-[320px]">
                  <Image src={c.image} alt="" fill sizes="(min-width: 768px) 320px, 100vw" className="object-cover" />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
