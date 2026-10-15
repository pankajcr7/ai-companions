"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useWorkspace } from "@/lib/workspace";

type StudioPrefs = { warm: boolean; accent: "sage" | "blue" | "rose" | "amber"; focus: boolean; celebrations: boolean };
const defaults: StudioPrefs = { warm: false, accent: "sage", focus: false, celebrations: true };
const Context = createContext<{ prefs: StudioPrefs; update: (value: Partial<StudioPrefs>) => void }>({ prefs: defaults, update: () => {} });
export const useStudioPreferences = () => useContext(Context);
const subscribe = (fn: () => void) => { window.addEventListener("studio-preferences", fn); window.addEventListener("storage", fn); return () => { window.removeEventListener("studio-preferences", fn); window.removeEventListener("storage", fn); }; };
function parse(raw: string | null): StudioPrefs {
  try {
    const p = JSON.parse(raw ?? "{}");
    return { warm: p.warm === true, focus: p.focus === true, celebrations: p.celebrations !== false, accent: ["sage", "blue", "rose", "amber"].includes(p.accent) ? p.accent : "sage" };
  } catch { return defaults; }
}
export function StudioPreferences({ children }: { children: ReactNode }) {
  const { snapshot } = useWorkspace();
  const key = `studio-view:${snapshot.workspace.id}`;
  const raw = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key); } catch { return null; } }, () => null);
  const [fallback, setFallback] = useState<StudioPrefs | null>(null);
  const stored = useMemo(() => parse(raw), [raw]);
  const prefs = fallback ?? stored;
  function update(value: Partial<StudioPrefs>) {
    const next = { ...prefs, ...value };
    try { localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event("studio-preferences")); }
    catch { setFallback(next); }
  }
  return <Context value={{ prefs, update }}>{children}</Context>;
}
