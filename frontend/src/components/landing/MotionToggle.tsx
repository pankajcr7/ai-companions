"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Pause, Play } from "@phosphor-icons/react";

const KEY = "landing-motion";
const EVENT = "motionchange";

// The page-wide flag is data-motion="off" on <html>: CSS animations pause on it and the 3D scenes read it each frame.
const isOff = () => document.documentElement.dataset.motion === "off";
const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
};
function setMotion(off: boolean, remember: boolean) {
  if (off) document.documentElement.dataset.motion = "off";
  else delete document.documentElement.dataset.motion;
  if (remember) {
    try {
      localStorage.setItem(KEY, off ? "off" : "on");
    } catch {}
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Turns all the page's motion off and on, and remembers the choice. */
export function MotionToggle({ className = "" }: { className?: string }) {
  const off = useSyncExternalStore(subscribe, isOff, () => false);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "off") setMotion(true, false);
    } catch {}
  }, []);
  return (
    <button
      type="button"
      onClick={() => setMotion(!off, true)}
      aria-pressed={off}
      className={`inline-flex items-center gap-2 rounded-full border border-cream/20 bg-night/60 px-3 py-1.5 text-xs font-medium text-cream/80 backdrop-blur-sm transition-colors hover:text-cream ${className}`}
    >
      {off ? <Play size={12} weight="fill" /> : <Pause size={12} weight="fill" />}
      {off ? "Play motion" : "Pause motion"}
    </button>
  );
}
