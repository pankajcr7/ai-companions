import Image from "next/image";
import { Buildings, Gauge, Target } from "@phosphor-icons/react/dist/ssr";
import { Corners, Hatch, Label, Pixels, SectionHeading } from "./ui";

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
      <section id="about" className="relative scroll-mt-4 border-b border-line bg-paper">
        <div className="px-4 py-20 md:px-12 md:py-28">
          <Label>Why we built this</Label>
          <SectionHeading className="reveal mt-5 max-w-3xl">A chatbot answers questions. A company gets work done.</SectionHeading>
        </div>
        <div className="relative grid border-t border-line md:grid-cols-[0.75fr_1fr]">
          <div className="md:border-r md:border-line">
            <p className="border-b border-line px-4 py-6 text-xs uppercase leading-relaxed tracking-wide text-muted md:px-12">
              Separate agents with real roles. Each one owns its work and answers to a manager.
            </p>
            {facts.map(({ icon: Icon, value, text }) => (
              <div key={value} className="flex items-center gap-5 border-b border-line px-4 py-7 last:border-b-0 md:px-12">
                <span className="btn-dark grid size-14 shrink-0 place-items-center rounded-[10px] text-lime">
                  <Icon size={24} />
                </span>
                <div>
                  <p className="font-display text-3xl font-medium tracking-tight">{value}</p>
                  <p className="mt-1 text-sm text-muted">{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="relative min-h-[320px] overflow-hidden">
            <Image src="/img/about.jpg" alt="People working together in a bright office" fill sizes="(min-width: 768px) 57vw, 100vw" className="object-cover" />
            <Pixels className="bottom-0 right-0 h-[124px] w-[186px]" color="bg-paper" blocks={[[2, 0, 1, 1], [1, 1, 1, 1], [0, 1, 1, 1]]} />
          </div>
        </div>
        <Corners />
      </section>
      <Hatch />

      <section id="departments" className="relative scroll-mt-4 border-b border-line bg-paper">
        <div className="px-4 pb-14 pt-20 text-center md:pt-28">
          <Label>Departments</Label>
          <SectionHeading className="reveal mt-5">Staff every part of the work</SectionHeading>
        </div>
        <div className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
          {departments.map((d, i) => (
            <article key={d.name} className="reveal flex min-h-[340px] flex-col justify-between gap-6 lg:min-h-[460px] border-b border-line p-6 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0">
              <Label dark>{d.name}</Label>
              <p aria-hidden="true" className="select-none text-center font-display text-[110px] lg:text-[150px] font-medium leading-none tracking-[-0.06em] text-line">
                0{i + 1}
              </p>
              <ul className="space-y-1.5 border-l-2 border-lime pl-4 text-sm">
                {d.roles.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <Corners />
      </section>
      <Hatch />

      <section className="relative border-b border-line px-4 py-24 text-center md:py-36">
        <Label>How it thinks</Label>
        <p className="reveal mx-auto mt-6 max-w-4xl text-[clamp(32px,4.6vw,64px)] font-semibold leading-[1.12] tracking-tight">
          Every goal starts{" "}
          <span className="relative inline-block h-[0.95em] w-[1.9em] translate-y-[0.12em] overflow-hidden rounded-[6px] align-baseline">
            <Image src="/img/vision.jpg" alt="" fill sizes="160px" className="object-cover" />
          </span>{" "}
          with a clear brief, a real team, and decisions you can trace
        </p>
        <p className="mx-auto mt-8 max-w-[52ch] text-muted">
          Your head agent asks what is missing before work begins. Every assumption is labeled, and every decision links
          back to the evidence behind it.
        </p>
        <Corners />
      </section>
    </>
  );
}
