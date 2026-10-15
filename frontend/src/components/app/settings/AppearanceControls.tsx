"use client";

import { useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Preferences } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { useStudioPreferences } from "../StudioPreferences";

export function AppearanceControls() {
  const { snapshot, wsPath, setSnapshot } = useWorkspace();
  const { prefs, update } = useStudioPreferences();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const id = useId();
  async function save(value: Partial<Preferences>, warm?: boolean) {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError("");
    const preferences = { ...snapshot.preferences, ...value };
    const previousWarm = prefs.warm;
    setSnapshot({ ...snapshot, preferences });
    if (warm !== undefined) update({ warm });
    try {
      await api(wsPath("/preferences"), { method: "PUT", body: preferences });
    } catch (e) { setSnapshot(snapshot); if (warm !== undefined) update({ warm: previousWarm }); setError((e as Error).message); }
    finally { lock.current = false; setSaving(false); }
  }
  const theme = prefs.warm && snapshot.preferences.theme === "light" ? "warm" : snapshot.preferences.theme;
  return <div className="studio-appearance">
    <fieldset disabled={saving}><legend>Choose your atmosphere</legend><div className="studio-theme-options">
      {(["light", "warm", "dark", "system"] as const).map((t) => <label key={t} className="studio-theme-option" data-selected={theme === t}><input type="radio" name={`${id}-theme`} value={t} checked={theme === t} onChange={() => save({ theme: t === "warm" ? "light" : t }, t === "warm")} /><span className="studio-theme-sample" data-sample={t}><i /><i /><i /></span><span>{t[0].toUpperCase() + t.slice(1)}</span></label>)}
    </div></fieldset>
    <fieldset><legend>Accent color</legend><div className="studio-accent-options">{(["sage", "blue", "rose", "amber"] as const).map((accent) => <button key={accent} type="button" aria-pressed={prefs.accent === accent} onClick={() => update({ accent })} data-accent={accent}><i />{accent[0].toUpperCase() + accent.slice(1)}</button>)}</div></fieldset>
    <label className="studio-setting-row"><span><strong>Celebrate finished work</strong><small>A little celebration when a project goal finishes.</small></span><input type="checkbox" checked={prefs.celebrations} onChange={(e) => update({ celebrations: e.target.checked })} /></label>
    <label className="studio-setting-row"><span><strong>Focus mode</strong><small>More space for your work, with the sidebar tucked away.</small></span><input type="checkbox" checked={prefs.focus} onChange={(e) => update({ focus: e.target.checked })} /></label>
    <label className="studio-setting-row"><span><strong>Reduce motion</strong><small>Keep animations still throughout your workspace.</small></span><input type="checkbox" disabled={saving} checked={snapshot.preferences.reducedMotion} onChange={(e) => save({ reducedMotion: e.target.checked })} /></label>
    <label className="studio-setting-row"><span><strong>Calm mode</strong><small>A quiet office without ambient movement.</small></span><input type="checkbox" disabled={saving} checked={snapshot.preferences.calmMode} onChange={(e) => save({ calmMode: e.target.checked })} /></label>
    <p className="studio-settings-note">Accent, warmth, focus, and celebrations are remembered on this device.</p>
    {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
  </div>;
}
