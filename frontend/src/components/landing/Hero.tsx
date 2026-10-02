import Image from "next/image";
import { Corners, DarkButton, LightButton, Pixels } from "./ui";

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

const display = "font-display font-medium uppercase leading-none tracking-[-0.04em] text-[clamp(56px,8vw,120px)]";

export function Hero() {
  return (
    <>
      <section className="grid-paper relative overflow-hidden border-b border-line pb-16 pt-24 md:pb-24 md:pt-32">
        <Pixels className="left-0 top-0 hidden md:block" blocks={[[0, 0, 1, 1], [1.5, 0, 2, 1], [1.5, 1, 1, 1], [0, 2, 1, 1]]} />
        <Pixels className="bottom-0 right-0 hidden h-[248px] w-[310px] md:block" blocks={[[3.5, 0, 1.5, 1.5], [2, 1.5, 1.5, 1.5], [0, 3, 3, 1], [3.5, 3, 1.5, 1]]} />

        <h1 className="relative mx-auto flex max-w-[1240px] flex-col items-center gap-6 px-4 md:flex-row md:justify-between md:gap-4">
          <span className={`rise bg-gradient-to-b from-ink/70 to-ink bg-clip-text text-transparent ${display}`}>Hire an</span>
          <span
            className="rise relative grid size-44 shrink-0 place-items-center rounded-[28px] border border-line bg-paper shadow-[0_30px_60px_-30px_rgb(11_13_16/0.35)] md:size-60"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            <Image src="/companions/nova.svg" alt="" width={180} height={180} priority className="size-32 md:size-44" />
            <Corners />
          </span>
          <span className={`rise bg-gradient-to-b from-ink/70 to-ink bg-clip-text text-transparent ${display}`} style={{ "--i": 2 } as React.CSSProperties}>
            AI team
          </span>
        </h1>

        <div className="rise relative mt-12 flex flex-col items-center px-4 text-center" style={{ "--i": 3 } as React.CSSProperties}>
          <p className="max-w-[44ch] text-base leading-relaxed text-ink md:text-lg">
            Give one goal. Your AI companions plan it, debate it, review it, and deliver real work you can see.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <LightButton href="#process">See how it works</LightButton>
            <DarkButton href="#early-access">Get early access</DarkButton>
          </div>
        </div>
      </section>

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
    </>
  );
}
