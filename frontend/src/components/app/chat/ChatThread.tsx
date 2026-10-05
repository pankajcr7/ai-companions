"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { liveLabel } from "@/lib/activity";
import { replyArrived } from "@/lib/chat";
import { readEvents } from "@/lib/sse";
import { splitSuggestion, visibleWhileStreaming, type HireSuggestion } from "@/lib/suggest";
import { CHATGPT_USAGE_URL, type ChatMessageDTO } from "@/lib/types";
import { CopyButton } from "./CopyButton";
import { ChatEditCard } from "./ChatEditCard";
import { RichText } from "./RichText";
import { SuggestionCard } from "./SuggestionCard";
import { ToolActivity } from "./ToolActivity";

type Pending = { sent: string; text: string; stopped?: boolean; error?: { code: string; message: string }; activity?: { name: string; label: string }[] };

/** A streaming chat against any endpoint that speaks the start/delta/error/done SSE protocol. */
export function ChatThread({ initialDraft, path, name, inputLabel, logLabel, placeholder, emptyText, canSend, usageLink, footer, command, onCommandSent, onThinking, suggestions, postPath, extraBody, examples, renderExtra, goalStop, fill, hideMeta }: {
  path: string;
  name: string;
  inputLabel: string;
  logLabel: string;
  placeholder: string;
  emptyText: string;
  canSend: boolean;
  usageLink?: boolean;
  footer?: ReactNode;
  command?: string;
  onCommandSent?: () => void;
  onThinking?: (busy: boolean) => void;
  /** When set, Nova's suggest blocks become cards that plan work or add companions. */
  suggestions?: { onPlan?: (goal: string, newProject: boolean, messageId: string) => Promise<void>; onHire?: (hire: HireSuggestion) => void };
  /** Where messages are sent, when it differs from where history loads. */
  postPath?: string;
  extraBody?: () => Record<string, unknown>;
  /** Example requests shown in an empty chat; clicking one fills the input. */
  examples?: string[];
  /** Extra content under a message, such as the goal it started. */
  renderExtra?: (m: ChatMessageDTO) => ReactNode;
  /** While the team works, Send becomes this Stop button. */
  goalStop?: { label: string; onClick: () => void } | null;
  /** Text already in the input when the chat opens (e.g. "@Lina " from the Team page). */
  initialDraft?: string;
  /** Fill the available height (full-page chat) instead of a fixed-height panel. */
  fill?: boolean;
  /** Hide the model name and token counts (the home chat is for non-technical owners). */
  hideMeta?: boolean;
}) {
  const inputId = useId();
  const [messages, setMessages] = useState<ChatMessageDTO[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(initialDraft ?? "");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api<{ messages: ChatMessageDTO[] }>(path).then((r) => setMessages(r.messages)), [path]);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
    return () => abort.current?.abort();
  }, [load]);
  // Braces matter: scrollIntoView may return a Promise, and React would call a returned value as cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);
  // A message from the office command bar is sent once history has loaded.
  useEffect(() => {
    if (!command || pending || messages === null || !canSend) return;
    onCommandSent?.();
    send(command);
  });

  async function send(text = draft) {
    const message = text.trim();
    if (!message || pending) return;
    if (text === draft) setDraft("");
    setError("");
    setPending({ sent: message, text: "" });
    onThinking?.(true);
    const ac = new AbortController();
    abort.current = ac;
    const lastIdBeforeSend = messages?.at(-1)?.id ?? null;
    let stopped = false;
    try {
      const res = await fetch(postPath ?? path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, ...(extraBody?.() ?? {}) }), signal: ac.signal });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "Couldn't send the message.");
      for await (const ev of readEvents(res)) {
        if (ev.event === "delta") setPending((p) => ({ ...p, sent: message, text: (p?.text ?? "") + (ev.data as { text: string }).text }));
        // A tool event means the text so far was the tool call itself: clear it and show what's happening instead.
        if (ev.event === "reset") setPending((p) => ({ ...p, sent: message, text: "" }));
        if (ev.event === "tool") setPending((p) => ({ ...p, sent: message, text: "", activity: [...(p?.activity ?? []), ev.data as { name: string; label: string }] }));
        if (ev.event === "error") setPending((p) => ({ ...p, sent: message, text: p?.text ?? "", error: ev.data as { code: string; message: string } }));
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      else stopped = true;
    } finally {
      onThinking?.(false);
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
        if (latest) setMessages(latest);
      } else {
        await load().catch(() => {});
      }
      setPending(null);
    }
  }

  const bubble = (role: "user" | "assistant") =>
    role === "user" ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-[14px] bg-ink px-3.5 py-2.5 text-sm text-paper" : "max-w-[94%] min-w-0 rounded-[14px] bg-bg px-3.5 py-2.5 text-sm";

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col gap-3" : "flex flex-col gap-3"}>
      <div role="log" aria-label={logLabel} className={fill ? "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" : "flex max-h-[45dvh] min-h-40 flex-col gap-2 overflow-y-auto pr-1 lg:max-h-[50dvh]"}>
        {messages === null && <div className="h-16 animate-pulse rounded-[12px] bg-bg" aria-busy="true" />}
        {messages?.length === 0 && !pending && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted">{emptyText}</p>
            {examples && (
              <div className="flex flex-wrap justify-center gap-2">
                {examples.map((e) => (
                  <button key={e} type="button" onClick={() => setDraft(e)} className="rounded-full border border-line bg-paper px-3 py-1.5 text-sm hover:border-ink">
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages?.map((m) => {
          const { text, suggestion } = suggestions && m.role === "assistant" ? splitSuggestion(m.content) : { text: m.content, suggestion: null };
          return (
            <div key={m.id} className={bubble(m.role)}>
              {m.role === "user" ? m.content : text ? <RichText text={text} /> : m.status !== "complete" ? <span className="italic text-muted">No reply</span> : null}
              {suggestion && !m.goalId && <SuggestionCard suggestion={suggestion} onPlan={canSend && suggestions?.onPlan ? (goal, newProject) => suggestions.onPlan!(goal, newProject, m.id) : undefined} onHire={canSend ? suggestions?.onHire : undefined} />}
              {m.role === "assistant" && <ToolActivity uses={m.toolUses ?? []} suggestions={m.edits?.length ?? 0} />}
              {m.role === "assistant" && <ChatEditCard edits={m.edits ?? []} canDecide={canSend} onChanged={() => load().catch(() => {})} />}
              {renderExtra?.(m)}
            {m.role === "assistant" && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                <span>
                  {m.status === "stopped" ? "Stopped. " : ""}
                  {m.status === "error" ? `${m.errorMessage} ` : ""}
                  {!hideMeta && m.model}
                  {!hideMeta && m.outputTokens != null ? ` · ${(m.inputTokens ?? 0) + m.outputTokens} tokens` : ""}
                </span>
                {text && <CopyButton text={text} label="Copy message" />}
              </div>
            )}
            {usageLink && m.errorCode === "usage_limit" && (
              <a href={CHATGPT_USAGE_URL} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-[8px] bg-[#0b0d10] px-3 py-1.5 text-xs font-semibold text-white">Manage usage</a>
            )}
            </div>
          );
        })}
        {pending && <div className={bubble("user")}>{pending.sent}</div>}
        {pending && (
          <div className={bubble("assistant")} aria-live="polite" aria-busy={!pending.error}>
            {pending.activity?.length ? <p className="mb-1 text-[11px] text-muted">{liveLabel(pending.activity.at(-1)!)}</p> : null}
            {pending.text ? <RichText text={visibleWhileStreaming(pending.text)} /> : pending.activity?.length ? null : <span className="text-muted">{pending.stopped ? "No reply" : `${name} is thinking...`}</span>}
            {pending.error && <p className="mt-1.5 text-[11px] text-[#b42318]">{pending.error.message}</p>}
            {pending.stopped && <p className="mt-1.5 text-[11px] text-muted">Stopped.</p>}
          </div>
        )}
        <div ref={end} />
      </div>

      {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
      {footer}

      {canSend && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex items-end gap-2"
        >
          <label htmlFor={inputId} className="sr-only">{inputLabel}</label>
          <textarea
            id={inputId}
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
            placeholder={placeholder}
            className="min-w-0 flex-1 resize-none rounded-[12px] border border-line bg-paper px-3 py-2 text-sm focus:border-ink focus:outline-none"
          />
          {pending ? (
            <button type="button" onClick={() => abort.current?.abort()} className="btn-light rounded-[10px] px-4 py-2.5 text-sm font-semibold">Stop</button>
          ) : (
            goalStop ? (
              <button type="button" onClick={goalStop.onClick} className="rounded-[10px] bg-[#c62828] px-4 py-2.5 text-sm font-semibold text-white">■ {goalStop.label}</button>
            ) : (
              <button type="submit" disabled={!draft.trim()} className="btn-dark rounded-[10px] px-4 py-2.5 text-sm font-semibold disabled:opacity-60">Send</button>
            )
          )}
        </form>
      )}
      {canSend && messages && messages.length > 0 && !pending && (
        <button
          onClick={async () => {
            if (!confirm(`Clear this chat with ${name}?`)) return;
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
