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
    <section className="relative border-b border-line bg-paper">
      <div className="px-4 py-20 md:px-12 md:py-28 md:pl-[25%]">
        <Label>Use cases</Label>
        <SectionHeading className="mt-5">What you can hand over</SectionHeading>
      </div>
      <ul className="border-t border-line">
        {cases.map((c, i) => {
          const isOpen = open === i;
          return (
            <li key={c.title} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                aria-controls={`case-${i}`}
                className="grid w-full grid-cols-[1fr_auto] items-start gap-4 px-4 py-8 text-left md:grid-cols-[25%_1fr_auto] md:px-12"
              >
                <span className="hidden pt-1 text-xs font-medium uppercase tracking-wide text-muted md:block">{c.teams}</span>
                <span className="text-xl font-medium md:text-2xl">{c.title}</span>
                <span className="grid size-8 place-items-center rounded-[6px] bg-ink text-lime">
                  {isOpen ? <Minus size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
                </span>
              </button>
              <div id={`case-${i}`} hidden={!isOpen} className="grid gap-6 px-4 pb-10 md:grid-cols-[25%_1fr_auto] md:px-12">
                <span className="text-xs font-medium uppercase tracking-wide text-muted md:hidden">{c.teams}</span>
                <p className="max-w-[52ch] text-muted md:col-start-2">{c.text}</p>
                <div className="relative aspect-[4/3] w-full overflow-hidden md:col-start-3 md:row-start-1 md:w-[300px] md:-translate-y-16">
                  <Image src={c.image} alt="" fill sizes="(min-width: 768px) 300px, 100vw" className="object-cover" />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
