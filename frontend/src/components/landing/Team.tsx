import Image from "next/image";
import { Check } from "@phosphor-icons/react/dist/ssr";
import { Corners, DarkButton, Hatch, Label, Logo, SectionHeading } from "./ui";

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
      <section className="relative border-b border-line bg-paper px-4 py-20 text-center md:py-28">
        <Label>The difference</Label>
        <SectionHeading className="mt-5">Why a team beats a chatbot</SectionHeading>
        <div className="mx-auto mt-14 grid max-w-3xl gap-5 text-left md:grid-cols-2">
          <div className="card-lift rounded-[14px] bg-bg p-3">
            <p className="rounded-[10px] bg-paper px-5 py-6 text-2xl font-semibold">
              One <span className="text-muted">chatbot</span>
            </p>
            <ul className="space-y-3 px-5 py-6 text-sm text-muted">
              {compare.them.map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-line">
                    <Check size={11} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="card-lift rounded-[14px] bg-bg p-3">
            <p className="flex items-center rounded-[10px] bg-paper px-5 py-6">
              <Logo />
            </p>
            <ul className="space-y-3 px-5 py-6 text-sm">
              {compare.us.map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ink text-lime">
                    <Check size={11} weight="bold" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-12">
          <DarkButton href="#early-access">Get early access</DarkButton>
        </div>
        <Corners />
      </section>
      <Hatch />

      <section id="team" className="grid-paper relative scroll-mt-4 border-b border-line bg-paper px-4 py-20 md:px-12 md:py-28">
        <div className="text-center">
          <Label>Your companions</Label>
          <SectionHeading className="mt-5">
            Meet the team
            <br /> you can hire
          </SectionHeading>
          <p className="mx-auto mt-5 max-w-[52ch] text-muted">
            Every companion keeps its name, look, and memory, even when you switch the AI model behind it.
          </p>
        </div>
        <ul className="mt-14 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
          {team.map((m, i) => (
            <li key={m.file} className={`reveal relative ${i % 2 ? "lg:mt-10" : ""}`}>
              <div className="grid aspect-square place-items-center rounded-[14px] border border-line bg-bg">
                <Image src={`/companions/${m.file}.svg`} alt="" width={200} height={200} className="w-[62%]" />
              </div>
              <div className="card-lift relative -mt-10 mx-3 rounded-[10px] bg-paper px-3 py-3 text-center">
                <p className="text-lg font-semibold">{m.name}</p>
                <p className="text-xs text-muted sm:text-sm">{m.role}</p>
              </div>
            </li>
          ))}
          <li className="btn-dark relative flex flex-col justify-between rounded-[14px] p-6 text-paper lg:mt-10">
            <div>
              <span className="block size-3 bg-lime" aria-hidden="true" />
              <p className="mt-4 text-2xl font-semibold leading-tight">Design your own companion</p>
              <p className="mt-3 text-sm text-paper/70">Pick a name, look, role, voice, and AI model.</p>
            </div>
            <a href="#early-access" className="mt-6 inline-flex items-center justify-center rounded-[10px] border border-paper/15 py-2.5 text-sm font-semibold hover:bg-paper/10">
              Get early access
            </a>
          </li>
        </ul>
        <Corners />
      </section>
      <Hatch />
    </>
  );
}
