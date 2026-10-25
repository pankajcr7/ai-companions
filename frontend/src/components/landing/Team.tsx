import Image from "next/image";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { Corners, DarkButton, Glow, Label, Logo, SectionHeading } from "./ui";

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
    "Specialists with clear roles and managers",
    "Works on a goal until it is delivered",
    "Peers review, managers decide, QA verifies",
    "Shared project memory you can edit",
    "You approve only what matters",
    "Every message, decision, and file on record",
  ],
};

const team = [
  { file: "nova", name: "Nova", role: "Head agent" },
  { file: "rhea", name: "Rhea", role: "Engineering manager" },
  { file: "sana", name: "Sana", role: "Frontend developer" },
  { file: "kofi", name: "Kofi", role: "Backend developer" },
  { file: "mei", name: "Mei", role: "QA engineer" },
  { file: "lina", name: "Lina", role: "UI designer" },
  { file: "tomas", name: "Tomás", role: "Scriptwriter" },
];

export function Team() {
  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
        <Glow className="-right-60 -top-40 bg-lime/10" />
        <div className="text-center">
          <Label>The difference</Label>
          <SectionHeading className="mt-6">Why a team beats a chatbot</SectionHeading>
        </div>
        <div className="mx-auto mt-16 grid max-w-4xl gap-5 md:grid-cols-2">
          <div className="rounded-[20px] border border-cream/10 bg-cream/[0.02] p-7 opacity-80">
            <p className="font-display text-2xl font-medium tracking-[-0.03em]">
              One <span className="text-haze">chatbot</span>
            </p>
            <ul className="mt-8 space-y-4 text-sm text-haze">
              {compare.them.map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-cream/10">
                    <Check size={11} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[20px] border border-lime/35 bg-gradient-to-b from-lime/10 to-transparent p-7 shadow-[0_0_90px_-30px_rgb(166_255_0/0.45)]">
            <Logo className="!text-cream" />
            <ul className="mt-8 space-y-4 text-sm">
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
        <div className="mt-12 text-center">
          <DarkButton href="#early-access">Get early access</DarkButton>
        </div>
        <Corners />
      </section>

      <section id="team" className="relative isolate scroll-mt-4 overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
        <Glow className="left-1/2 top-40 -translate-x-1/2" />
        <div className="grid gap-6 md:grid-cols-2 md:items-end">
          <div>
            <Label>Your companions</Label>
            <SectionHeading className="mt-6">
              Meet the team
              <br /> you can hire
            </SectionHeading>
          </div>
          <p className="max-w-[46ch] text-haze md:justify-self-end">
            Every companion keeps its name, look, and memory, even when you switch the AI model behind it.
          </p>
        </div>
        <ul className="mt-16 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
          {team.map((m, i) => (
            <li key={m.file} className={`reveal relative overflow-hidden rounded-[20px] border border-cream/10 bg-gradient-to-b from-deep to-night ${i % 2 ? "lg:mt-12" : ""}`}>
              <div className="relative grid aspect-square place-items-center">
                {/* The companion stands on a lit pedestal. */}
                <span aria-hidden="true" className="absolute bottom-[14%] h-[22%] w-[38%] rounded-t-[10px] bg-gradient-to-b from-teal/60 to-transparent" />
                <span aria-hidden="true" className="absolute bottom-[34%] h-6 w-[46%] rounded-[50%] bg-lime/25 blur-xl" />
                <Image src={`/companions/${m.file}.svg`} alt="" width={200} height={200} className="relative w-[58%] -translate-y-[8%]" />
              </div>
              <div className="border-t border-cream/10 px-4 py-4">
                <p className="font-display text-base font-medium tracking-[-0.02em]">{m.name}</p>
                <p className="mt-1 text-xs text-haze sm:text-sm">{m.role}</p>
              </div>
            </li>
          ))}
          <li className="relative flex flex-col justify-between rounded-[20px] bg-lime p-6 text-night lg:mt-12">
            <div>
              <span className="block size-2.5 rounded-full bg-night" aria-hidden="true" />
              <p className="mt-5 font-display text-xl font-medium leading-tight tracking-[-0.03em]">Design your own companion</p>
              <p className="mt-3 text-sm text-night/70">Pick a name, look, role, voice, and AI model.</p>
            </div>
            <a href="#early-access" className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-night py-2.5 text-sm font-semibold text-cream hover:bg-night/85">
              Get early access
            </a>
          </li>
        </ul>
        <Corners />
      </section>
    </>
  );
}
