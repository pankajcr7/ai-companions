"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { canAdmin, CHATGPT_USAGE_URL, PROVIDER_NAMES, type Connection, type ProviderKind } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

type KeyKind = "openai" | "anthropic" | "gemini" | "custom";
const PRESETS = [
  { id: "openrouter", label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { id: "xai", label: "xAI", url: "https://api.x.ai/v1" },
  { id: "deepseek", label: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { id: "ollama", label: "Ollama (this computer)", url: "http://127.0.0.1:11434/v1" },
  { id: "other", label: "Other", url: "" },
];
const field = "mt-1.5 w-full rounded-[10px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none";
const statusText = (c: Connection) => (c.status === "connected" ? "Connected" : c.status === "reauth" ? "Sign in again" : `Error: ${c.lastError ?? "check failed"}`);

function ChatGptButton({ onClick, busy, label = "Continue with ChatGPT" }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button onClick={onClick} disabled={busy} className="inline-flex items-center gap-2 rounded-[10px] bg-[#0b0d10] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-70">
      <Image src="/logos/openai.svg" alt="" width={16} height={16} className="invert" />
      {busy ? "Opening ChatGPT..." : label}
    </button>
  );
}

function AddForm({ kind, onClose, onSaved }: { kind: KeyKind; onClose: () => void; onSaved: () => void }) {
  const { wsPath } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null);
  const [preset, setPreset] = useState("openrouter");
  const [url, setUrl] = useState(PRESETS[0].url);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setBusy(true);
    setError("");
    try {
      await api(wsPath("/connections"), { method: "POST", body: { kind, label: f.label, apiKey: f.apiKey || undefined, baseUrl: kind === "custom" ? url : undefined } });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const defaultLabel = kind === "custom" ? (PRESETS.find((p) => p.id === preset)?.label ?? "Custom") : PROVIDER_NAMES[kind];
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="add-title" className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-6 text-ink backdrop:bg-black/40">
      <form onSubmit={submit} className="space-y-4">
        <h2 id="add-title" className="text-xl font-semibold">Add {PROVIDER_NAMES[kind]}</h2>
        {kind === "custom" && (
          <>
            <label className="block text-sm font-medium">
              Provider
              <select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  setUrl(PRESETS.find((p) => p.id === e.target.value)?.url ?? "");
                }}
                className={field}
              >
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Base URL
              <input required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/v1" className={field} />
            </label>
          </>
        )}
        <label className="block text-sm font-medium">
          Name
          <input name="label" required maxLength={60} defaultValue={defaultLabel} key={defaultLabel} className={field} />
        </label>
        <label className="block text-sm font-medium">
          API key{kind === "custom" ? " (optional for local servers)" : ""}
          <input name="apiKey" type="password" autoComplete="off" required={kind !== "custom"} className={field} />
        </label>
        <p className="text-xs text-muted">We test the key before saving. It&apos;s stored encrypted and never shown again.</p>
        {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={busy} className="btn-dark rounded-[10px] px-4 py-2.5 text-sm font-semibold disabled:opacity-70">{busy ? "Testing..." : "Test and save"}</button>
        </div>
      </form>
    </dialog>
  );
}

