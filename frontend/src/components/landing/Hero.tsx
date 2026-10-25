import Image from "next/image";
import { ClipboardText, SealCheck, ShieldCheck, UsersThree } from "@phosphor-icons/react/dist/ssr";
import { MotionToggle } from "./MotionToggle";
import { RobotModel } from "./RobotModel";
import { Corners, PrimaryButton, Label, LineButton } from "./ui";

const models = [
  { file: "openai", name: "OpenAI" },
  { file: "anthropic", name: "Anthropic" },
  { file: "googlegemini", name: "Google Gemini" },
  { file: "openrouter", name: "OpenRouter" },
  { file: "deepseek", name: "DeepSeek" },
  { file: "xai", name: "xAI" },
  { file: "ollama", name: "Ollama" },
  { file: "github", name: "GitHub Models" },
];

// A goal's journey as status chips riding an orbit around the robot: brief, team, review, your approval.
const chips = [
  { label: "Brief written", icon: <ClipboardText size={13} weight="bold" /> },
  { label: "Team assigned", icon: <UsersThree size={13} weight="bold" /> },
  { label: "Checked by Nova", icon: <ShieldCheck size={13} weight="bold" /> },
  { label: "Ready for your OK", icon: <SealCheck size={13} weight="bold" /> },
];

/** Staggered arrival on load: rises and sharpens from a blur, in order (see .step-in). */
const at = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** The dusk hero: headline on the left, the 3D robot on the right, over the team network (see page.tsx). */
export function Hero() {
  return (
    <section className="relative flex min-h-[calc(100svh-76px)] flex-col">
      {/* A soft dark floor so the words read over the field. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-night via-night/50 to-transparent" />

      <div className="relative grid flex-1 items-center gap-6 px-4 pb-10 pt-10 md:grid-cols-[1.1fr_0.9fr] md:px-12 md:pt-6">
        <div className="relative z-20">
          <span style={at(0)} className="step-in block">
            <Label>AI companions that work as a team</Label>
          </span>
          {/* Word by word; "AI team" shimmers through the brand gradient and a lime line draws under it. */}
          <h1 className="mt-6 font-display text-[clamp(56px,7.6vw,128px)] font-medium leading-[0.92] tracking-[-0.05em] text-cream">
            <span style={at(1)} className="lift inline-block">Hire</span>{" "}
            <span style={at(2)} className="lift inline-block">an</span>
            <br />
            <span style={at(4)} className="lift relative inline-block font-serif text-[1.12em] font-normal italic tracking-[-0.02em]">
              <span className="shimmer bg-[linear-gradient(90deg,#7fd8ca,#b8e05a,#a6ff00,#b8e05a,#7fd8ca)] bg-clip-text pb-[0.08em] pr-[0.15em] text-transparent">AI team</span>
              <span aria-hidden="true" className="draw absolute bottom-[0.06em] left-[0.04em] h-[3px] w-[calc(100%-0.25em)] rounded-full bg-lime shadow-[0_0_12px_rgb(166_255_0/0.8)]" />
            </span>
          </h1>
          <p style={at(6)} className="step-in mt-7 max-w-[42ch] text-base leading-relaxed text-cream/85 md:text-lg">
            Give one goal. Your AI companions plan it, build it, check it, and deliver real work you can see.
          </p>
          <div style={at(7)} className="step-in mt-8 flex flex-wrap items-center gap-3">
            <PrimaryButton href="/sign-up">Create your team</PrimaryButton>
            <LineButton href="#product">See it work</LineButton>
          </div>
        </div>

        <div className="rise relative mx-auto aspect-[4/5] w-full max-w-[300px] md:max-w-[520px]" style={{ "--i": 1 } as React.CSSProperties}>
          <div aria-hidden="true" className="absolute inset-x-[20%] bottom-[6%] h-1/4 rounded-full bg-lime/20 blur-3xl" />
          <RobotModel className="absolute inset-0" chips={chips} />
        </div>
      </div>

      {/* One control for every moving thing on the page (WCAG 2.2.2). */}
      <div className="relative z-20 flex justify-end px-4 pb-6 md:px-12">
        <MotionToggle />
      </div>
    </section>
  );
}

export function Models() {
  return (
    <section aria-label="Bring your own models" className="relative border-b border-cream/10">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-[220px_repeat(8,1fr)]">
        <p className="col-span-full flex flex-col justify-center gap-1 border-b border-cream/10 px-4 py-6 md:px-12 lg:col-span-1 lg:border-b-0 lg:border-r lg:px-8">
          <span className="text-sm font-medium text-cream">Bring your own AI</span>
          <span className="text-xs leading-relaxed text-haze">These, any OpenAI-compatible service, or your ChatGPT plan.</span>
        </p>
        {models.map((m) => (
          <div key={m.file} className="flex h-28 flex-col items-center justify-center gap-2.5 border-b border-r border-cream/10 lg:border-b-0">
            <Image src={`/logos/${m.file}.svg`} alt="" width={44} height={44} className="h-8 w-auto opacity-75 invert" />
            <span className="text-xs text-haze">{m.name}</span>
          </div>
        ))}
      </div>
      <Corners />
    </section>
  );
}
