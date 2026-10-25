import Image from "next/image";
import { HandPalm, Key, Plus, Receipt, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { EarlyAccessForm } from "./EarlyAccessForm";
import { Corners, Glow, Label, SectionHeading } from "./ui";

const controls = [
  { icon: Receipt, title: "A quote first", text: "See the estimated cost and time for a goal before anything runs." },
  { icon: SealCheck, title: "Your approval", text: "Publishing, spending, and deploys wait in your inbox until you say yes." },
  { icon: Key, title: "Your own keys", text: "Connect OpenAI, Anthropic, or Google, and mix models across your team." },
  { icon: HandPalm, title: "One stop button", text: "Pause every companion at once. Anything already done is reported honestly." },
];

const faqs = [
  {
    q: "Is this one AI pretending to be a team?",
    a: "No. Each companion is a separate agent with its own model, instructions, and memory. Their conversations are real messages saved to your project.",
  },
  {
    q: "Do the companions just look busy?",
    a: "No. A companion only moves or changes status when real work happens: a task, a review, or a meeting.",
  },
  {
    q: "Can it work on a project I already have?",
    a: "Yes. Upload a folder or ZIP, or connect GitHub. The team works on a separate branch, and nothing is merged without you.",
  },
  {
    q: "Can I use my ChatGPT or Claude subscription?",
    a: "Chat subscriptions are not API keys, so we connect through official API keys. Where a provider offers an approved way to use a subscription, we will support it and explain what it covers.",
  },
  {
    q: "What will it cost?",
    a: "Pricing is not final yet. Early access members hear first, and you will always see the estimated cost of a goal before work starts.",
  },
];

// The closing scene's pillars step down to the robot in the middle, like the field in the hero.
const pillars = Array.from({ length: 28 }, (_, i) => {
  const d = Math.abs(i - 13.5) / 13.5;
  return { height: Math.round(14 + 86 * d ** 1.4), lit: d < 0.15 };
});

export function Closing() {
  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-cream/10">
        <Glow className="-right-60 -top-60" />
        <div className="px-4 py-24 md:px-12 md:py-32">
          <Label>Control</Label>
          <SectionHeading className="mt-6">
            Your team works for you.
            <br /> <span className="text-haze">You stay the owner.</span>
          </SectionHeading>
        </div>
        <div className="grid border-t border-cream/10 sm:grid-cols-2 lg:grid-cols-4">
          {controls.map(({ icon: Icon, title, text }) => (
            <div key={title} className="border-b border-cream/10 p-6 py-10 sm:[&:nth-child(odd)]:border-r md:px-12 lg:border-b-0 lg:border-r lg:last:border-r-0">
              <span className="grid size-12 place-items-center rounded-full border border-teal/50 text-teal">
                <Icon size={22} />
              </span>
              <h3 className="mt-10 font-wide text-lg font-medium tracking-[-0.02em]">{title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-haze">{text}</p>
            </div>
          ))}
        </div>
        <Corners />
      </section>

      <section id="faq" className="relative isolate scroll-mt-4 overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
        <Glow className="-left-72 top-1/3 bg-teal/15" />
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Label>FAQ</Label>
            <SectionHeading className="mt-6">Questions</SectionHeading>
          </div>
          <div className="space-y-3">
            {faqs.map(({ q, a }) => (
              <details key={q} className="group rounded-[16px] border border-cream/10 bg-cream/[0.03] open:border-cream/20">
                <summary className="flex cursor-pointer items-center justify-between gap-4 px-6 py-5 font-medium">
                  {q}
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-cream/20 transition group-open:rotate-45 group-open:border-lime group-open:bg-lime group-open:text-night">
                    <Plus size={13} weight="bold" />
                  </span>
                </summary>
                <p className="px-6 pb-6 text-sm leading-relaxed text-haze">{a}</p>
              </details>
            ))}
          </div>
        </div>
        <Corners />
      </section>

      <section className="dusk relative overflow-hidden pt-24 md:pt-32">
        <p className="relative z-10 px-4 text-center font-wide text-[clamp(40px,7.4vw,112px)] font-semibold uppercase leading-[0.95] tracking-[-0.05em] text-cream">
          Start your
          <br /> AI company
        </p>
        <div className="relative mt-12 h-[320px]">
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-full items-end gap-[3px] px-[3px]">
            {pillars.map((p, i) => (
              <span
                key={i}
                className={`flex-1 rounded-t-[6px] border-t-[3px] bg-gradient-to-b from-teal/70 to-night ${p.lit ? "border-lime" : "border-[#a9e3d8]"}`}
                style={{ height: `${p.height}%` }}
              />
            ))}
          </div>
          <span className="float absolute bottom-[15%] left-1/2 -ml-14 grid size-28 place-items-center">
            <Image src="/companions/nova.svg" alt="" width={112} height={112} className="drop-shadow-[0_20px_40px_rgb(166_255_0/0.35)]" />
          </span>
          <span className="absolute bottom-6 left-4 rounded-full bg-night/70 px-3 py-1.5 md:left-12">
            <Label>Real work</Label>
          </span>
          <span className="absolute bottom-6 right-4 rounded-full bg-night/70 px-3 py-1.5 md:right-12">
            <Label>Real records</Label>
          </span>
        </div>
      </section>

      <section id="early-access" className="relative isolate grid scroll-mt-4 overflow-hidden border-b border-cream/10 md:grid-cols-[1fr_460px]">
        <Glow className="-left-40 bottom-0 bg-lime/10" />
        <div className="flex flex-col justify-center gap-6 px-4 py-20 md:px-12">
          <Label>Early access</Label>
          <p className="max-w-xl font-wide text-3xl font-medium leading-[1.1] tracking-[-0.03em] md:text-5xl">Tell us what you would hand over first.</p>
          <p className="max-w-[46ch] text-haze">We are opening in small groups and inviting people whose first goal we can deliver well.</p>
        </div>
        <div className="border-t border-cream/10 bg-cream/[0.02] px-4 py-14 md:border-l md:border-t-0 md:px-10">
          <EarlyAccessForm />
        </div>
      </section>
    </>
  );
}

// The brand name across the footer, in the hero's two colours.
const footerWord = "block bg-clip-text pb-[0.16em] font-wide font-semibold lowercase leading-[0.85] tracking-[-0.06em] text-transparent text-[clamp(56px,13vw,200px)]";

export function Footer() {
  return (
    <footer className="relative">
      <nav aria-label="Footer" className="grid grid-cols-2 border-b border-cream/10 text-base font-medium md:grid-cols-4">
        {[
          ["#about", "About"],
          ["#departments", "Departments"],
          ["#team", "Team"],
          ["#faq", "FAQ"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="border-b border-r border-cream/10 px-4 py-8 text-center uppercase tracking-[0.12em] text-cream/80 hover:bg-cream/5 hover:text-cream md:border-b-0 md:last:border-r-0">
            {label}
          </a>
        ))}
      </nav>
      <div aria-hidden="true" className="relative overflow-hidden border-b border-cream/10 px-4 py-16 md:px-12 md:py-24">
        <span className={`${footerWord} bg-gradient-to-br from-[#7fd8ca] to-[#2f8f86]`}>agent</span>
        <span className={`${footerWord} text-right bg-gradient-to-br from-[#f4f1c6] to-[#b8e05a]`}>company</span>
      </div>
      <div className="flex flex-col justify-between gap-2 px-4 py-6 text-sm text-haze sm:flex-row md:px-12">
        <p>© {new Date().getFullYear()} Agent Company</p>
        <p>Photos from Unsplash. Robot avatars by DiceBear.</p>
      </div>
    </footer>
  );
}
