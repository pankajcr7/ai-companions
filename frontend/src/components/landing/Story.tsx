import Image from "next/image";
import { Buildings, Gauge, Target } from "@phosphor-icons/react/dist/ssr";
import { Corners, Glow, Label, SectionHeading } from "./ui";

const facts = [
  { icon: Target, value: "1 goal", text: "is all it takes to put your team to work" },
  { icon: Buildings, value: "9 departments", text: "from engineering to sales, ready to staff" },
  { icon: Gauge, value: "0 fake progress bars", text: "every status comes from real, recorded work" },
];

const departments = [
  { name: "Engineering", roles: ["Architect", "Frontend and backend", "QA engineer", "Security review"] },
  { name: "Design", roles: ["UI designer", "UX designer", "Brand designer", "Accessibility review"] },
  { name: "Content", roles: ["Researcher", "Scriptwriter", "Copywriter", "Editor"] },
  { name: "Marketing", roles: ["Campaign strategist", "SEO specialist", "Social media", "Email marketer"] },
];

export function Story() {
  return (
    <>
      <section id="about" className="relative isolate scroll-mt-4 overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
        <Glow className="-left-60 -top-60" />
        <Label>Why we built this</Label>
        <SectionHeading className="reveal mt-6 max-w-4xl">
          A chatbot answers questions. <span className="text-haze">A company gets work done.</span>
        </SectionHeading>
        <p className="mt-6 max-w-[48ch] text-haze">Separate agents with real roles. Each one owns its work and answers to a manager.</p>

        <div className="relative mt-16 grid gap-px overflow-hidden rounded-[20px] border border-cream/10 bg-cream/10 md:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1.4fr]">
          {facts.map(({ icon: Icon, value, text }) => (
            <div key={value} className="reveal flex flex-col justify-between gap-12 bg-night p-7 md:min-h-[300px]">
              <Icon size={26} className="text-teal" />
              <div>
                <p className="font-wide text-[clamp(26px,2.6vw,38px)] font-medium leading-[1.05] tracking-[-0.03em]">{value}</p>
                <p className="mt-3 text-sm leading-relaxed text-haze">{text}</p>
              </div>
            </div>
          ))}
          <div className="duotone relative min-h-[280px] md:col-span-3 lg:col-span-1">
            <Image src="/img/about.jpg" alt="People working together in a bright office" fill sizes="(min-width: 1024px) 34vw, 100vw" className="object-cover" />
          </div>
        </div>
        <Corners />
      </section>

      <section id="departments" className="relative isolate scroll-mt-4 overflow-hidden border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
        <Glow className="-right-72 top-20 bg-teal/15" />
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <Label>Departments</Label>
            <SectionHeading className="reveal mt-6">
              Staff every part
              <br /> of the work
            </SectionHeading>
          </div>
          <p className="max-w-[36ch] text-haze">Four of the nine departments you can staff, each with its own specialists.</p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {departments.map((d, i) => (
            <article
              key={d.name}
              className={`reveal relative flex min-h-[360px] flex-col justify-between overflow-hidden rounded-[20px] border border-cream/10 bg-gradient-to-b from-plum to-night p-6 lg:min-h-[440px] ${i % 2 ? "lg:mt-12" : ""}`}
            >
              <p className="font-wide text-sm font-medium uppercase tracking-[0.12em]">{d.name}</p>
              <p aria-hidden="true" className="outline-text select-none font-wide text-[clamp(96px,10vw,150px)] font-semibold leading-none tracking-[-0.06em]">
                0{i + 1}
              </p>
              <ul className="space-y-2 text-sm text-haze">
                {d.roles.map((r) => (
                  <li key={r} className="flex items-center gap-3">
                    <span className="size-1.5 rounded-full bg-teal" aria-hidden="true" />
                    {r}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="relative isolate overflow-hidden border-b border-cream/10 px-4 py-28 text-center md:py-40">
        <Glow className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        <Label>How it thinks</Label>
        <p className="reveal mx-auto mt-8 max-w-5xl font-wide text-[clamp(26px,3.6vw,52px)] font-medium leading-[1.18] tracking-[-0.03em]">
          Every goal starts{" "}
          <span className="duotone relative inline-block h-[0.95em] w-[1.9em] translate-y-[0.12em] overflow-hidden rounded-full align-baseline">
            <Image src="/img/vision.jpg" alt="" fill sizes="160px" className="object-cover" />
          </span>{" "}
          with a clear brief, a real team, and <span className="text-haze">decisions you can trace</span>
        </p>
        <p className="mx-auto mt-10 max-w-[52ch] text-haze">
          Your head agent asks what is missing before work begins. Every assumption is labeled, and every decision links
          back to the evidence behind it.
        </p>
        <Corners />
      </section>
    </>
  );
}
