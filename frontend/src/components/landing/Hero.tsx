import Image from "next/image";
import { RobotModel } from "./RobotModel";
import { Corners, DarkButton, Label, LineButton } from "./ui";

const models = [
  { file: "openai", name: "OpenAI" },
  { file: "anthropic", name: "Anthropic" },
  { file: "googlegemini", name: "Google Gemini" },
  { file: "openrouter", name: "OpenRouter" },
  { file: "deepseek", name: "DeepSeek" },
  { file: "xai", name: "xAI" },
  { file: "ollama", name: "Ollama" },
  { file: "github", name: "GitHub" },
];

// What the team does with a goal, as thin-line tags pointing at the robot.
const tags = [
  { label: "Plans it", at: "left-0 top-[22%]", side: "left" },
  { label: "Debates it", at: "right-0 top-[30%]", side: "right" },
  { label: "Reviews it", at: "left-0 top-[58%]", side: "left" },
  { label: "Delivers it", at: "right-0 top-[66%]", side: "right" },
] as const;

const facts = ["1 goal to start", "9 departments to staff", "Your own AI models"];

/** The dusk hero: headline on the left, the 3D robot on the right, over the team network (see page.tsx). */
export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100svh-112px)] flex-col">
      {/* A soft dark floor so the words read over the field. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-night via-night/50 to-transparent" />

      <div className="relative grid flex-1 items-center gap-6 px-4 pb-10 pt-10 md:grid-cols-[1.1fr_0.9fr] md:px-12 md:pt-6">
        <div className="rise relative z-20">
          <Label>AI companions that work as a team</Label>
          <h1 className="mt-6 font-wide text-[clamp(52px,7vw,118px)] font-semibold uppercase leading-[0.9] tracking-[-0.05em] text-cream">
            Hire an
            <br />
            <span className="bg-gradient-to-r from-[#7fd8ca] via-[#b8e05a] to-lime bg-clip-text pb-[0.08em] text-transparent">AI team</span>
          </h1>
          <p className="mt-7 max-w-[42ch] text-base leading-relaxed text-cream/85 md:text-lg">
            Give one goal. Your AI companions plan it, debate it, review it, and deliver real work you can see.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <DarkButton href="#early-access">Get early access</DarkButton>
            <LineButton href="#process">See how it works</LineButton>
          </div>
        </div>

        <div className="rise relative mx-auto aspect-[4/5] w-full max-w-[300px] md:max-w-[520px]" style={{ "--i": 1 } as React.CSSProperties}>
          <div aria-hidden="true" className="absolute inset-x-[20%] bottom-[6%] h-1/4 rounded-full bg-lime/20 blur-3xl" />
          <RobotModel className="absolute inset-0" />
          {tags.map((t) => (
            <span
              key={t.label}
              aria-hidden="true"
              className={`pointer-events-none absolute hidden items-center gap-2 sm:flex ${t.at} ${t.side === "right" ? "flex-row-reverse" : ""}`}
            >
              <span className="rounded-full border border-cream/20 bg-night/60 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-cream backdrop-blur-sm">
                {t.label}
              </span>
              <span className="h-px w-10 bg-cream/40 lg:w-16" />
              <span className="size-1.5 rounded-full bg-lime" />
            </span>
          ))}
        </div>
      </div>

      <ul className="relative z-20 grid border-t border-cream/15 text-xs font-medium uppercase tracking-[0.16em] text-cream/80 sm:grid-cols-3">
        {facts.map((f) => (
          <li key={f} className="flex items-center gap-3 border-b border-cream/15 px-4 py-4 sm:border-b-0 sm:border-r sm:last:border-r-0 md:px-12">
            <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" />
            {f}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Models() {
  return (
    <section aria-label="Bring your own models" className="relative grid grid-cols-2 border-b border-cream/10 sm:grid-cols-4 lg:grid-cols-[200px_repeat(8,1fr)]">
      <p className="col-span-full flex items-center border-b border-cream/10 px-4 py-6 text-xs font-medium uppercase leading-relaxed tracking-wide text-haze md:px-12 lg:col-span-1 lg:border-b-0 lg:border-r lg:px-8">
        {"// Bring your own"}
        <br className="hidden lg:block" /> models
      </p>
      {models.map((m) => (
        <div key={m.file} className="flex h-28 items-center justify-center border-b border-r border-cream/10 lg:border-b-0">
          <Image src={`/logos/${m.file}.svg`} alt={m.name} width={44} height={44} className="h-9 w-auto opacity-70 invert" />
        </div>
      ))}
      <Corners />
    </section>
  );
}
