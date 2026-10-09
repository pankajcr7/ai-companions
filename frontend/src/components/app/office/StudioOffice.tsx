"use client";

import { useId, useRef, useState } from "react";
import { ArrowsOut, Minus, Plus } from "@phosphor-icons/react";
import { companionSignature, shadeColor } from "@/lib/companion-look";
import { roleLabel, statusText, teamStatus } from "@/lib/team";
import type { Agent, Snapshot } from "@/lib/types";
import { CompanionFigure } from "../CompanionAvatar";

// All furniture shares one projection. Characters stay upright, like miniature desk toys.
const X = .866;
const Y = .43;
type Point = { x: number; y: number };
const project = (x: number, y: number, z = 0): Point => ({ x: (x - y) * X, y: (x + y) * Y - z });
const point = (p: Point) => `${p.x},${p.y}`;
const polygon = (...positions: [number, number, number?][]) => positions.map((p) => point(project(...p))).join(" ");

function Box({ x, y, z = 0, w, d, h, top, front, side }: { x: number; y: number; z?: number; w: number; d: number; h: number; top: string; front: string; side: string }) {
  return <g>
    <polygon points={polygon([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h])} fill={front} />
    <polygon points={polygon([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h])} fill={side} />
    <polygon points={polygon([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h])} fill={top} />
  </g>;
}

