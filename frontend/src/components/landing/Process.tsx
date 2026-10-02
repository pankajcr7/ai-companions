import { Asterisk, CheckCircle, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";
import { Corners, DarkButton, Hatch, Label, SectionHeading } from "./ui";

function Box({ children, dark = false, className = "" }: { children?: React.ReactNode; dark?: boolean; className?: string }) {
  return (
    <span className={`grid h-11 place-items-center rounded-[4px] px-3 text-xs font-medium ${dark ? "bg-ink text-lime" : "bg-bg text-ink"} ${className}`}>
      {children}
    </span>
  );
}

const steps = [
  {
    title: "Tell",
    text: "Type one goal in plain words. Your head agent asks only what it really needs to know.",
    art: (
      <div className="flex w-full max-w-sm items-center gap-3 rounded-full border border-line bg-paper py-2 pl-5 pr-2 shadow-sm">
        <span className="flex-1 truncate text-sm">Launch a 7-day campaign for our cafe</span>
        <span className="grid size-9 place-items-center rounded-full bg-ink text-lime">
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
        <Box dark>Nova, head agent</Box>
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
        <Box dark className="col-span-2">
          Decision: B, with the opening shot from A
        </Box>
      </div>
    ),
  },
  {
    title: "Deliver",
    text: "Finished work with the evidence behind it. Anything public waits for your approval.",
    art: (
      <div className="w-full max-w-sm rounded-[10px] border border-line bg-paper p-4 text-left shadow-sm">
        <p className="text-sm font-medium">Publish 7 posts to Instagram?</p>
        <p className="mt-1 text-xs text-muted">Requested by the content lead. Version 3, reviewed by QA.</p>
        <div className="mt-3 flex gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-[6px] bg-ink px-3 py-1.5 text-xs text-paper">
            <CheckCircle size={13} className="text-lime" /> Approve
          </span>
          <span className="rounded-[6px] border border-line px-3 py-1.5 text-xs">Request changes</span>
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
      <section id="process" className="relative grid scroll-mt-4 gap-12 border-b border-line bg-paper px-4 py-20 md:grid-cols-2 md:px-12 md:py-28">
        <div className="md:sticky md:top-10 md:self-start">
          <Label>Process</Label>
          <SectionHeading className="mt-5">From one sentence to finished work</SectionHeading>
          <p className="mt-6 max-w-[40ch] text-muted">Every step leaves a record you can open: who did what, why, and with which result.</p>
          <div className="mt-8">
            <DarkButton href="#early-access">Get early access</DarkButton>
          </div>
        </div>
        <ol className="space-y-5">
          {steps.map((s, i) => (
            <li key={s.title} className="reveal card-lift rounded-[14px] bg-bg p-3">
              <div className="grid min-h-[220px] place-items-center rounded-[10px] bg-paper p-6">{s.art}</div>
              <div className="flex gap-5 px-3 pb-3 pt-5">
                <span className="pt-0.5 text-sm text-muted">{`//0${i + 1}`}</span>
                <div>
                  <h3 className="text-xl font-semibold">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.text}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <Corners />
      </section>
      <Hatch />

      <section aria-hidden="true" className="overflow-hidden border-b border-line">
        {words.map((row, r) => (
          <div key={r} className={`flex w-max ${r === 0 ? "marquee-left border-b border-line" : "marquee-right"}`}>
            {[...row, ...row, ...row, ...row].map((w, i) => (
              <span key={i} className="flex items-center gap-8 px-8 py-5 font-display text-[clamp(56px,7vw,104px)] font-medium uppercase leading-none tracking-[-0.04em]">
                {w}
                <Asterisk size={40} weight="bold" className="text-ink/40" />
              </span>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}
