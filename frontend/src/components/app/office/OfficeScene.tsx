"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { ArrowsOut, Minus, Plus } from "@phosphor-icons/react";
import { statusLabel, UNASSIGNED, type Agent, type Snapshot } from "@/lib/types";
import { CompanionFigure } from "../CompanionAvatar";

export type SceneHandle = { centerOn: (agentId: string) => void; focusCompanion: (agentId: string) => void };
type View = { x: number; y: number; k: number };
type Gesture =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "pinch"; dist: number; view: View; cx: number; cy: number }
  | { kind: "drag"; id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean }
  | { kind: "tap"; id: string };

const TABLE_W = 300;
const TABLE_H = 240;
const clamp = (k: number) => Math.min(2.5, Math.max(0.12, k));
const zoomAt = (v: View, k: number, cx: number, cy: number): View => {
  const nk = clamp(k);
  return { k: nk, x: cx - (cx - v.x) * (nk / v.k), y: cy - (cy - v.y) * (nk / v.k) };
};

export function OfficeScene({
  ref,
  snapshot,
  selectedId,
  highlightId,
  thinkingIds,
  deptFilter,
  editable,
  onSelect,
  onMoveDesk,
}: {
  ref?: Ref<SceneHandle>;
  snapshot: Snapshot;
  selectedId: string | null;
  highlightId: string | null;
  thinkingIds: string[];
  deptFilter: string | null;
  editable: boolean;
  onSelect: (id: string) => void;
  onMoveDesk: (agentId: string, pos: { x: number; y: number }) => void;
}) {
  const { layout, agents, departments } = snapshot;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fitted = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 0.7 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  const maxX = Math.max(0, ...layout.zones.map((z) => z.x + z.w));
  const bounds = { w: maxX + 60 + TABLE_W, h: Math.max(TABLE_H, ...layout.zones.map((z) => z.y + z.h)), tableX: maxX + 60 };

  // The React Compiler memoizes these; no manual useCallback/useMemo.
  const fitView = (): View => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return view;
    const k = clamp(Math.min((r.width - 48) / bounds.w, (r.height - 48) / bounds.h));
    return { k, x: (r.width - bounds.w * k) / 2, y: (r.height - bounds.h * k) / 2 };
  };

  // Fit once when the svg first mounts (callback ref, so no setState-in-effect).
  const attach = (el: SVGSVGElement | null) => {
    svgRef.current = el;
    if (el && !fitted.current) {
      fitted.current = true;
      requestAnimationFrame(() => setView(fitView()));
    }
  };

  useImperativeHandle(ref, () => ({
    focusCompanion(agentId) {
      svgRef.current?.querySelector<SVGGElement>(`[data-agent="${agentId}"]`)?.focus();
    },
    centerOn(agentId) {
      const d = layout.desks[agentId];
      const r = svgRef.current?.getBoundingClientRect();
      if (!d || !r) return;
      setView((v) => ({ k: v.k, x: r.width / 2 - d.x * v.k, y: r.height / 2 - d.y * v.k }));
    },
  }));

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toScene = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };

  function onBackgroundDown(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const r = e.currentTarget.getBoundingClientRect();
      gesture.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), view, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top };
    } else {
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, view };
    }
  }

  function onCompanionDown(e: React.PointerEvent, a: Agent) {
    e.stopPropagation();
    if (!editable) {
      gesture.current = { kind: "tap", id: a.id };
      return;
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = toScene(e.clientX, e.clientY);
    const d = layout.desks[a.id];
    gesture.current = { kind: "drag", id: a.id, dx: p.x - d.x, dy: p.y - d.y, sx: e.clientX, sy: e.clientY, moved: false };
  }

  function onMove(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.kind === "pan") setView({ ...g.view, x: g.view.x + e.clientX - g.sx, y: g.view.y + e.clientY - g.sy });
    if (g.kind === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setView(zoomAt(g.view, (g.view.k * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist, g.cx, g.cy));
    }
    if (g.kind === "drag") {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
      if (g.moved) {
        const p = toScene(e.clientX, e.clientY);
        setDrag({ id: g.id, x: Math.round(p.x - g.dx), y: Math.round(p.y - g.dy) });
      }
    }
  }

  function onUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === "tap") onSelect(g.id);
    if (g?.kind === "drag") {
      if (g.moved && drag) onMoveDesk(g.id, { x: drag.x, y: drag.y });
      else onSelect(g.id);
      setDrag(null);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (e.target !== e.currentTarget) return;
    const step = 60;
    const r = e.currentTarget.getBoundingClientRect();
    const moves: Record<string, () => View> = {
      ArrowLeft: () => ({ ...view, x: view.x + step }),
      ArrowRight: () => ({ ...view, x: view.x - step }),
      ArrowUp: () => ({ ...view, y: view.y + step }),
      ArrowDown: () => ({ ...view, y: view.y - step }),
      "+": () => zoomAt(view, view.k * 1.2, r.width / 2, r.height / 2),
      "=": () => zoomAt(view, view.k * 1.2, r.width / 2, r.height / 2),
      "-": () => zoomAt(view, view.k / 1.2, r.width / 2, r.height / 2),
      "0": () => fitView(),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setView(moves[e.key]());
    }
  }

  const zoomButton = (factor: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    setView((v) => zoomAt(v, v.k * factor, r.width / 2, r.height / 2));
  };

  const deptName = (id: string) => (id === UNASSIGNED ? "Unassigned" : (departments.find((d) => d.id === id)?.name ?? "Department"));
  const headDept = agents.find((a) => a.isHead)?.departmentId;
  const placed = agents.filter((a) => a.status !== "archived" && layout.desks[a.id]);

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden bg-bg">
      <svg
        ref={attach}
        tabIndex={0}
        role="application"
        aria-label="Office map. Arrow keys pan, plus and minus zoom, 0 fits the team. Tab moves between companions."
        className="h-full w-full touch-none select-none focus-visible:outline-2"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKeyDown}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {layout.zones.map((z) => (
            <g key={z.departmentId} opacity={deptFilter && deptFilter !== z.departmentId ? 0.3 : 1}>
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={18} fill="var(--paper)" stroke="var(--line)" strokeWidth={2} />
              <text x={z.x + 22} y={z.y + 38} className="fill-ink" style={{ fontSize: 18, fontWeight: 600 }}>
                {deptName(z.departmentId)}
                {z.departmentId === headDept ? " (head office)" : ""}
              </text>
            </g>
          ))}

          <g transform={`translate(${bounds.tableX} 0)`}>
            <rect width={TABLE_W} height={TABLE_H} rx={18} fill="var(--paper)" stroke="var(--line)" strokeWidth={2} />
            <text x={22} y={38} className="fill-ink" style={{ fontSize: 18, fontWeight: 600 }}>Meeting table</text>
            <ellipse cx={150} cy={130} rx={90} ry={46} fill="var(--bg)" stroke="var(--line)" strokeWidth={2} />
            {[60, 120, 180, 240].map((cx) => (
              <circle key={cx} cx={cx} cy={cx % 120 === 0 ? 70 : 190} r={10} fill="var(--line)" />
            ))}
            <text x={150} y={222} textAnchor="middle" className="fill-muted" style={{ fontSize: 14 }}>No meetings yet</text>
          </g>

          {placed.map((a) => {
            const pos = drag?.id === a.id ? drag : layout.desks[a.id];
            const dimmed = deptFilter && deptFilter !== (a.departmentId ?? UNASSIGNED);
            const thinking = thinkingIds.includes(a.id);
            const label = `${a.name}, ${a.role}, ${statusLabel(a, thinking)}`;
            return (
              <g
                key={a.id}
                data-agent={a.id}
                transform={`translate(${pos.x} ${pos.y})`}
                opacity={dimmed ? 0.3 : a.status === "paused" ? 0.6 : 1}
                tabIndex={0}
                role="button"
                aria-label={label}
                aria-pressed={selectedId === a.id}
                className="cursor-pointer outline-none [&:focus-visible>circle.ring]:opacity-100"
                onPointerDown={(e) => onCompanionDown(e, a)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(a.id);
                  }
                }}
              >
                <circle
                  className="ring"
                  r={38}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={3}
                  strokeDasharray={highlightId === a.id && selectedId !== a.id ? "6 6" : undefined}
                  opacity={selectedId === a.id || highlightId === a.id ? 1 : 0}
                />
                <rect x={-46} y={26} width={92} height={14} rx={4} fill="var(--line)" />
                {thinking && <text y={-46} textAnchor="middle" className="fill-ink" style={{ fontSize: 18 }}>…</text>}
                <g className="bob">
                  <CompanionFigure look={a.appearance} />
                </g>
                <text y={62} textAnchor="middle" className="fill-ink" style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</text>
                <text y={80} textAnchor="middle" className="fill-muted" style={{ fontSize: 12 }}>
                  {a.kind === "human" ? "Human, " : ""}
                  {statusLabel(a, thinking)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-4 right-4 flex flex-col gap-1 rounded-[12px] border border-line bg-paper p-1 shadow-sm">
        <button aria-label="Zoom in" onClick={() => zoomButton(1.2)} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><Plus size={16} /></button>
        <button aria-label="Zoom out" onClick={() => zoomButton(1 / 1.2)} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><Minus size={16} /></button>
        <button aria-label="Fit to team" onClick={() => setView(fitView())} className="grid size-9 place-items-center rounded-[8px] hover:bg-bg"><ArrowsOut size={16} /></button>
      </div>
    </div>
  );
}
