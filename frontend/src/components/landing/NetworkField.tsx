"use client";

import { useEffect, useRef } from "react";

type Dot = { x: number; y: number; vx: number; vy: number; r: number; kind: "cream" | "teal" | "lime" };

const LINK = 140; // dots closer than this are joined by a line
const REACH = 190; // the pointer's reach

/**
 * The team as a drifting network behind the hero: dots joined by thin lines when they come close.
 * Near the pointer the links light lime and reach out to it. A plain 2D canvas, so no 3D library is needed;
 * it pauses off screen and when motion is paused, and it is drawn once and held still for people who turn motion off,
 * on phones and on low-power devices (to save battery).
 */
export function NetworkField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.innerWidth < 640 || (navigator.hardwareConcurrency ?? 8) <= 4;
    const paused = () => document.documentElement.dataset.motion === "off";
    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    const pointer = { x: 0, y: 0, on: false };

    const seed = () => {
      // About one dot per 9,000 square pixels: sparse on phones, fuller on wide screens.
      const count = Math.max(40, Math.min(150, Math.round((w * h) / 9000)));
      dots = Array.from({ length: count }, () => {
        const pick = Math.random();
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          r: 1 + Math.random() * 1.4,
          kind: pick < 0.08 ? "lime" : pick < 0.3 ? "teal" : "cream",
        };
      });
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (!still && !paused()) {
        for (const d of dots) {
          d.x = (d.x + d.vx + w) % w;
          d.y = (d.y + d.vy + h) % h;
        }
      }
      const near = (x: number, y: number) => (pointer.on ? Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / REACH) : 0);

      ctx.lineWidth = 0.8;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const a = dots[i];
          const b = dots[j];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > LINK) continue;
          const fade = 1 - dist / LINK;
          const lit = near((a.x + b.x) / 2, (a.y + b.y) / 2);
          ctx.strokeStyle = lit > 0 ? `rgba(166,255,0,${fade * (0.15 + lit * 0.55)})` : `rgba(238,244,240,${fade * 0.16})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      // The pointer joins the team: lines from it to the dots in reach.
      for (const d of dots) {
        const lit = near(d.x, d.y);
        if (lit <= 0) continue;
        ctx.strokeStyle = `rgba(166,255,0,${lit * 0.35})`;
        ctx.beginPath();
        ctx.moveTo(pointer.x, pointer.y);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
      for (const d of dots) {
        const lit = near(d.x, d.y);
        const glow = d.kind === "lime" || lit > 0.3;
        ctx.fillStyle = glow ? "#a6ff00" : d.kind === "teal" ? "rgba(79,179,169,0.85)" : "rgba(238,244,240,0.55)";
        ctx.shadowColor = glow ? "rgba(166,255,0,0.8)" : "transparent";
        ctx.shadowBlur = glow ? 12 : 0;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r + lit * 1.6 + (d.kind === "lime" ? 0.8 : 0), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const first = !w;
      w = r.width;
      h = r.height;
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (first) seed();
      draw();
    };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    };
    const onLeave = () => void (pointer.on = false);

    // Runs only while on screen.
    let visible = true;
    let frame = 0;
    const loop = () => {
      frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
      draw();
    };
    const wake = () => {
      if (!still && !frame && visible && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const seen = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    const sized = new ResizeObserver(resize);

    resize();
    canvas.style.opacity = "1";
    seen.observe(canvas);
    sized.observe(canvas);
    if (!still) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", wake);
      wake();
    }
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      sized.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-0 transition-opacity duration-1000" />;
}
