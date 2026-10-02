"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Agent, Appearance } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { CompanionAvatar } from "./CompanionAvatar";

const SWATCHES = ["#a6ff00", "#e4e4e7", "#a1a1aa", "#71717a", "#3f3f46", "#ff7a00", "#5b8def", "#e5484d"];
const field = "mt-1.5 w-full rounded-[10px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";

/** Everyone who reports to `id`, directly or indirectly, plus `id` itself. */
function selfAndReports(agents: Agent[], id: string) {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of agents) {
      if (a.managerId && out.has(a.managerId) && !out.has(a.id)) {
        out.add(a.id);
        grew = true;
      }
    }
  }
  return out;
}

export function CompanionForm({ agent, onClose, onSaved }: { agent: Agent | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const head = snapshot.agents.find((a) => a.isHead);
  const [form, setForm] = useState(() => ({
    name: agent?.name ?? "",
    role: agent?.role ?? "",
    kind: agent?.kind ?? ("ai" as Agent["kind"]),
    workingStyle: agent?.workingStyle ?? "",
    departmentId: agent?.departmentId ?? snapshot.departments[0]?.id ?? "",
    managerId: agent ? (agent.managerId ?? "") : (head?.id ?? ""),
    connectionId: agent?.connectionId ?? "",
    model: agent?.model ?? "",
    appearance: agent?.appearance ?? ({ style: "robot", color: "#a1a1aa", head: "square", eyes: "dots", accessory: "none" } as Appearance),
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [modelsNote, setModelsNote] = useState("");
  useEffect(() => {
    if (!form.connectionId) return;
    let cancelled = false;
    api<{ models: { id: string; label: string }[] }>(wsPath(`/connections/${form.connectionId}/models`))
      .then((r) => {
        if (cancelled) return;
        setModels(r.models);
        setModelsNote(r.models.length ? "" : "No models listed. Type a model ID.");
      })
      .catch((e) => {
        if (cancelled) return;
        setModels([]);
        setModelsNote(`${(e as Error).message} You can still type a model ID.`);
      });
    return () => {
      cancelled = true;
    };
  }, [form.connectionId, wsPath]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const look = <K extends keyof Appearance>(k: K, v: Appearance[K]) => setForm((f) => ({ ...f, appearance: { ...f.appearance, [k]: v } }));
  const blocked = agent ? selfAndReports(snapshot.agents, agent.id) : new Set<string>();
  // Keep the current manager listed even if paused, so the select shows the truth.
  const managers = snapshot.agents.filter((a) => (a.status === "active" || a.id === agent?.managerId) && !blocked.has(a.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      ...form,
      departmentId: form.departmentId || null,
      managerId: agent?.isHead ? null : form.managerId || null,
      connectionId: form.connectionId || null,
      model: form.connectionId && form.model.trim() ? form.model.trim() : null,
    };
    try {
      const id = agent
        ? (await api<{ id: string }>(wsPath(`/agents/${agent.id}`), { method: "PATCH", body })).id
        : (await api<{ id: string }>(wsPath("/agents"), { method: "POST", body })).id;
      onSaved(id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const choice = <K extends "style" | "head" | "eyes" | "accessory">(k: K, label: string, options: Appearance[K][]) => (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-muted">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o} className="cursor-pointer rounded-[8px] border border-line px-2.5 py-1 text-sm capitalize has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper">
            <input type="radio" name={k} value={o} checked={form.appearance[k] === o} onChange={() => look(k, o)} className="sr-only" />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="companion-form-title" className="m-auto w-[min(860px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-0 text-ink backdrop:bg-black/40">
      <form onSubmit={submit} className="grid gap-6 p-6 md:grid-cols-[240px_1fr]">
        <div className="grid place-items-center rounded-[14px] bg-bg p-6">
          <CompanionAvatar look={form.appearance} size={160} label={`Preview of ${form.name || "new companion"}`} />
          <p className="mt-3 text-center font-semibold">{form.name || "New companion"}</p>
          <p className="text-center text-sm text-muted">{form.role || "Role"}</p>
        </div>
        <div className="space-y-4">
          <h2 id="companion-form-title" className="text-xl font-semibold">{agent ? `Customize ${agent.name}` : "New companion"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Name<input required maxLength={60} value={form.name} onChange={(e) => set("name", e.target.value)} className={field} /></label>
            <label className="text-sm font-medium">Role<input required maxLength={60} value={form.role} onChange={(e) => set("role", e.target.value)} className={field} /></label>
            <label className="text-sm font-medium">
              Department
              <select value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)} className={field}>
                <option value="">Unassigned</option>
                {snapshot.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Reports to
              <select value={form.managerId} disabled={agent?.isHead} onChange={(e) => set("managerId", e.target.value)} className={field}>
                {agent?.isHead ? <option value="">You (the owner)</option> : <option value="">No manager</option>}
                {!agent?.isHead && managers.map((m) => <option key={m.id} value={m.id}>{m.name}, {m.role}{m.status !== "active" ? " (paused)" : ""}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">
              Type
              <select value={form.kind} onChange={(e) => set("kind", e.target.value as Agent["kind"])} className={field}>
                <option value="ai">AI companion</option>
                <option value="human">Human collaborator</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Color
              <input type="color" value={form.appearance.color} onChange={(e) => look("color", e.target.value)} className="mt-1.5 h-10 w-full cursor-pointer rounded-[10px] border border-line bg-paper" />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Color presets">
            {SWATCHES.map((c) => (
              <button type="button" key={c} aria-label={`Use color ${c}`} onClick={() => look("color", c)} className="size-7 rounded-full border border-line" style={{ background: c }} />
            ))}
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-semibold">AI model</legend>
            <label className="text-sm font-medium">
              Provider
              <select value={form.connectionId} onChange={(e) => set("connectionId", e.target.value)} className={field}>
                <option value="">Not connected</option>
                {snapshot.connections.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} ({c.hint})</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Model
              <input list={`models-${agent?.id ?? "new"}`} value={form.model} disabled={!form.connectionId} onChange={(e) => set("model", e.target.value)} placeholder={form.connectionId ? "Pick or type a model" : "Choose a provider first"} className={field} />
              <datalist id={`models-${agent?.id ?? "new"}`}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </datalist>
            </label>
            {snapshot.connections.length === 0 && <p className="text-xs text-muted sm:col-span-2">No providers yet. An owner can add one on the AI providers page.</p>}
            {modelsNote && form.connectionId && <p className="text-xs text-muted sm:col-span-2">{modelsNote}</p>}
          </fieldset>
          <label className="block text-sm font-medium">
            Working style
            <textarea maxLength={500} rows={2} value={form.workingStyle} onChange={(e) => set("workingStyle", e.target.value)} className={`${field} resize-none`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {choice("style", "Style", ["robot", "orb"])}
            {choice("head", "Head", ["square", "round", "tall"])}
            {choice("eyes", "Eyes", ["dots", "visor", "wide"])}
            {choice("accessory", "Accessory", ["none", "antenna", "headset", "cap"])}
          </div>
          {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => dialog.current?.close()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={busy} className="btn-dark rounded-[10px] px-5 py-2.5 text-sm font-semibold text-paper disabled:opacity-70">{busy ? "Saving..." : "Save"}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
