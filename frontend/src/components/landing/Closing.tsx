import Image from "next/image";
import { HandPalm, Key, Plus, Receipt, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { EarlyAccessForm } from "./EarlyAccessForm";
import { Corners, Hatch, Label, Logo, Pixels, SectionHeading } from "./ui";

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

export function Closing() {
  return (
    <>
      <section className="relative border-b border-line">
        <Pixels className="right-0 top-0 hidden h-[372px] w-[434px] md:block" color="bg-paper" blocks={[[0, 0, 4, 2], [4, 0, 3, 2], [3, 2, 2, 2], [5, 4, 2, 2]]} />
        <div className="relative px-4 py-20 md:px-12 md:py-28">
          <Label>Control</Label>
          <SectionHeading className="mt-5">
            Your team works for you.
            <br /> You stay the owner.
          </SectionHeading>
        </div>
        <div className="relative grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
          {controls.map(({ icon: Icon, title, text }) => (
            <div key={title} className="border-b border-line p-6 py-10 sm:[&:nth-child(odd)]:border-r md:px-12 lg:border-b-0 lg:border-r lg:last:border-r-0">
              <span className="btn-dark grid size-12 place-items-center rounded-[10px] text-lime">
                <Icon size={22} />
              </span>
              <h3 className="mt-10 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
            </div>
          ))}
        </div>
        <Corners />
      </section>
      <Hatch />

      <section id="faq" className="grid-paper relative scroll-mt-4 border-b border-line bg-paper px-4 py-20 md:py-28">
        <div className="text-center">
          <Label>FAQ</Label>
          <SectionHeading className="mt-5">Questions</SectionHeading>
        </div>
        <div className="mx-auto mt-12 max-w-3xl space-y-4">
          {faqs.map(({ q, a }) => (
            <details key={q} className="group card-lift rounded-[12px] bg-bg">
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-6 py-5 font-medium">
                {q}
                <span className="grid size-7 shrink-0 place-items-center rounded-[6px] bg-ink text-lime transition-transform group-open:rotate-45">
                  <Plus size={13} weight="bold" />
                </span>
              </summary>
              <p className="px-6 pb-6 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
        <Corners />
      </section>
      <Hatch />

      <section className="grid-paper relative overflow-hidden pt-24 md:pt-32">
        <p className="relative z-10 bg-gradient-to-b from-ink/70 to-ink bg-clip-text px-4 text-center font-display text-[clamp(48px,8.4vw,128px)] font-medium uppercase leading-[0.95] tracking-[-0.04em] text-transparent">
          Start your
          <br /> AI company
        </p>
        <div className="relative mt-10 h-[300px]">
          {/* Lime staircase, stepping down to the centre. */}
          <div aria-hidden="true" className="absolute inset-0 grid grid-cols-6 items-end">
            {[100, 66, 33, 16, 66, 100].map((h, i) => (
              <span key={i} className="bg-lime" style={{ height: `${h}%` }} />
            ))}
          </div>
          <span className="absolute left-1/2 top-4 grid size-24 -translate-x-1/2 place-items-center rounded-full bg-paper shadow-xl">
            <Image src="/companions/nova.svg" alt="" width={64} height={64} />
          </span>
          <span className="absolute bottom-6 left-4 md:left-12">
            <Label dark>Real work</Label>
          </span>
          <span className="absolute bottom-6 right-4 md:right-12">
            <Label dark>Real records</Label>
          </span>
        </div>
      </section>

      <section id="early-access" className="relative grid scroll-mt-4 bg-[#05070c] text-paper md:grid-cols-[1fr_440px]">
        <div className="flex flex-col justify-center gap-6 px-4 py-16 md:px-12">
          <Label dark>Early access</Label>
          <p className="max-w-xl text-3xl font-semibold leading-tight md:text-5xl">Tell us what you would hand over first.</p>
          <p className="max-w-[46ch] text-paper/70">We are opening in small groups and inviting people whose first goal we can deliver well.</p>
        </div>
        <div className="border-t border-paper/15 px-4 py-14 md:border-l md:border-t-0 md:px-10">
          <EarlyAccessForm />
        </div>
      </section>

    </>
  );
}

export function Footer() {
  return (
    <footer className="relative bg-bg">
        <nav aria-label="Footer" className="grid grid-cols-2 border-b border-line text-lg font-medium md:grid-cols-4">
          {[
            ["#about", "About"],
            ["#departments", "Departments"],
            ["#team", "Team"],
            ["#faq", "FAQ"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="border-b border-r border-line px-4 py-8 text-center hover:bg-paper md:border-b-0 md:last:border-r-0">
              {label}
            </a>
          ))}
        </nav>
        <div className="relative grid place-items-center overflow-hidden border-b border-line py-20 md:py-32">
          <Pixels className="left-0 top-0 h-[186px] w-[186px]" color="bg-paper" blocks={[[0, 0, 1, 1], [1.3, 0, 1.7, 1], [1, 1, 1, 1], [0, 2, 1, 1]]} />
          <Logo className="text-[clamp(40px,10vw,150px)]" />
        </div>
        <div className="flex flex-col justify-between gap-2 px-4 py-6 text-sm text-muted sm:flex-row md:px-12">
          <p>© {new Date().getFullYear()} Agent Company</p>
          <p>Photos from Unsplash. Robot avatars by DiceBear.</p>
        </div>
      </footer>
  );
}
