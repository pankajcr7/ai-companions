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

export function Label({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-[2px] px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide ${dark ? "bg-ink text-paper" : "bg-paper text-ink"}`}
    >
      <span className="size-2.5 bg-lime" aria-hidden="true" />
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

export function LightButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="btn-light inline-flex h-12 items-center rounded-[12px] px-5 text-sm font-semibold text-ink transition-transform hover:-translate-y-px active:translate-y-px"
    >
      {children}
    </a>
  );
}

/** Small black squares on the corners of a framed block, like blueprint registration marks. */
export function Corners() {
  const base = "pointer-events-none absolute size-1.5 bg-ink";
  return (
    <span aria-hidden="true">
      <span className={`${base} -left-[3px] -top-[3px]`} />
      <span className={`${base} -right-[3px] -top-[3px]`} />
      <span className={`${base} -bottom-[3px] -left-[3px]`} />
      <span className={`${base} -bottom-[3px] -right-[3px]`} />
    </span>
  );
}

export function Hatch() {
  return <div aria-hidden="true" className="hatch relative h-12 border-b border-line"><Corners /></div>;
}

/** Lime pixel blocks. Each block is [col, row, width, height] on a 62px grid. */
export function Pixels({ blocks, className = "", color = "bg-lime" }: { blocks: number[][]; className?: string; color?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute ${className}`}>
      {blocks.map(([c, r, w, h], i) => (
        <span
          key={i}
          className={`absolute ${color}`}
          style={{ left: c * 62, top: r * 62, width: w * 62, height: h * 62 }}
        />
      ))}
    </div>
  );
}

export function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={`font-sans text-4xl font-semibold leading-[1.08] tracking-tight text-ink md:text-6xl ${className}`}>{children}</h2>
  );
}
