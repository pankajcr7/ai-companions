import { Check, HandPalm, Key, Plus, SealCheck, Swap, X } from "@phosphor-icons/react/dist/ssr";
import { Corners, Label, LineButton, Logo, PrimaryButton, SectionHeading } from "./ui";

const compare = {
  them: [
    "One assistant does everything",
    "Answers one prompt at a time",
    "No one checks the output",
    "Forgets the project between chats",
    "You manage every step",
    "Progress you cannot inspect",
  ],
  us: [
    "Specialists with clear roles",
    "Works on a goal until it is done",
    "Nova checks every task before you see it",
    "Shared project files and a brief you can edit",
    "You approve the plan and every change to your files",
    "Every task, result and file version kept",
  ],
};

const controls = [
  { icon: SealCheck, title: "You start it", text: "Nova shows the plan and the team first. Nothing runs until you press Start." },
  { icon: Swap, title: "Changes wait for you", text: "Edits to files you already have arrive as suggestions you apply or skip." },
  { icon: Key, title: "Your own AI", text: "Connect OpenAI, Anthropic, Google or any compatible service, or sign in with ChatGPT." },
  { icon: HandPalm, title: "Stop any time", text: "Stop a goal whenever you like. Finished tasks are kept, and you can resume." },
];

const faqs = [
  {
    q: "Is this one AI pretending to be a team?",
    a: "No. Each companion has its own role, instructions and AI model, and Nova hands each of them their own task. You can open every task and see who did what.",
  },
  {
    q: "Do the companions just look busy?",
    a: "No. A companion only changes status when real work happens: a task starts, Nova checks it, or it finishes.",
  },
  {
    q: "Can it work on a project I already have?",
    a: "Yes. Upload a folder or a ZIP. The team reads it first, and changes to your files arrive as suggestions; nothing changes until you apply them.",
  },
  {
    q: "Can I use my ChatGPT subscription?",
    a: "Yes. Sign in with your ChatGPT account and your team works on your plan. For Claude, Gemini and others, add an API key.",
  },
  {
    q: "What will it cost?",
    a: "Pricing isn't final. Today your team runs on your own AI keys or ChatGPT plan, so the AI cost stays on your own account.",
  },
];

/** The chatbot comparison and the four ways you stay in control. */
export function Control() {
  return (
    <section id="control" className="relative scroll-mt-4 border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
      <Label>Control</Label>
      <SectionHeading className="mt-6">
        Your team works for you. <span className="font-serif font-normal italic tracking-[-0.01em] text-haze">You stay the owner.</span>
      </SectionHeading>

      <div className="mt-14 grid gap-5 md:grid-cols-2">
        <div className="rounded-[20px] border border-cream/10 bg-cream/[0.02] p-7">
          <p className="font-display text-2xl font-medium tracking-[-0.03em]">
            One <span className="text-haze">chatbot</span>
          </p>
          <ul className="mt-8 space-y-4 text-[15px] text-haze">
            {compare.them.map((t) => (
              <li key={t} className="flex items-center gap-3">
                {/* A cross, not a tick: these are what a chatbot lacks. */}
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-cream/10 text-cream/60">
                  <X size={10} weight="bold" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-[20px] border border-lime/35 bg-gradient-to-b from-lime/10 to-transparent p-7">
          <Logo className="!text-cream" />
          <ul className="mt-8 space-y-4 text-[15px]">
            {compare.us.map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-lime text-night">
                  <Check size={11} weight="bold" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 grid overflow-hidden rounded-[20px] border border-cream/10 sm:grid-cols-2 lg:grid-cols-4">
        {controls.map(({ icon: Icon, title, text }) => (
          <div key={title} className="border-b border-cream/10 p-7 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0">
            <span className="grid size-11 place-items-center rounded-full border border-teal/50 text-teal">
              <Icon size={20} />
            </span>
            <h3 className="mt-8 font-display text-lg font-medium tracking-[-0.02em]">{title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-haze">{text}</p>
          </div>
        ))}
      </div>
      <Corners />
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="relative scroll-mt-4 border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
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
              <p className="px-6 pb-6 text-[15px] leading-relaxed text-haze">{a}</p>
            </details>
          ))}
        </div>
      </div>
      <Corners />
    </section>
  );
}

// The closing scene's pillars step down to the middle, where the call to action sits.
const pillars = Array.from({ length: 28 }, (_, i) => {
  const d = Math.abs(i - 13.5) / 13.5;
  return { height: Math.round(14 + 86 * d ** 1.4), lit: d < 0.15 };
});

export function FinalCta() {
  return (
    <section className="dusk relative overflow-hidden pt-24 md:pt-32">
      <div className="relative z-10 px-4 text-center">
        <h2 className="font-display text-[clamp(44px,7vw,108px)] font-medium leading-[0.95] tracking-[-0.05em] text-cream">
          Start your
          <br />
          <span className="font-serif text-[1.1em] font-normal italic tracking-[-0.02em]">
            <span className="bg-[linear-gradient(90deg,#7fd8ca,#b8e05a,#a6ff00)] bg-clip-text pb-[0.08em] pr-[0.12em] text-transparent">AI company</span>
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-[44ch] text-base leading-relaxed text-cream/80 md:text-lg">
          Create your team in a minute. Bring your own AI, or sign in with ChatGPT.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <PrimaryButton href="/sign-up">Create your team</PrimaryButton>
          <LineButton href="/sign-in">Sign in</LineButton>
        </div>
      </div>
      <div aria-hidden="true" className="relative mt-14 flex h-[240px] items-end gap-[3px] px-[3px]">
        {pillars.map((p, i) => (
          <span
            key={i}
            className={`flex-1 rounded-t-[6px] border-t-[3px] bg-gradient-to-b from-teal/60 to-night ${p.lit ? "border-lime" : "border-[#a9e3d8]/70"}`}
            style={{ height: `${p.height}%` }}
          />
        ))}
      </div>
    </section>
  );
}

const footerLinks = [
  {
    title: "Product",
    links: [
      ["#product", "See it work"],
      ["#process", "How it works"],
      ["#use-cases", "Use cases"],
      ["#team", "Team"],
      ["#faq", "FAQ"],
    ],
  },
  {
    title: "Account",
    links: [
      ["/sign-up", "Create your team"],
      ["/sign-in", "Sign in"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative">
      <div className="grid gap-10 px-4 py-14 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:px-12">
        <div>
          <Logo className="!text-cream" />
          <p className="mt-4 max-w-[34ch] text-sm leading-relaxed text-haze">AI companions that plan, build and check your work, as a team.</p>
        </div>
        {footerLinks.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <p className="text-sm font-medium text-cream">{g.title}</p>
            <ul className="mt-4 space-y-2.5">
              {g.links.map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="text-sm text-haze transition-colors hover:text-cream">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="flex flex-col justify-between gap-2 border-t border-cream/10 px-4 py-6 text-sm text-haze sm:flex-row md:px-12">
        <p>© {new Date().getFullYear()} Agent Company</p>
        <p>Robot avatars by DiceBear.</p>
      </div>
    </footer>
  );
}
