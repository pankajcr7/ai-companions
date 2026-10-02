"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { replyArrived } from "@/lib/chat";
import { readEvents } from "@/lib/sse";
import { canEdit, CHATGPT_USAGE_URL, type Agent, type ChatMessageDTO } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

type Pending = { sent: string; text: string; stopped?: boolean; error?: { code: string; message: string } };

export function CompanionChat({ agent, onEdit, onThinking, command, onCommandSent }: { agent: Agent; onEdit: () => void; onThinking: (busy: boolean) => void; command?: string; onCommandSent?: () => void }) {
  const { snapshot, wsPath } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessageDTO[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const conn = snapshot.connections.find((c) => c.id === agent.connectionId);
  const path = wsPath(`/agents/${agent.id}/chat`);

  const load = useCallback(() => api<{ messages: ChatMessageDTO[] }>(path).then((r) => setMessages(r.messages)), [path]);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
    return () => abort.current?.abort();
  }, [load]);
  // Braces matter: scrollIntoView may return a Promise, and React would call a returned value as cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);
  // A message typed in the office command bar is sent once this chat's history has loaded.
  useEffect(() => {
    if (!command || pending || messages === null || !canEdit(snapshot.role) || !conn || !agent.model) return;
    onCommandSent?.();
    send(command);
  });

  if (!canEdit(snapshot.role)) return <p className="p-1 text-sm text-muted">Viewers can&apos;t chat with companions.</p>;
  if (!conn || !agent.model) {
    return (
      <div className="rounded-[12px] border border-dashed border-line p-5 text-center">
        <p className="font-medium">Choose an AI model for {agent.name} first</p>
        <p className="mt-1 text-sm text-muted">Pick a provider and model in the Customize form.</p>
        <button onClick={onEdit} className="btn-dark mt-4 rounded-[10px] px-4 py-2 text-sm font-semibold">Choose a model</button>
      </div>
    );
  }

  async function send(text = draft) {
    const message = text.trim();
    if (!message || pending) return;
    if (text === draft) setDraft("");
    setError("");
    setPending({ sent: message, text: "" });
    onThinking(true);
    const ac = new AbortController();
    abort.current = ac;
    const lastIdBeforeSend = messages?.at(-1)?.id ?? null;
    let stopped = false;
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }), signal: ac.signal });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "Couldn't send the message.");
      for await (const ev of readEvents(res)) {
        if (ev.event === "delta") setPending((p) => ({ sent: message, text: (p?.text ?? "") + (ev.data as { text: string }).text }));
        if (ev.event === "error") setPending((p) => ({ sent: message, text: p?.text ?? "", error: ev.data as { code: string; message: string } }));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      else stopped = true;
    } finally {
      onThinking(false);
      abort.current = null;
      if (stopped) {
        // The server saves the stopped reply a moment later; keep it on screen until the saved copy arrives.
        setPending((p) => (p ? { ...p, stopped: true } : p));
        let latest: ChatMessageDTO[] | null = null;
        for (let i = 0; i < 8; i++) {
          const r = await api<{ messages: ChatMessageDTO[] }>(path).catch(() => null);
          if (r) latest = r.messages;
          if (latest && replyArrived(latest, lastIdBeforeSend)) break;
          await new Promise((res) => setTimeout(res, 1000));
        }
        // Always show the newest history we got, even if the stopped reply never appeared.
        if (latest) setMessages(latest);
      } else {
        await load().catch(() => {});
      }
      setPending(null);
    }
  }

  const bubble = (role: "user" | "assistant") => `max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2.5 text-sm ${role === "user" ? "ml-auto bg-ink text-paper" : "bg-bg"}`;
  const usageLimit = (code?: string | null) => code === "usage_limit" && conn.kind === "chatgpt";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[45dvh] min-h-40 flex-col gap-2 overflow-y-auto pr-1 lg:max-h-[50dvh]" aria-label={`Chat with ${agent.name}`}>
        {messages === null && <div className="h-16 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
        {messages?.length === 0 && !pending && <p className="py-6 text-center text-sm text-muted">Say hello to {agent.name}.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={bubble(m.role)}>
            {m.content || (m.status !== "complete" ? <span className="italic text-muted">No reply</span> : null)}
            {m.role === "assistant" && (
              <p className="mt-1.5 text-[11px] text-muted">
                {m.status === "stopped" ? "Stopped. " : ""}
                {m.status === "error" ? `${m.errorMessage} ` : ""}
                {m.model}
                {m.outputTokens != null ? ` · ${(m.inputTokens ?? 0) + m.outputTokens} tokens` : ""}
              </p>
            )}
            {usageLimit(m.errorCode) && (
              <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-[8px] bg-[#0b0d10] px-3 py-1.5 text-xs font-semibold text-white">Manage usage</a>
            )}
          </div>
        ))}
        {pending && <div className={bubble("user")}>{pending.sent}</div>}
        {pending && (
          <div className={bubble("assistant")} aria-live="polite" aria-busy={!pending.error}>
            {pending.text || <span className="text-muted">{pending.stopped ? "No reply" : `${agent.name} is thinking...`}</span>}
            {pending.error && <p className="mt-1.5 text-[11px] text-[#b42318]">{pending.error.message}</p>}
            {pending.stopped && <p className="mt-1.5 text-[11px] text-muted">Stopped.</p>}
          </div>
        )}
        <div ref={end} />
      </div>

      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}

      {conn.kind === "chatgpt" && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Image src="/logos/openai.svg" alt="" width={12} height={12} /> Using ChatGPT plan ·
          <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="underline">Manage usage</a>
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2"
      >
        <label htmlFor={`chat-${agent.id}`} className="sr-only">Message {agent.name}</label>
        <textarea
          id={`chat-${agent.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={8000}
          placeholder={`Message ${agent.name}...`}
          className="min-w-0 flex-1 resize-none rounded-[12px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
        />
        {pending ? (
          <button type="button" onClick={() => abort.current?.abort()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Stop</button>
        ) : (
          <button type="submit" disabled={!draft.trim()} className="btn-dark rounded-[10px] px-4 py-2.5 text-sm font-semibold disabled:opacity-60">Send</button>
        )}
      </form>
      {messages && messages.length > 0 && !pending && (
        <button
          onClick={async () => {
            if (!confirm(`Clear your chat with ${agent.name}?`)) return;
            await api(path, { method: "DELETE" }).catch((e) => setError((e as Error).message));
            await load();
          }}
          className="self-start text-xs text-muted underline"
        >
          Clear chat
        </button>
      )}
    </div>
  );
}
