import type { Appearance } from "@/lib/types";

const INK = "#0b0d10";
const GLOW = "#a6ff00";
const EDGE = "rgb(11 13 16 / 0.2)";
const TOP = { square: -22, round: -24, tall: -26 } as const;

function Eyes({ eyes }: { eyes: Appearance["eyes"] }) {
  if (eyes === "visor") return <rect x={-11} y={-4} width={22} height={4} rx={2} fill={GLOW} />;
  if (eyes === "wide") {
    return (
      <g>
        <circle cx={-7} cy={-2} r={4.5} fill="#fff" />
        <circle cx={7} cy={-2} r={4.5} fill="#fff" />
        <circle cx={-6} cy={-2} r={2} fill={INK} />
        <circle cx={8} cy={-2} r={2} fill={INK} />
      </g>
    );
  }
  return (
    <g>
      <circle cx={-7} cy={-2} r={2.6} fill={GLOW} />
      <circle cx={7} cy={-2} r={2.6} fill={GLOW} />
    </g>
  );
}

function Accessory({ kind, top }: { kind: Appearance["accessory"]; top: number }) {
  if (kind === "antenna") {
    return (
      <g>
        <line x1={0} y1={top} x2={0} y2={top - 9} stroke={INK} strokeWidth={2} />
        <circle cy={top - 12} r={3.5} fill={GLOW} stroke={INK} strokeWidth={1.5} />
      </g>
    );
  }
  if (kind === "headset") {
    return (
      <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round">
        <path d={`M -25 -2 A 25 25 0 0 1 25 -2`} />
        <rect x={-29} y={-8} width={6} height={13} rx={2} fill={INK} />
        <rect x={23} y={-8} width={6} height={13} rx={2} fill={INK} />
        <path d="M -26 5 Q -24 15 -11 15" strokeWidth={2} />
      </g>
    );
  }
  if (kind === "cap") {
    return (
      <g fill={INK}>
        <path d={`M -20 ${top + 7} Q 0 ${top - 13} 20 ${top + 7} Z`} />
        <rect x={0} y={top + 3} width={28} height={5} rx={2} />
      </g>
    );
  }
  return null;
}

/** Original companion character, drawn around (0, 0) in roughly a 64-unit box. Pure SVG. */
export function CompanionFigure({ look }: { look: Appearance }) {
  const shape = { fill: look.color, stroke: EDGE, strokeWidth: 1.5 };
  if (look.style === "orb") {
    return (
      <g>
        <circle r={24} {...shape} />
        <rect x={-16} y={-9} width={32} height={14} rx={7} fill={INK} />
        <Eyes eyes={look.eyes} />
      </g>
    );
  }
  return (
    <g>
      <rect x={-13} y={18} width={26} height={12} rx={5} {...shape} />
      {look.head === "round" ? (
        <circle r={24} {...shape} />
      ) : look.head === "tall" ? (
        <rect x={-20} y={-26} width={40} height={46} rx={14} {...shape} />
      ) : (
        <rect x={-24} y={-22} width={48} height={40} rx={10} {...shape} />
      )}
      <rect x={-16} y={-9} width={32} height={14} rx={7} fill={INK} />
      <Eyes eyes={look.eyes} />
      <Accessory kind={look.accessory} top={TOP[look.head]} />
    </g>
  );
}

export function CompanionAvatar({ look, size = 64, label }: { look: Appearance; size?: number; label?: string }) {
  return (
    <svg viewBox="-36 -42 72 78" width={size} height={size} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <CompanionFigure look={look} />
    </svg>
  );
}
