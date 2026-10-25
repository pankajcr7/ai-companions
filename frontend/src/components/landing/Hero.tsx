import Image from "next/image";
import { Corners, DarkButton } from "./ui";

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

const display = "font-display font-medium uppercase leading-[0.9] tracking-[-0.04em] text-[clamp(64px,10vw,152px)]";

/** The dusk hero: it sits over the pillar field (see page.tsx), with the robot floating above it. */
export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100svh-112px)] items-end px-4 pb-14 pt-32 md:px-12 md:pb-20">
      {/* A soft dark floor so the headline reads over the field. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-[#1b0c18]/90 via-[#1b0c18]/40 to-transparent" />
      <Image
        src="/companions/nova.svg"
        alt=""
        width={180}
        height={180}
        priority
        className="float pointer-events-none absolute right-[5%] top-[12%] h-auto w-[clamp(140px,24vw,340px)] drop-shadow-[0_40px_60px_rgb(166_255_0/0.28)]"
      />
      <div className="relative max-w-[920px]">
        <h1 className={`rise text-[#fff4ea] ${display}`}>
          Hire an
          <br />
          AI team
        </h1>
        <p className="rise mt-7 max-w-[44ch] text-base leading-relaxed text-white/85 md:text-lg" style={{ "--i": 1 } as React.CSSProperties}>
          Give one goal. Your AI companions plan it, debate it, review it, and deliver real work you can see.
        </p>
        <div className="rise mt-8 flex flex-wrap items-center gap-4" style={{ "--i": 2 } as React.CSSProperties}>
          <DarkButton href="#early-access">Get early access</DarkButton>
          <a
            href="#process"
            className="inline-flex h-12 items-center rounded-[12px] border border-white/35 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}

export function Models() {
  return (
    <section aria-label="Bring your own models" className="relative grid grid-cols-2 border-b border-line bg-paper sm:grid-cols-4 lg:grid-cols-[200px_repeat(8,1fr)]">
      <p className="col-span-full flex items-center border-b border-line px-4 py-6 text-xs font-medium uppercase leading-relaxed tracking-wide text-ink md:px-12 lg:col-span-1 lg:border-b-0 lg:border-r lg:px-8">
        {"// Bring your own"}
        <br className="hidden lg:block" /> models
      </p>
      {models.map((m) => (
        <div key={m.file} className="flex h-28 items-center justify-center border-b border-r border-line lg:border-b-0">
          <Image src={`/logos/${m.file}.svg`} alt={m.name} width={44} height={44} className="h-10 w-auto opacity-80" />
        </div>
      ))}
      <Corners />
    </section>
  );
}
