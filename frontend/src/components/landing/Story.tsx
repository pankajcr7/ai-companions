import { TeamChart } from "./TeamChart";
import { Corners, Glow, Label, SectionHeading } from "./ui";

const facts = [
  { value: "1 goal", text: "is all it takes to put your team to work" },
  { value: "6 departments", text: "from product to marketing, ready to staff, and you can add your own" },
  { value: "0 fake progress bars", text: "every status comes from real, recorded work" },
];

export function Story() {
  return (
    <section id="about" className="relative isolate grid scroll-mt-4 items-center gap-14 overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32 lg:grid-cols-[1.15fr_0.85fr]">
      <Glow className="-left-60 -top-60" />
      <div>
        <Label>Why we built this</Label>
        <SectionHeading className="reveal mt-6">
          A chatbot answers questions. <span className="font-serif font-normal italic tracking-[-0.01em] text-haze">A company gets work done.</span>
        </SectionHeading>
        <p className="mt-6 max-w-[46ch] text-base leading-relaxed text-haze">
          Separate companions with real roles. Nova leads them, hands out the work, and checks it before it reaches you.
        </p>
        <dl className="mt-12 border-t border-cream/10">
          {facts.map(({ value, text }) => (
            <div key={value} className="reveal border-b border-cream/10 py-5">
              <dt className="font-display text-[clamp(24px,2.4vw,34px)] font-medium leading-[1.05] tracking-[-0.03em]">{value}</dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-haze">{text}</dd>
            </div>
          ))}
        </dl>
      </div>

      <figure className="reveal relative rounded-[24px] border border-cream/10 bg-cream/[0.02] bg-[radial-gradient(rgb(238_244_240/0.07)_1px,transparent_1px)] p-5 [background-size:22px_22px] md:p-8">
        <TeamChart />
        <figcaption className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-haze">
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" /> The goal goes down
          </span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-teal" aria-hidden="true" /> Checked work comes back
          </span>
        </figcaption>
        <Corners />
      </figure>
    </section>
  );
}
