"use client";

import { useEffect, useState } from "react";
import { ChatCircle, Check, DotsThree, MagnifyingGlass, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Conv = { id: string; title: string; updatedAt: string };

export function ConversationList({ activeId, onOpen, onNew, onDeleted, refreshKey, editable = true, creating = false }: { activeId: string | null; onOpen: (id: string) => void; onNew: () => void; onDeleted: (id: string, rest: Conv[]) => void; refreshKey: number; editable?: boolean; creating?: boolean }) {
  const { wsPath } = useWorkspace();
  const [items, setItems] = useState<Conv[] | null>(null);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const path = wsPath("/conversations");
  useEffect(() => {
    let current = true;
    api<{ conversations: Conv[] }>(path).then(
      (r) => { if (current) { setItems(r.conversations); setError(""); } },
      (e) => { if (current) setError((e as Error).message); },
    );
    return () => { current = false; };
  }, [path, refreshKey, retry]);

  async function rename(c: Conv) {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`${path}/${c.id}`, { method: "PATCH", body: { title: title.trim() } });
      setItems((all) => all?.map((x) => x.id === c.id ? { ...x, title: title.trim() } : x) ?? []);
      setEditing(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove(c: Conv) {
    setBusy(true);
    setError("");
    try {
      await api(`${path}/${c.id}`, { method: "DELETE" });
      const rest = (items ?? []).filter((x) => x.id !== c.id);
      setItems(rest);
      setDeleting(null);
      onDeleted(c.id, rest);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const filtered = items?.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
  return (
    <nav aria-label="Conversations" className="conversation-list">
      {editable && <button onClick={() => { setQuery(""); onNew(); }} disabled={creating} className="new-chat-button"><Plus size={18} /><span>{creating ? "Opening chat…" : "New chat"}</span><PencilSimple size={16} className="ml-auto opacity-60" /></button>}
      <h2 className="conversation-heading">Recent chats</h2>
      {(items?.length ?? 0) > 5 && <label className="conversation-search"><MagnifyingGlass size={16} /><input type="search" aria-label="Search chats" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} /></label>}
      {error && <p role="alert" className="px-2 text-xs text-[#b42318]">{error} <button onClick={() => setRetry((n) => n + 1)} className="underline">Try again</button></p>}
      {!items && !error && <div className="space-y-2 p-2" aria-label="Loading chats" aria-busy="true"><div className="h-8 animate-pulse rounded-lg bg-bg" /><div className="h-8 animate-pulse rounded-lg bg-bg" /></div>}
      {items?.length === 0 && <p className="px-3 text-xs leading-relaxed text-muted">Your conversations will appear here.</p>}
      {items && items.length > 0 && filtered?.length === 0 && <p className="px-3 text-xs text-muted">No chats match your search.</p>}
      <ul className="conversation-items">
        {filtered?.map((c) => (
          <li key={c.id}>
            {editing === c.id ? (
              <form className="conversation-rename" onSubmit={(e) => { e.preventDefault(); void rename(c); }}>
                <input autoFocus aria-label="Chat name" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }} />
                <button disabled={busy || !title.trim()} aria-label="Save chat name"><Check size={16} /></button>
                <button type="button" onClick={() => setEditing(null)} aria-label="Cancel rename"><X size={16} /></button>
              </form>
            ) : (
              <div className="conversation-row" data-active={c.id === activeId}>
                <button onClick={() => { setMenu(null); onOpen(c.id); }} aria-current={c.id === activeId ? "page" : undefined} className="conversation-open" title={c.title}><ChatCircle size={16} /><span>{c.title}</span></button>
                {editable && <button onClick={() => setMenu(menu === c.id ? null : c.id)} aria-expanded={menu === c.id} aria-label={`Options for ${c.title}`} className="conversation-options"><DotsThree size={21} weight="bold" /></button>}
              </div>
            )}
            {menu === c.id && <div className="conversation-actions"><button onClick={() => { setTitle(c.title); setEditing(c.id); setMenu(null); }}><PencilSimple size={14} />Rename</button><button onClick={() => { setDeleting(c.id); setMenu(null); }}><Trash size={14} />Delete</button></div>}
            {deleting === c.id && <div className="conversation-confirm"><p>Delete this chat? This can’t be undone.</p><div><button disabled={busy} onClick={() => remove(c)} className="text-[#b42318]">Delete chat</button><button disabled={busy} onClick={() => setDeleting(null)}>Keep chat</button></div></div>}
          </li>
        ))}
      </ul>
    </nav>
  );
}