function ProvidersInner() {
  const { snapshot, wsPath, reload } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const admin = canAdmin(snapshot.role);
  const [data, setData] = useState<{ connections: Connection[]; chatgptLocalLogin: boolean } | null>(null);
  const [adding, setAdding] = useState<KeyKind | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<{ connections: Connection[]; chatgptLocalLogin: boolean }>(wsPath("/connections")).then(setData), [wsPath]);
  useEffect(() => {
    load().catch((e) => setNotice({ kind: "error", text: (e as Error).message }));
  }, [load]);

  // Messages from the ChatGPT callback redirect.
  useEffect(() => {
    const err = params.get("chatgpt_error");
    const ok = params.get("connected") === "chatgpt";
    if (!err && !ok) return;
    const t = setTimeout(() => {
      if (err) setNotice({ kind: "error", text: err });
      if (ok) {
        let seen = false;
        try {
          seen = localStorage.getItem(`chatgpt-welcome-${snapshot.workspace.id}`) === "1";
          localStorage.setItem(`chatgpt-welcome-${snapshot.workspace.id}`, "1");
        } catch {}
        if (!seen) setWelcome(true);
        else setNotice({ kind: "ok", text: "ChatGPT is connected." });
      }
      router.replace(`/w/${snapshot.workspace.slug}/providers`);
    }, 0);
    return () => clearTimeout(t);
  }, [params, router, snapshot.workspace.id, snapshot.workspace.slug]);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice({ kind: "ok", text: done });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
      await load().catch(() => {});
      await reload();
    }
  }

  const startChatgpt = (connectionId?: string) =>
    run("chatgpt", async () => {
      const { url } = await api<{ url: string }>(wsPath("/connections/chatgpt/start"), { method: "POST", body: connectionId ? { connectionId } : {} });
      window.location.assign(url);
    });

  const cards: { kind: ProviderKind | "claude"; title: string; text: string; action?: React.ReactNode }[] = [
    {
      kind: "chatgpt",
      title: "Use your ChatGPT plan",
      text: data?.chatgptLocalLogin
        ? "Complete eligible AI requests with usage included in your ChatGPT plan. Works on this computer. Separate from any Agent Company charges."
        : "ChatGPT sign-in works on local or self-hosted installs. A hosted site needs OpenAI's approval first.",
      action: data?.chatgptLocalLogin ? (
        <ChatGptButton onClick={() => startChatgpt()} busy={busy === "chatgpt"} />
      ) : (
        <a href="https://openai.com/form/sign-in-with-chatgpt-interest/" target="_blank" rel="noreferrer" className="text-sm font-medium underline">OpenAI interest form</a>
      ),
    },
    {
      kind: "claude",
      title: "Claude account",
      text: "Anthropic doesn't allow other apps to use Claude logins. Use an Anthropic API key instead.",
      action: <button onClick={() => setAdding("anthropic")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add Anthropic key</button>,
    },
    { kind: "openai", title: "OpenAI API key", text: "Pay per use with your OpenAI platform account.", action: <button onClick={() => setAdding("openai")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add key</button> },
    { kind: "gemini", title: "Google Gemini API key", text: "Use Gemini models with a Google AI Studio key.", action: <button onClick={() => setAdding("gemini")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add key</button> },
    { kind: "custom", title: "Custom endpoint", text: "OpenRouter, xAI, DeepSeek, Ollama, or any OpenAI-compatible URL.", action: <button onClick={() => setAdding("custom")} className="btn-light rounded-[10px] px-4 py-2 text-sm font-semibold">Add endpoint</button> },
  ];

  return (
    <main className="max-w-4xl space-y-8 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold">AI providers</h1>
        <p className="mt-1 text-sm text-muted">Connect the AI services your companions use. Each companion picks one in its Customize form.</p>
      </div>
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`rounded-[10px] px-4 py-3 text-sm ${notice.kind === "error" ? "bg-[#fde8e6] text-[#7a1b12]" : "bg-bg"}`}>
          {notice.text}
        </p>
      )}

      {admin ? (
        <section aria-labelledby="add-heading" className="grid gap-3 sm:grid-cols-2">
          <h2 id="add-heading" className="sr-only">Add a provider</h2>
          {cards.map((c) => (
            <div key={c.kind} className="flex flex-col justify-between gap-4 rounded-[14px] border border-line bg-paper p-5">
              <div>
                <h3 className="font-semibold">{c.title}</h3>
                <p className="mt-1 text-sm text-muted">{c.text}</p>
              </div>
              <div>{c.action}</div>
            </div>
          ))}
        </section>
      ) : (
        <p className="text-sm text-muted">Only owners and admins can add or change providers.</p>
      )}

      <section aria-labelledby="connected-heading">
        <h2 id="connected-heading" className="text-lg font-semibold">Connected</h2>
        {!data && <div className="mt-3 h-20 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
        {data && data.connections.length === 0 && <p className="mt-3 text-sm text-muted">Nothing connected yet. Add a provider above.</p>}
        <ul className="mt-3 space-y-2">
          {data?.connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-paper p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.label} <span className="text-sm font-normal text-muted">{PROVIDER_NAMES[c.kind]}</span>
                </p>
                <p className="truncate text-sm text-muted">
                  {c.hint} · {statusText(c)} · {c.inputTokens + c.outputTokens} tokens used
                </p>
                {c.kind === "chatgpt" && (
                  <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="text-sm underline">Manage usage</a>
                )}
              </div>
              {admin && (
                <div className="flex flex-wrap gap-2">
                  {c.kind === "chatgpt" && c.status === "reauth" && <ChatGptButton onClick={() => startChatgpt(c.id)} busy={busy === "chatgpt"} label="Sign in again" />}
                  <button disabled={!!busy} onClick={() => run(c.id, async () => {
                    const r = await api<{ ok: boolean; models?: number; error?: string }>(wsPath(`/connections/${c.id}/test`), { method: "POST" });
                    if (!r.ok) throw new Error(r.error);
                    setNotice({ kind: "ok", text: `${c.label} works. ${r.models} models available.` });
                  })} className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">{busy === c.id ? "Testing..." : "Test"}</button>
                  {c.kind !== "chatgpt" && (
                    <button disabled={!!busy} onClick={() => {
                      const apiKey = prompt(`New API key for ${c.label}`);
                      if (apiKey) run(c.id, () => api(wsPath(`/connections/${c.id}`), { method: "PATCH", body: { apiKey } }), "Key replaced and tested.");
                    }} className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">Replace key</button>
                  )}
                  <button disabled={!!busy} onClick={() => {
                    const label = prompt("New name", c.label);
                    if (label) run(c.id, () => api(wsPath(`/connections/${c.id}`), { method: "PATCH", body: { label } }));
                  }} className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">Rename</button>
                  <button disabled={!!busy} onClick={() => {
                    if (!confirm(`Remove ${c.label}? Companions using it will need a new AI model.`)) return;
                    run(c.id, async () => {
                      const r = await api<{ revoked: boolean | null }>(wsPath(`/connections/${c.id}`), { method: "DELETE" });
                      if (r.revoked === false) setNotice({ kind: "error", text: "Removed here, but OpenAI didn't confirm the sign-out. Disconnect the app in ChatGPT settings." });
                    });
                  }} className="rounded-[8px] px-3 py-1.5 text-sm font-semibold text-[#b42318] hover:bg-bg">Remove</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {adding && <AddForm kind={adding} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); setNotice({ kind: "ok", text: "Connected." }); load(); reload(); }} />}

      {welcome && (
        <div role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-[16px] bg-paper p-6 text-center">
            <Image src="/logos/openai.svg" alt="" width={36} height={36} className="mx-auto" />
            <h2 id="welcome-title" className="mt-4 text-xl font-semibold">You&apos;re using your ChatGPT plan</h2>
            <p className="mt-2 text-sm text-muted">Eligible AI requests in Agent Company now use your ChatGPT plan. You can manage usage in ChatGPT settings.</p>
            <button autoFocus onClick={() => setWelcome(false)} className="btn-dark mt-5 w-full rounded-[10px] py-2.5 text-sm font-semibold">Got it</button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ProvidersPage() {
  return (
    <Suspense fallback={<div className="p-6 text-muted">Loading providers...</div>}>
      <ProvidersInner />
    </Suspense>
  );
}
