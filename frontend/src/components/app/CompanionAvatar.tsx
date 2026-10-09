"use client";

import { useId } from "react";
import { companionSignature, shadeColor } from "@/lib/companion-look";
import type { Appearance } from "@/lib/types";

/** Sculpted SVG characters stay crisp at icon size and keep every appearance control live. */
export function CompanionFigure({ look, identity = "", working = false }: { look: Appearance; identity?: string; working?: boolean }) {
  const id = useId().replace(/:/g, "");
  const { accent, mark } = companionSignature(identity || `${look.color}-${look.head}-${look.accessory}`);
  const light = shadeColor(look.color, "#ffffff", .6);
  const mid = shadeColor(look.color, "#ffffff", .2);
  const shadow = shadeColor(look.color, "#293238", .48);
  const paint = (name: string) => `url(#${id}-${name})`;
  const round = look.head === "round";
  const tall = look.head === "tall";
  const top = tall ? -29 : -25;
  const shell = (fill: string) => round
    ? <rect x={-26} y={-25} width={52} height={47} rx={23} fill={fill} />
    : <rect x={tall ? -21 : -27} y={top} width={tall ? 42 : 54} height={tall ? 52 : 46} rx={tall ? 15 : 14} fill={fill} />;

  return (
    <g className="companion-figure" data-working={working}>
      <defs>
        <linearGradient id={`${id}-shell`} x1="15%" y1="0%" x2="85%" y2="100%"><stop stopColor={light} /><stop offset=".38" stopColor={mid} /><stop offset=".78" stopColor={look.color} /><stop offset="1" stopColor={shadow} /></linearGradient>
        <radialGradient id={`${id}-orb`} cx="28%" cy="22%" r="78%"><stop stopColor="#ffffff" /><stop offset=".25" stopColor={light} /><stop offset=".65" stopColor={look.color} /><stop offset="1" stopColor={shadow} /></radialGradient>
        <linearGradient id={`${id}-face`} x1="0%" y1="0%" x2="70%" y2="100%"><stop stopColor="#41505b" /><stop offset=".48" stopColor="#1d2831" /><stop offset="1" stopColor="#0b151d" /></linearGradient>
        <linearGradient id={`${id}-metal`} x1="0%" y1="0%" x2="100%" y2="100%"><stop stopColor="#e4e9e8" /><stop offset=".4" stopColor="#a4b1b4" /><stop offset="1" stopColor="#52616c" /></linearGradient>
        <linearGradient id={`${id}-accent`} x1="0%" y1="0%" x2="70%" y2="100%"><stop stopColor={shadeColor(accent, "#ffffff", .55)} /><stop offset=".5" stopColor={accent} /><stop offset="1" stopColor={shadeColor(accent, "#263442", .32)} /></linearGradient>
        <radialGradient id={`${id}-shadow`}><stop stopColor="#1f2c31" stopOpacity=".24" /><stop offset="1" stopColor="#1f2c31" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx={4} cy={36} rx={31} ry={8} fill={paint("shadow")} />
      {look.style === "orb" ? (
        <>
          <ellipse cx={1} cy={27} rx={16} ry={4} fill={accent} opacity=".3" />
          <path d="M-26 1Q-42 9-27 18M27 0Q42 5 30 17" fill="none" stroke={paint("metal")} strokeWidth={5} strokeLinecap="round" />
          <circle cx={3} cy={2} r={28} fill={shadow} />
          <circle r={28} fill={paint("orb")} />
          <path d="M-20-12Q-13-24 0-23" fill="none" stroke="#fff" strokeOpacity=".65" strokeWidth={2} strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x={-15} y={26} width={11} height={8} rx={4} fill={paint("metal")} /><rect x={6} y={26} width={11} height={8} rx={4} fill={paint("metal")} />
          <rect x={-15} y={14} width={33} height={16} rx={7} fill={shadow} />
          <rect x={-17} y={12} width={33} height={16} rx={7} fill={paint("shell")} />
          <rect x={-10} y={19} width={19} height={4} rx={2} fill={paint("accent")} />
          <g className="companion-arms">
            <rect x={-30} y={7} width={9} height={15} rx={4.5} transform="rotate(16 -25 14)" fill={paint("accent")} />
            <rect x={24} y={7} width={9} height={15} rx={4.5} transform="rotate(-20 28 14)" fill={paint("accent")} />
          </g>
          <g transform="translate(4 3)">{shell(shadow)}</g>
          {shell(paint("shell"))}
          <path d={tall ? "M-16-13Q-17-25-5-25H8" : "M-21-10Q-22-21-10-21H10"} fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth={1.8} strokeLinecap="round" />
        </>
      )}
      <rect x={tall ? -17 : -22} y={-12} width={tall ? 35 : 45} height={26} rx={round || look.style === "orb" ? 12 : 9} fill={shadow} />
      <rect x={tall ? -17 : -22} y={-13} width={tall ? 34 : 44} height={24} rx={round || look.style === "orb" ? 12 : 9} fill={paint("face")} stroke="#ffffff" strokeOpacity=".32" strokeWidth={.8} />
      <path d={tall ? "M-12-9H4" : "M-15-9H6"} stroke="#b7e0e9" strokeOpacity=".16" strokeWidth={1.5} strokeLinecap="round" />
      <g className="companion-eyes" fill={shadeColor(accent, "#ffffff", .6)}>
        {look.eyes === "wide" ? <><ellipse cx={-9} cy={-1} rx={5} ry={6} /><ellipse cx={9} cy={-1} rx={5} ry={6} /><ellipse cx={-8} cy={0} rx={2} ry={3} fill="#162d36" /><ellipse cx={10} cy={0} rx={2} ry={3} fill="#162d36" /><circle cx={-9} cy={-2} r={1.4} fill="#fff" /><circle cx={9} cy={-2} r={1.4} fill="#fff" /></> : look.eyes === "visor" ? <><rect x={-14} y={-4} width={10} height={5} rx={2.5} /><rect x={4} y={-4} width={10} height={5} rx={2.5} /><path d="M-3 4Q0 6 3 4" fill="none" stroke={accent} strokeWidth={1.5} strokeLinecap="round" /></> : <><rect x={-11} y={-5} width={5} height={8} rx={2.5} /><rect x={6} y={-5} width={5} height={8} rx={2.5} /><path d="M-3 5H3" stroke={accent} strokeWidth={1.2} strokeLinecap="round" /></>}
      </g>
      {look.accessory === "antenna" && <g><path d={`M0 ${top}V${top - 8}`} stroke={paint("metal")} strokeWidth={3} /><circle cx={0} cy={top - 10} r={4} fill={paint("accent")} /><circle cx={-1} cy={top - 11} r={1.2} fill="#fff" opacity=".8" /></g>}
      {look.accessory === "headset" && <g><path d="M-29-2V-10C-29-37 29-37 29-10V-2" fill="none" stroke={shadow} strokeWidth={6} /><path d="M-29-12C-29-35 29-35 29-12" fill="none" stroke={paint("accent")} strokeWidth={4} /><rect x={-33} y={-7} width={9} height={19} rx={4.5} fill={paint("accent")} /><rect x={26} y={-7} width={9} height={19} rx={4.5} fill={paint("accent")} /><path d="M29 8Q28 18 15 16" fill="none" stroke="#52616c" strokeWidth={2.5} /><rect x={10} y={13} width={8} height={5} rx={2.5} fill="#36444d" /></g>}
      {look.accessory === "cap" && <g><path d={`M-23 ${top + 7}Q-22 ${top - 13} 3 ${top - 9}Q21 ${top - 6} 24 ${top + 7}Z`} fill={paint("accent")} /><path d={`M-24 ${top + 6}Q4 ${top + 1} 32 ${top + 10}Q35 ${top + 15} 21 ${top + 13}L-24 ${top + 10}Z`} fill={shadeColor(accent, "#293238", .3)} /><path d={`M-17 ${top + 1}Q-10 ${top - 7} 2 ${top - 5}`} stroke="#fff" strokeOpacity=".45" strokeWidth={1.5} fill="none" /></g>}
      {look.accessory === "none" && <g fill={paint("accent")}>
        {mark === 0 ? <><rect x={-9} y={top - 5} width={6} height={8} rx={2} /><rect x={2} y={top - 7} width={6} height={10} rx={2} /></> : mark === 1 ? <path d={`M-7 ${top + 2}L0 ${top - 9}L8 ${top + 2}Z`} /> : mark === 2 ? <rect x={-9} y={top - 4} width={18} height={7} rx={3.5} /> : <><circle cx={-9} cy={top - 1} r={4} /><circle cx={9} cy={top - 1} r={4} /></>}
      </g>}
    </g>
  );
}

export function CompanionAvatar({ look, identity, size = 64, label }: { look: Appearance; identity?: string; size?: number; label?: string }) {
  return <svg viewBox="-42 -46 84 88" width={size} height={size} className="companion-avatar" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}><CompanionFigure look={look} identity={identity} /></svg>;
}
