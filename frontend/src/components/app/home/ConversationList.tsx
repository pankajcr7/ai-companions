"use client";

import { useEffect, useState } from "react";
import { PencilSimple, Trash } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Conv = { id: string; title: string; updatedAt: string };

export function ConversationList({ activeId, onOpen, onNew, onDeleted, refreshKey }: { activeId: string | null; onOpen: (id: string) => void; onNew: () => void; onDeleted: (id: string, rest: Conv[]) => void; refreshKey: number }) {
  const { wsPath } = useWorkspace();
  const [items, setItems] = useState<Conv[]>([]);
  const path = wsPath("/conversations");
  useEffect(() => {
    api<{ conversations: Conv[] }>(path).then((r) => setItems(r.conversations), () => setItems([]));
  }, [path, refreshKey]);

  async function rename(c: Conv) {
    const title = window.prompt("Rename chat", c.title)?.trim();
    if (!title || title === c.title) return;
    await api(`${path}/${c.id}`, { method: "PATCH", body: { title: title.slice(0, 60) } }).then(
      () => setItems((all) => all.map((x) => (x.id === c.id ? { ...x, title: title.slice(0, 60) } : x))),
      (e) => window.alert((e as Error).message),
    );
  }
  async function remove(c: Conv) {
    if (!window.confirm(`Delete "${c.title}"? This can't be undone.`)) return;
    await api(`${path}/${c.id}`, { method: "DELETE" }).then(
      () => {
        const rest = items.filter((x) => x.id !== c.id);
        setItems(rest);
        onDeleted(c.id, rest);
      },
      (e) => window.alert((e as Error).message),
    );
  }
  return (
    <nav aria-label="Conversations" className="flex h-full flex-col gap-2">
      <button onClick={onNew} className="btn-dark rounded-[10px] px-3 py-2 text-sm font-semibold">New chat</button>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {items.map((c) => (
          <li key={c.id} className={`group flex items-center rounded-[8px] ${c.id === activeId ? "bg-ink text-paper" : "hover:bg-bg"}`}>
            <button onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? "page" : undefined} className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm">
              {c.title}
            </button>
            <button onClick={() => rename(c)} aria-label={`Rename ${c.title}`} title="Rename" className="px-1.5 py-2 opacity-60 hover:opacity-100 focus:opacity-100">
              <PencilSimple size={14} />
            </button>
            <button onClick={() => remove(c)} aria-label={`Delete ${c.title}`} title="Delete" className="px-1.5 py-2 opacity-60 hover:opacity-100 focus:opacity-100">
              <Trash size={14} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
