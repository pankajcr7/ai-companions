import Image from "next/image";
import { Corners, Label, SectionHeading } from "./ui";

/** A real screen in a simple frame: a label on top, the screenshot below. */
function Screen({ src, alt, label, className = "", sizes }: { src: string; alt: string; label: string; className?: string; sizes: string }) {
  return (
    <figure className={`overflow-hidden rounded-[18px] border border-cream/15 bg-deep shadow-[0_40px_80px_-40px_rgb(0_0_0/0.8)] ${className}`}>
      <figcaption className="flex items-center gap-2 border-b border-cream/10 px-4 py-2.5 text-xs text-haze">
        <span className="size-1.5 rounded-full bg-teal" aria-hidden="true" />
        {label}
      </figcaption>
      <Image src={src} alt={alt} width={2560} height={1600} sizes={sizes} className="h-auto w-full" />
    </figure>
  );
}

/** Proof that the product exists: real screens from the app, captured with a sample company (see e2e/capture-product.spec.ts). */
export function Showcase() {
  return (
    <section id="product" className="relative scroll-mt-4 border-b border-cream/10 px-4 py-24 md:px-12 md:py-32">
      <div className="max-w-3xl">
        <Label>See it work</Label>
        <SectionHeading className="mt-6">
          Real screens, <span className="font-serif font-normal italic tracking-[-0.01em] text-haze">not mockups</span>
        </SectionHeading>
        <p className="mt-6 max-w-[56ch] text-base leading-relaxed text-haze">
          A bakery asks Nova for launch posts. The team plans the work, writes it, Nova checks it and asks for a fix, and the finished posts come back
          with a summary. Next door, the same team at their desks.
        </p>
      </div>

      <div className="relative mt-14 lg:pb-40">
        <Screen
          src="/product/chat.png"
          alt="The Agent Company chat: the owner asks Nova for launch posts, and the finished goal shows Done, Checked by Nova with one fix made, and Nova's summary."
          label="Chat with Nova · a finished goal"
          sizes="(min-width: 1024px) 72vw, 100vw"
          className="lg:w-[72%]"
        />
        <Screen
          src="/product/team.png"
          alt="The Team page: an office where Nova, Sana, Lina, Tomás and Priya sit at their desks, each ready to help."
          label="Your team · the office"
          sizes="(min-width: 1024px) 44vw, 100vw"
          className="mt-6 lg:absolute lg:bottom-0 lg:right-0 lg:mt-0 lg:w-[44%]"
        />
      </div>
      <p className="mt-8 text-sm text-haze">Real screens from the app, with a sample company. The AI in this demo is a stand-in, so the words are examples.</p>
      <Corners />
    </section>
  );
}
