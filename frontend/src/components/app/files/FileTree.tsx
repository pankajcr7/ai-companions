"use client";

import { useState } from "react";
import { CaretDown, CaretRight, File, Folder } from "@phosphor-icons/react";
import type { TreeEntry } from "@/lib/projects";

export type TreeAction = "rename" | "delete" | "download" | "history" | "newFile" | "newFolder" | "upload";

const item = "block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-bg";

export function FileTree({ entries, selected, filter, editable, onOpen, onAction }: {
  entries: TreeEntry[];
  selected: string | null;
  filter: string;
  editable: boolean;
  onOpen: (path: string) => void;
  onAction: (kind: TreeAction, path: string | null) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const q = filter.trim().toLowerCase();
  const visible = entries.filter((e) => {
    if (q) return e.kind === "file" && e.path.toLowerCase().includes(q);
    const parts = e.path.split("/");
    return !parts.slice(0, -1).some((_, i) => closed.has(parts.slice(0, i + 1).join("/")));
  });
  const toggle = (p: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  // Close the actions menu after choosing an item.
  const run = (e: React.MouseEvent, kind: TreeAction, path: string) => {
    e.currentTarget.closest("details")?.removeAttribute("open");
    onAction(kind, path);
  };

  if (!entries.length) return <p className="p-3 text-sm text-muted">This project is empty.{editable ? " Upload files or create one." : ""}</p>;
  return (
    <ul role="tree" aria-label="Project files" className="text-sm">
      {visible.map((e) => {
        const depth = q ? 0 : e.path.split("/").length - 1;
        const name = q ? e.path : e.path.split("/").pop();
        const isOpen = !closed.has(e.path);
        return (
          <li key={e.path} role="treeitem" aria-selected={selected === e.path} aria-expanded={e.kind === "dir" ? isOpen : undefined} className="group flex items-center">
            <button
              onClick={() => (e.kind === "dir" ? toggle(e.path) : onOpen(e.path))}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] py-1 pr-2 text-left hover:bg-bg ${selected === e.path ? "bg-bg font-medium" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {e.kind === "dir" ? isOpen ? <CaretDown size={12} /> : <CaretRight size={12} /> : <span className="w-3" />}
              {e.kind === "dir" ? <Folder size={14} className="shrink-0 text-muted" /> : <File size={14} className="shrink-0 text-muted" />}
              <span className="truncate">{name}</span>
            </button>
            <details className="relative">
              <summary aria-label={`Actions for ${e.path}`} className="cursor-pointer list-none rounded-[6px] px-1.5 text-muted opacity-60 hover:bg-bg group-hover:opacity-100">⋯</summary>
              <div className="absolute right-0 z-20 mt-1 w-40 rounded-[10px] border border-line bg-paper p-1 shadow-lg">
                {e.kind === "file" && <button onClick={(ev) => run(ev, "download", e.path)} className={item}>Download</button>}
                {e.kind === "file" && <button onClick={(ev) => run(ev, "history", e.path)} className={item}>History</button>}
                {editable && e.kind === "dir" && <button onClick={(ev) => run(ev, "newFile", e.path)} className={item}>New file here</button>}
                {editable && e.kind === "dir" && <button onClick={(ev) => run(ev, "newFolder", e.path)} className={item}>New folder here</button>}
                {editable && <button onClick={(ev) => run(ev, "rename", e.path)} className={item}>Rename or move</button>}
                {editable && <button onClick={(ev) => run(ev, "delete", e.path)} className={`${item} text-[#b42318]`}>Delete</button>}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
