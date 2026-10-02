"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { canAdmin, type Preferences } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

export default function Settings() {
  const { snapshot, reload, wsPath } = useWorkspace();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(fn: () => Promise<unknown>, done: string) {
    setMessage("");
    setError("");
    try {
      await fn();
      await reload();
      setMessage(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const setPref = (p: Partial<Preferences>) => save(() => api(wsPath("/preferences"), { method: "PUT", body: { ...snapshot.preferences, ...p } }), "Preferences saved.");

  return (
    <main className="max-w-2xl space-y-10 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p aria-live="polite" className="text-sm">
        {message && <span className="text-ink">{message}</span>}
        {error && <span role="alert" className="text-[#b42318]">{error}</span>}
      </p>

      <section aria-labelledby="ws-title">
        <h2 id="ws-title" className="text-lg font-semibold">Workspace</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name");
            save(() => api(wsPath(), { method: "PATCH", body: { name } }), "Workspace renamed.");
          }}
        >
          <label className="sr-only" htmlFor="ws-name">Workspace name</label>
          <input id="ws-name" name="name" defaultValue={snapshot.workspace.name} disabled={!canAdmin(snapshot.role)} maxLength={60} required className="flex-1 rounded-[10px] border border-line bg-paper px-3 py-2" />
          {canAdmin(snapshot.role) && <button className="btn-dark rounded-[10px] px-4 text-sm font-semibold text-paper">Save</button>}
        </form>
      </section>

      <section aria-labelledby="view-title">
        <h2 id="view-title" className="text-lg font-semibold">Your view</h2>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium">Theme</legend>
          <div className="mt-2 flex gap-2">
            {(["system", "light", "dark"] as const).map((t) => (
              <label key={t} className="cursor-pointer rounded-[10px] border border-line px-3 py-2 text-sm capitalize has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper">
                <input type="radio" name="theme" className="sr-only" checked={snapshot.preferences.theme === t} onChange={() => setPref({ theme: t })} />
                {t}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={snapshot.preferences.reducedMotion} onChange={(e) => setPref({ reducedMotion: e.target.checked })} />
          Reduce motion (stops companion animation)
        </label>
        <label className="mt-3 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={snapshot.preferences.calmMode} onChange={(e) => setPref({ calmMode: e.target.checked })} />
          Calm mode (no ambient movement or speech bubbles)
        </label>
      </section>
    </main>
  );
}
