import { List } from "@phosphor-icons/react/dist/ssr";
import { Logo, PrimaryButton } from "./ui";

const links = [
  { href: "#product", label: "See it work" },
  { href: "#process", label: "How it works" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#team", label: "Team" },
  { href: "#faq", label: "FAQ" },
];

export function Header() {
  return (
    <header>
      {/* Sits on the night sky with the hero (see page.tsx). */}
      <div className="relative flex h-[76px] items-stretch justify-between border-b border-cream/10">
        <a href="#top" aria-label="Agent Company home" className="relative flex items-center border-r border-cream/10 px-4 md:px-12">
          <Logo className="!text-cream" />
        </a>
        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-cream/75 transition-colors hover:text-cream">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="relative flex items-center gap-3 border-l border-cream/10 px-4 md:px-8">
          <a href="/sign-in" className="hidden text-sm font-medium text-cream hover:text-cream/80 sm:block">
            Sign in
          </a>
          <div className="hidden sm:block">
            <PrimaryButton href="/sign-up" icon={false}>
              Create your team
            </PrimaryButton>
          </div>
          {/* Mobile menu: native disclosure, no JS. */}
          <details className="relative lg:hidden">
            <summary aria-label="Open menu" className="grid size-11 cursor-pointer place-items-center rounded-[10px] border border-cream/30 text-cream">
              <List size={20} />
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 top-14 z-30 w-60 rounded-[14px] border border-cream/15 bg-deep p-2 text-cream shadow-2xl">
              {[...links, { href: "/sign-in", label: "Sign in" }].map((l) => (
                <a key={l.href} href={l.href} className="block rounded-[8px] px-3 py-2.5 text-sm font-medium hover:bg-cream/10">
                  {l.label}
                </a>
              ))}
              <a href="/sign-up" className="mt-1 block rounded-[8px] bg-lime px-3 py-2.5 text-center text-sm font-semibold text-night">
                Create your team
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
