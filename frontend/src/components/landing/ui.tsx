import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-[0.35em] whitespace-nowrap font-display text-xl font-semibold tracking-tight text-ink ${className}`}>
      <svg viewBox="0 0 24 24" className="size-[1.35em]" aria-hidden="true">
        <rect width="24" height="24" rx="7" fill="var(--ink)" />
        <rect x="5" y="9" width="14" height="6" rx="3" fill="var(--lime)" />
        <circle cx="9.5" cy="12" r="1.3" fill="var(--ink)" />
        <circle cx="14.5" cy="12" r="1.3" fill="var(--ink)" />
      </svg>
      <span className={compact ? "hidden sm:inline" : ""}>agent company</span>
    </span>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-2.5 text-xs font-medium uppercase tracking-[0.18em] text-haze">
      <span className="size-1.5 rounded-full bg-lime" aria-hidden="true" />
      {children}
    </span>
  );
}

export function DarkButton({ href, children, icon = true }: { href: string; children: React.ReactNode; icon?: boolean }) {
  return (
    <a
      href={href}
      className="btn-dark inline-flex items-center gap-3 rounded-[12px] py-1.5 pl-1.5 pr-5 text-sm font-semibold text-paper transition-transform hover:-translate-y-px active:translate-y-px"
    >
      {icon && (
        <span className="grid size-9 place-items-center rounded-[9px] bg-lime text-ink">
          <ArrowRight size={16} weight="bold" />
        </span>
      )}
      <span className={icon ? "" : "pl-3.5"}>{children}</span>
    </a>
  );
}

/** A quiet button for dark backgrounds: a thin cream outline. */
export function LineButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-12 items-center rounded-[12px] border border-cream/30 px-5 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
    >
      {children}
    </a>
  );
}

/** Small dots on the corners of a framed block, like the nodes where thin lines meet. */
export function Corners() {
  const base = "pointer-events-none absolute size-[5px] rounded-full bg-cream/50";
  return (
    <span aria-hidden="true">
      <span className={`${base} -left-[3px] -top-[3px]`} />
      <span className={`${base} -right-[3px] -top-[3px]`} />
      <span className={`${base} -bottom-[3px] -left-[3px]`} />
      <span className={`${base} -bottom-[3px] -right-[3px]`} />
    </span>
  );
}

export function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`font-wide text-[clamp(30px,4.2vw,58px)] font-medium leading-[1.05] tracking-[-0.03em] text-cream ${className}`}>{children}</h2>
  );
}

/** A soft coral glow behind a section, from the dusk sky. */
export function Glow({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`pointer-events-none absolute -z-10 size-[560px] rounded-full bg-coral/20 blur-[120px] ${className}`} />;
}
