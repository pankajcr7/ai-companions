import { List } from "@phosphor-icons/react/dist/ssr";
import { Corners, DarkButton, Logo } from "./ui";

const links = [
  { href: "#about", label: "About" },
  { href: "#departments", label: "Departments" },
  { href: "#process", label: "Process" },
  { href: "#team", label: "Team" },
  { href: "#faq", label: "FAQ" },
];

export function Header() {
  return (
    <header>
      <a href="#early-access" className="block bg-ink py-2.5 text-center text-xs font-medium uppercase tracking-wide text-paper">
        Early access is opening in small groups. <span className="text-lime">Join the waitlist</span>
      </a>
      <div className="relative flex h-[76px] items-stretch justify-between border-b border-line bg-paper">
        <a href="#top" aria-label="Agent Company home" className="relative flex items-center border-r border-line px-4 md:px-12">
          <Logo />
        </a>
        <nav aria-label="Main" className="hidden items-center gap-9 lg:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium uppercase tracking-wide text-ink/80 transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="relative flex items-center gap-2 border-l border-line px-4 md:px-8">
          <a href="/sign-in" className="hidden text-sm font-medium text-ink/80 hover:text-ink sm:block">Sign in</a>
          <div className="hidden sm:block">
            <DarkButton href="#early-access" icon={false}>
              Get early access
            </DarkButton>
          </div>
          {/* Mobile menu: native disclosure, no JS. */}
          <details className="relative lg:hidden">
            <summary aria-label="Open menu" className="grid size-11 cursor-pointer place-items-center rounded-[10px] border border-line">
              <List size={20} />
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 top-14 z-30 w-56 rounded-[12px] border border-line bg-paper p-2 shadow-xl">
              {[...links, { href: "#early-access", label: "Get early access" }].map((l) => (
                <a key={l.href} href={l.href} className="block rounded-[8px] px-3 py-2.5 text-sm font-medium hover:bg-bg">
                  {l.label}
                </a>
              ))}
            </nav>
          </details>
        </div>
        <Corners />
      </div>
    </header>
  );
}
