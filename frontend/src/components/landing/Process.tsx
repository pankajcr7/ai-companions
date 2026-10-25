import { Asterisk, CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Corners, DarkButton, Glow, Label, SectionHeading } from "./ui";

function Box({ children, lit = false, className = "" }: { children?: React.ReactNode; lit?: boolean; className?: string }) {
  return (
    <span className={`grid h-11 place-items-center rounded-[8px] px-3 text-xs font-medium ${lit ? "bg-lime text-night" : "border border-cream/10 bg-cream/5 text-cream"} ${className}`}>
      {children}
    </span>
  );
}

const steps = [
  {
    title: "Tell",
    text: "Type one goal in plain words. Your head agent asks only what it really needs to know.",
    art: (
      <div className="flex w-full max-w-sm items-center gap-3 rounded-full border border-cream/15 bg-night py-2 pl-5 pr-2">
        <span className="flex-1 truncate text-sm">Launch a 7-day campaign for our cafe</span>
        <span className="grid size-9 place-items-center rounded-full bg-lime text-night">
          <PaperPlaneTilt size={15} weight="fill" />
        </span>
      </div>
    ),
  },
  {
    title: "Plan",
    text: "A brief with deliverables and acceptance criteria, a team, and tasks routed through managers.",
    art: (
      <div className="grid w-full max-w-sm grid-cols-3 gap-2">
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
      <div className="grid w-full max-w-sm grid-cols-2 gap-2">
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
      <div className="w-full max-w-sm rounded-[12px] border border-cream/10 bg-night p-4 text-left">
        <p className="text-sm font-medium">Publish 7 posts to Instagram?</p>
        <p className="mt-1 text-xs text-haze">Requested by the content lead. Version 3, reviewed by QA.</p>
        <div className="mt-3 flex gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-lime px-3 py-1.5 text-xs font-medium text-night">
            <CheckCircle size={13} /> Approve
          </span>
          <span className="rounded-[6px] border border-cream/20 px-3 py-1.5 text-xs">Request changes</span>
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
  return (
    <>
      <section id="process" className="relative isolate grid scroll-mt-4 gap-14 overflow-hidden border-b border-cream/10 px-4 py-24 md:grid-cols-[0.9fr_1.1fr] md:px-12 md:py-32">
        <Glow className="-left-72 bottom-0" />
        <div className="md:sticky md:top-10 md:self-start">
          <Label>Process</Label>
          <SectionHeading className="mt-6">From one sentence to finished work</SectionHeading>
          <p className="mt-6 max-w-[40ch] text-haze">Every step leaves a record you can open: who did what, why, and with which result.</p>
          <div className="mt-9">
            <DarkButton href="#early-access">Get early access</DarkButton>
          </div>
        </div>
        {/* A timeline: numbered nodes on one thin line, a card beside each. */}
        <ol className="relative space-y-6 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-px before:bg-cream/15">
          {steps.map((s, i) => (
            <li key={s.title} className="reveal relative grid grid-cols-[40px_1fr] gap-5">
              <span className="relative z-10 grid size-10 place-items-center rounded-full border border-teal/50 bg-night font-wide text-xs text-teal">0{i + 1}</span>
              <div className="overflow-hidden rounded-[20px] border border-cream/10 bg-cream/[0.03]">
                <div className="grid min-h-[200px] place-items-center bg-[radial-gradient(80%_100%_at_50%_0%,rgb(216_105_78/0.18),transparent)] p-6">{s.art}</div>
                <div className="border-t border-cream/10 px-6 py-5">
                  <h3 className="font-wide text-lg font-medium tracking-[-0.02em]">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-haze">{s.text}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <Corners />
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
