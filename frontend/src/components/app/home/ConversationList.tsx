"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

type Conv = { id: string; title: string; updatedAt: string };

export function ConversationList({ activeId, onOpen, onNew, refreshKey }: { activeId: string | null; onOpen: (id: string) => void; onNew: () => void; refreshKey: number }) {
  const { wsPath } = useWorkspace();
  const [items, setItems] = useState<Conv[]>([]);
  const path = wsPath("/conversations");
  useEffect(() => {
    api<{ conversations: Conv[] }>(path).then((r) => setItems(r.conversations), () => setItems([]));
  }, [path, refreshKey]);
  return (
    <nav aria-label="Conversations" className="flex h-full flex-col gap-2">
      <button onClick={onNew} className="btn-dark rounded-[10px] px-3 py-2 text-sm font-semibold">New chat</button>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {items.map((c) => (
          <li key={c.id}>
            <button onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? "page" : undefined} className={`block w-full truncate rounded-[8px] px-2.5 py-2 text-left text-sm ${c.id === activeId ? "bg-ink text-paper" : "hover:bg-bg"}`}>
              {c.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