function Plant({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const p = project(x, y);
  return <g transform={`translate(${p.x} ${p.y}) scale(${scale})`} aria-hidden="true">
    <ellipse cy={3} rx={26} ry={12} fill="#273c29" opacity=".08" />
    <path d="M-15-23H15L11 0Q0 8-11 0Z" fill="#c3b5a1" /><path d="M-15-23H0V4Q-9 2-11 0Z" fill="#ddd2c2" /><ellipse cy={-23} rx={15} ry={6} fill="#ece4d7" /><ellipse cy={-23} rx={11} ry={3.5} fill="#68734d" />
    <path d="M0-22V-70M0-39L-18-59M0-46L17-69" stroke="#667e4c" strokeWidth={3} fill="none" />
    <ellipse cx={-12} cy={-53} rx={9} ry={19} transform="rotate(-40 -12 -53)" fill="#859f6c" /><ellipse cx={12} cy={-63} rx={9} ry={21} transform="rotate(32 12 -63)" fill="#607e4f" /><ellipse cx={-3} cy={-75} rx={9} ry={22} transform="rotate(-8 -3 -75)" fill="#a8bc87" /><ellipse cx={14} cy={-42} rx={8} ry={17} transform="rotate(58 14 -42)" fill="#94ad75" />
  </g>;
}

function Chair({ x, y, color = "#a2b4a0" }: { x: number; y: number; color?: string }) {
  const p = project(x, y);
  return <g transform={`translate(${p.x} ${p.y})`}>
    <ellipse cy={5} rx={26} ry={10} fill="#26392c" opacity=".07" />
    <path d="M0-18V5M-19 10L0 4L20 11M0 4L-4 17" stroke="#777f7d" strokeWidth={4} strokeLinecap="round" />
    <path d="M-23-56Q-24-66-13-68L18-64Q26-63 26-53L23-20L-21-25Z" fill={shadeColor(color, "#334338", .18)} />
    <path d="M-22-58Q-21-65-12-65L16-61Q22-60 22-53L20-25L-20-29Z" fill={color} />
    <path d="M-24-24L8-31L30-21L-2-11Z" fill={shadeColor(color, "#ffffff", .25)} /><path d="M-24-24V-18L-2-5L30-15V-21L-2-11Z" fill={color} />
  </g>;
}

function Station({ agent, x, y, snapshot, working, onOpen }: { agent: Agent; x: number; y: number; snapshot: Snapshot; working: Map<string, string>; onOpen: (id: string) => void }) {
  const state = teamStatus(agent, snapshot.connections, working);
  const busy = state.kind === "working";
  const ready = state.kind === "free";
  const { accent } = companionSignature(agent.id);
  const body = project(x, y - 28, 85);
  const monitor = project(x + 21, y + 26, 88);
  const label = project(x + 8, y + 81);
  const status = busy ? "Working" : ready ? "Ready to help" : state.kind === "setup" ? "Needs setup" : state.kind === "paused" ? "Paused" : "Away";
  const dot = busy ? "#b88437" : ready ? "#72975d" : "#9b9e99";
  return <g className="office-station" data-working={busy} data-agent={agent.id} role="button" tabIndex={0} aria-label={`${agent.name}, ${roleLabel(agent)}, ${statusText(state)}`} onClick={() => onOpen(agent.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(agent.id); } }}>
    <title>{agent.name} · {roleLabel(agent)} · {statusText(state)}. Click to chat.</title>
    <polygon className="office-station-focus" points={polygon([x - 92, y - 79], [x + 89, y - 79], [x + 89, y + 110], [x - 92, y + 110])} fill={accent} fillOpacity=".09" stroke={accent} strokeWidth="2" />
    <ellipse cx={project(x + 10, y + 32).x} cy={project(x + 10, y + 32).y + 6} rx={82} ry={30} fill="#283c31" opacity=".055" />
    <Chair x={x} y={y - 32} color={shadeColor(accent, "#ffffff", .15)} />
    <g transform={`translate(${body.x} ${body.y}) scale(1.08)`} className="office-seated-companion"><CompanionFigure look={agent.appearance} identity={agent.id} working={busy} /></g>
    {[[x - 65, y], [x + 61, y], [x - 65, y + 60], [x + 61, y + 60]].map(([lx, ly], i) => <Box key={i} x={lx} y={ly} w={6} d={6} h={51} top="#b2b6af" front="#a6aba1" side="#7b8279" />)}
    <Box x={x - 73} y={y - 8} z={50} w={154} d={80} h={7} top="var(--office-wood)" front="var(--office-wood-edge)" side="var(--office-wood-side)" />
    <polygon points={polygon([x - 45, y + 15, 58], [x + 47, y + 15, 58], [x + 47, y + 62, 58], [x - 45, y + 62, 58])} fill={shadeColor(accent, "#ffffff", .7)} opacity=".65" />
    <g transform={`translate(${monitor.x} ${monitor.y}) skewY(26)`}>
      <path d="M0 2V17M-12 18H12" stroke="#8a9797" strokeWidth={5} strokeLinecap="round" />
      <rect x={-33} y={-37} width={69} height={45} rx={5} fill="#8b9998" /><rect x={-35} y={-39} width={68} height={44} rx={5} fill="#dbe2de" /><rect x={-31} y={-35} width={60} height={35} rx={2} fill={busy || ready ? "#263d41" : "#596667"} />
      <circle cx={-1} cy={2.5} r={1} fill="#8b9998" />
      {busy || ready ? <g className="office-screen-content"><rect x={-26} y={-29} width={15} height={3} rx={1.5} fill={accent} /><rect x={-26} y={-21} width={38} height={2.5} rx={1} fill="#8ca9a4" /><rect x={-26} y={-14} width={26} height={2.5} rx={1} fill="#658b89" /><rect x={-26} y={-7} width={44} height={2} rx={1} fill="#466b70" /><rect className="office-screen-cursor" x={4} y={-14} width={3} height={3} fill={accent} /></g> : <circle cx={-1} cy={-18} r={5} fill="#a8b7ad" opacity=".6" />}
    </g>
    <Box x={x - 35} y={y + 38} z={58} w={46} d={19} h={2} top="#f5f4ee" front="#c7d0c6" side="#bac6bc" />
    {[0, 1, 2].map((row) => <path key={row} d={`M${point(project(x - 30, y + 42 + row * 4, 61))}L${point(project(x + 6, y + 42 + row * 4, 61))}`} stroke="#c5cdc4" strokeWidth={1} />)}
    <g transform={`translate(${project(x - 54, y + 7, 60).x} ${project(x - 54, y + 7, 60).y})`}><path d="M-6-10H6V-1Q0 5-6-1Z" fill={accent} /><ellipse cy={-10} rx={6} ry={2.5} fill={shadeColor(accent, "#ffffff", .4)} /><ellipse cy={-10} rx={4} ry={1.5} fill="#8b7865" /><path d="M6-7Q14-9 11-2L6 0" stroke={accent} strokeWidth={2} fill="none" /></g>
    {busy && <g className="office-typing-hands" fill={accent}><ellipse cx={project(x - 18, y + 40, 66).x} cy={project(x - 18, y + 40, 66).y} rx={7} ry={4} /><ellipse cx={project(x + 1, y + 34, 66).x} cy={project(x + 1, y + 34, 66).y} rx={7} ry={4} /></g>}
    <g transform={`translate(${label.x} ${label.y})`} className="office-nameplate">
      <rect x={-74} y={-3} width={148} height={42} rx={10} fill="var(--paper)" fillOpacity=".96" stroke="var(--line)" />
      <text y={13} textAnchor="middle" fill="var(--ink)" fontSize={13} fontWeight={700}>{agent.name.length > 18 ? `${agent.name.slice(0, 17)}…` : agent.name}</text>
      <circle cx={status === "Ready to help" ? -39 : status === "Needs setup" ? -36 : -27} cy={28} r={3} fill={dot} />
      <text x={5} y={31} textAnchor="middle" fill="var(--muted)" fontSize={10}>{status}</text>
    </g>
  </g>;
}

