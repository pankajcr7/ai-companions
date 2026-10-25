import Image from "next/image";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { Corners, Label, SectionHeading } from "./ui";

const team = [
  { file: "nova", name: "Nova", role: "Head agent" },
  { file: "rhea", name: "Rhea", role: "Engineering manager" },
  { file: "sana", name: "Sana", role: "Frontend developer" },
  { file: "kofi", name: "Kofi", role: "Backend developer" },
  { file: "mei", name: "Mei", role: "QA engineer" },
  { file: "lina", name: "Lina", role: "UI designer" },
  { file: "tomas", name: "Tomás", role: "Scriptwriter" },
];

// The departments the ready-made teams come with; owners can add their own.
const departments = ["Leadership", "Product", "Engineering", "Design", "Content", "Marketing"];

export function Team() {
  return (
    <section id="team" className="relative scroll-mt-4 border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
      <Label>Your companions</Label>
      <SectionHeading className="mt-6">
        Meet the team <span className="font-serif font-normal italic tracking-[-0.01em] text-haze">you can hire</span>
      </SectionHeading>
      <p className="mt-6 max-w-[52ch] text-base leading-relaxed text-haze">
        Every companion keeps its name, look and chat history, even when you switch the AI model behind it.
      </p>

      <ul className="mt-14 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
        {team.map((m, i) => (
          <li key={m.file} className={`reveal relative overflow-hidden rounded-[20px] border border-cream/10 bg-gradient-to-b from-deep to-night ${i % 2 ? "lg:mt-12" : ""}`}>
            <div className="relative grid aspect-square place-items-center">
              {/* The companion stands on a lit pedestal. */}
              <span aria-hidden="true" className="absolute bottom-[14%] h-[22%] w-[38%] rounded-t-[10px] bg-gradient-to-b from-teal/50 to-transparent" />
              <Image src={`/companions/${m.file}.svg`} alt="" width={200} height={200} className="relative w-[58%] -translate-y-[8%]" />
            </div>
            <div className="border-t border-cream/10 px-4 py-4">
              <p className="font-display text-base font-medium tracking-[-0.02em]">{m.name}</p>
              <p className="mt-1 text-sm text-haze">{m.role}</p>
            </div>
          </li>
        ))}
        <li className="relative flex flex-col justify-between rounded-[20px] bg-lime p-6 text-night lg:mt-12">
          <div>
            <Plus size={22} weight="bold" aria-hidden="true" />
            <p className="mt-5 font-display text-xl font-medium leading-tight tracking-[-0.03em]">Design your own companion</p>
            <p className="mt-3 text-[15px] text-night/75">Pick a name, look, role, working style and AI model.</p>
          </div>
          <a href="/sign-up" className="mt-6 inline-flex items-center justify-center rounded-[10px] bg-night py-2.5 text-sm font-semibold text-cream hover:bg-night/85">
            Create your team
          </a>
        </li>
      </ul>

      <div className="mt-14 flex flex-col gap-4 border-t border-cream/10 pt-8 md:flex-row md:items-center">
        <p className="shrink-0 text-sm font-medium text-cream">Departments</p>
        <ul className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <li key={d} className="rounded-full border border-cream/15 px-3.5 py-1.5 text-sm text-cream/85">
              {d}
            </li>
          ))}
          <li className="rounded-full border border-dashed border-cream/25 px-3.5 py-1.5 text-sm text-haze">+ your own</li>
        </ul>
      </div>
      <Corners />
    </section>
  );
}
