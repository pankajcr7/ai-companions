import Image from "next/image";
import { RobotModel } from "./RobotModel";
import { Corners, DarkButton, LineButton } from "./ui";

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

// The brand name, split around the robot: "ag" top left, "ent" bottom right.
const wordmark = "pointer-events-none select-none pb-[0.16em] font-wide font-semibold lowercase leading-[0.8] tracking-[-0.06em] text-[clamp(104px,20vw,300px)] bg-clip-text text-transparent";

/** The dusk hero: it sits over the pillar field (see page.tsx), with the robot floating between the two halves of the name. */
export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100svh-112px)] flex-col px-4 pb-10 pt-6 md:block md:px-12 md:pb-14">
      {/* A soft dark floor so the words read over the field. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-night via-night/50 to-transparent" />

      <p aria-hidden="true" className={`rise relative bg-gradient-to-br from-[#7fd8ca] to-[#2f8f86] ${wordmark}`}>
        ag
      </p>

      <div className="relative z-10 mx-auto -mt-6 aspect-[3/4] w-[clamp(210px,27vw,400px)] md:absolute md:left-1/2 md:top-[2%] md:mt-0 md:-translate-x-1/2">
        <div aria-hidden="true" className="absolute inset-x-[15%] bottom-[8%] h-1/3 rounded-full bg-lime/20 blur-3xl" />
        <RobotModel className="absolute inset-0" />
      </div>

      <p
        aria-hidden="true"
        className={`rise relative -mt-6 self-end bg-gradient-to-br from-[#f4f1c6] to-[#b8e05a] md:absolute md:bottom-10 md:right-12 md:mt-0 ${wordmark}`}
        style={{ "--i": 1 } as React.CSSProperties}
      >
        ent
      </p>

      <div className="rise relative z-20 mt-6 md:absolute md:bottom-14 md:left-12 md:mt-0 md:max-w-[42%]" style={{ "--i": 2 } as React.CSSProperties}>
        <p className="max-w-[38ch] text-sm leading-relaxed text-cream/85 md:text-base">
          Give one goal. Your AI companions plan it, debate it, review it, and deliver real work you can see.
        </p>
        <h1 className="mt-5 font-wide text-[clamp(32px,3.8vw,58px)] font-medium uppercase leading-[0.95] tracking-[-0.03em] text-cream">
          Hire an
          <br />
          AI team
        </h1>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <DarkButton href="#early-access">Get early access</DarkButton>
          <LineButton href="#process">See how it works</LineButton>
        </div>
      </div>
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