export function StudioOffice({ snapshot, working, onOpen }: { snapshot: Snapshot; working: Map<string, string>; onOpen: (id: string) => void }) {
  const id = useId().replace(/:/g, "");
  const scroll = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const companions = snapshot.agents.filter((a) => a.status !== "archived").sort((a, b) => Number(b.isHead) - Number(a.isHead));
  const columns = Math.min(3, Math.max(2, companions.length));
  const rows = Math.max(2, Math.ceil(companions.length / columns));
  const width = columns * 210 + 255;
  const depth = rows * 220 + 90;
  const sceneWidth = (width + depth) * X + 100;
  const sceneHeight = (width + depth) * Y + 235;
  const seats = companions.map((agent, i) => ({ agent, x: 125 + i % columns * 210, y: 135 + Math.floor(i / columns) * 220 })).sort((a, b) => a.x + a.y - b.x - b.y);
  const furnitureId = `${id}-window`;
  const meetingX = width - 152;
  const meetingY = depth - 175;

  return <div className="studio-office">
    <div className="office-scene-topline"><span><i />{snapshot.workspace.name}<span className="office-floor-label"> / The studio</span></span><span className="office-scene-badge">{companions.length} desks · One team</span></div>
    <div className="office-scene-scroll" ref={scroll}>
      <svg viewBox={`0 0 ${sceneWidth} ${sceneHeight}`} className="office-diorama" style={{ width: `max(${zoom * 100}%, ${zoom * 720}px)` }} role="group" aria-label="Team office. Each companion has a desk. Select a companion to open their chat.">
        <defs>
          <linearGradient id={furnitureId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d5e8e9" /><stop offset="1" stopColor="#edf3ec" /></linearGradient>
        </defs>
        <g transform={`translate(${depth * X + 50} 177)`}>
          <polygon points={polygon([-16, -14, -15], [width + 16, -14, -15], [width + 16, depth + 20, -15], [-16, depth + 20, -15])} fill="#344531" opacity=".055" transform="translate(0 16)" />
          <Box x={0} y={0} z={-16} w={width} d={depth} h={16} top="var(--office-floor)" front="var(--office-floor-edge)" side="var(--office-floor-side)" />
          <g stroke="var(--office-grid)" strokeWidth={1} opacity=".65">
            {Array.from({ length: Math.floor(width / 65) }, (_, i) => <line key={`x${i}`} x1={project((i + 1) * 65, 0).x} y1={project((i + 1) * 65, 0).y} x2={project((i + 1) * 65, depth).x} y2={project((i + 1) * 65, depth).y} />)}
            {Array.from({ length: Math.floor(depth / 65) }, (_, i) => <line key={`y${i}`} x1={project(0, (i + 1) * 65).x} y1={project(0, (i + 1) * 65).y} x2={project(width, (i + 1) * 65).x} y2={project(width, (i + 1) * 65).y} />)}
          </g>
          <Box x={-9} y={-9} w={width + 18} d={9} h={135} top="var(--office-wall-top)" front="var(--office-wall)" side="var(--office-wall-side)" />
          <Box x={-9} y={0} w={9} d={depth} h={135} top="var(--office-wall-top)" front="var(--office-wall-side)" side="var(--office-wall-left)" />
          {[70, 245, ...(depth > 650 ? [420] : [])].map((wy) => <g key={wy} aria-hidden="true">
            <polygon points={polygon([1, wy, 33], [1, wy + 120, 33], [1, wy + 120, 112], [1, wy, 112])} fill={`url(#${furnitureId})`} stroke="#f8faf5" strokeWidth={7} />
            <path d={`M${point(project(2, wy + 60, 33))}L${point(project(2, wy + 60, 112))}`} stroke="#fbfcf7" strokeWidth={4} />
            <path d={`M${point(project(2, wy, 67))}L${point(project(2, wy + 120, 67))}`} stroke="#fbfcf7" strokeWidth={3} />
            <polygon points={polygon([2, wy, 1], [115, wy + 52, 1], [115, wy + 170, 1], [2, wy + 120, 1])} fill="#ffffff" opacity=".12" />
          </g>)}
          <g transform={`translate(${project(width * .42, 0, 77).x} ${project(width * .42, 0, 77).y}) skewY(26)`} aria-hidden="true"><rect x={-93} y={-30} width={186} height={49} rx={5} fill="var(--paper)" opacity=".8" /><text x={0} y={-6} textAnchor="middle" fontSize={16} fontWeight={700} fill="var(--ink)" letterSpacing={-.5}>good things take a team.</text><text x={0} y={10} textAnchor="middle" fontSize={8} fill="var(--muted)" letterSpacing={2}>AGENT COMPANY</text></g>
          <Plant x={48} y={35} scale={1.12} />
          <Plant x={width - 45} y={40} scale={1.3} />
          <Box x={width - 220} y={24} w={124} d={36} h={52} top="#e8ddc8" front="#c0b699" side="#b0a58e" />
          <Box x={width - 205} y={30} z={52} w={28} d={23} h={31} top="#3f504b" front="#52615a" side="#2d403a" />
          <g transform={`translate(${project(width - 161, 40, 63).x} ${project(width - 161, 40, 63).y})`} aria-hidden="true"><rect x={-6} y={-7} width={12} height={12} rx={3} fill="#f6f0e2" /><ellipse cy={-7} rx={6} ry={2} fill="#a59b88" /></g>
          <g aria-hidden="true">
            <polygon points={polygon([meetingX - 85, meetingY - 82], [meetingX + 87, meetingY - 82], [meetingX + 87, meetingY + 91], [meetingX - 85, meetingY + 91])} fill="var(--office-rug)" stroke="var(--office-rug-edge)" strokeWidth={2} />
            <Chair x={meetingX - 39} y={meetingY - 42} color="#b6bfa5" /><Chair x={meetingX + 44} y={meetingY - 27} color="#b6bfa5" />
            <Box x={meetingX - 5} y={meetingY - 5} w={10} d={10} h={46} top="#c2b699" front="#aea38c" side="#8d8674" />
            <ellipse cx={project(meetingX, meetingY, 47).x} cy={project(meetingX, meetingY, 47).y + 5} rx={72} ry={36} fill="#bdb194" /><ellipse cx={project(meetingX, meetingY, 47).x} cy={project(meetingX, meetingY, 47).y} rx={72} ry={36} fill="var(--office-wood)" />
            <Box x={meetingX - 17} y={meetingY - 7} z={48} w={27} d={19} h={2} top="#fbf6e9" front="#e7ddc8" side="#c8c4b0" />
            <Chair x={meetingX - 24} y={meetingY + 67} color="#a7bba4" /><Chair x={meetingX + 55} y={meetingY + 57} color="#a7bba4" />
            <text x={project(meetingX, meetingY + 108).x} y={project(meetingX, meetingY + 108).y} fill="var(--office-label)" fontSize={11} textAnchor="middle">The meeting corner</text>
          </g>
          {seats.map(({ agent, x, y }) => <Station key={agent.id} agent={agent} x={x} y={y} snapshot={snapshot} working={working} onOpen={onOpen} />)}
          <Plant x={43} y={depth - 32} scale={1.1} />
          <Plant x={width - 38} y={depth - 32} scale={.9} />
        </g>
      </svg>
    </div>
    <div className="office-scene-footer"><p><span className="office-desktop-hint">Click a companion to chat or see their work.</span><span className="office-mobile-hint">Swipe to explore. Tap a companion to chat.</span></p><div className="office-zoom" role="group" aria-label="Office zoom"><button aria-label="Zoom out" disabled={zoom <= .8} onClick={() => setZoom((z) => Math.max(.8, z - .2))}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom in" disabled={zoom >= 1.8} onClick={() => setZoom((z) => Math.min(1.8, z + .2))}><Plus size={15} /></button><button aria-label="Reset view" onClick={() => { setZoom(1); scroll.current?.scrollTo({ left: 0, top: 0 }); }}><ArrowsOut size={16} /></button></div></div>
  </div>;
}
