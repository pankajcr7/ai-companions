"use client";

import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { api } from "@/lib/api";
import type { EditDTO } from "@/lib/goals";

/** Side-by-side, read-only: the current file on the left, the companion's proposal on the right. */
export function EditReview({ goalPath, edit, onClose }: { goalPath: string; edit: EditDTO; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{ content: string; current: string | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current?.showModal();
    api<{ edit: { content: string; current: string | null } }>(`${goalPath}/edits/${edit.id}`).then(
      (r) => setData(r.edit),
      (e) => setError((e as Error).message),
    );
  }, [goalPath, edit.id]);

  useEffect(() => {
    if (!data || !host.current) return;
    const ro = [EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping];
    const view = new MergeView({ a: { doc: data.current ?? "", extensions: ro }, b: { doc: data.content, extensions: ro }, parent: host.current });
    return () => view.destroy();
  }, [data]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="edit-title" className="m-auto w-[min(1000px,calc(100vw-32px))] rounded-[16px] border border-line bg-paper p-5 text-ink backdrop:bg-black/40">
      <div className="flex items-center justify-between gap-2">
        <h2 id="edit-title" className="truncate font-mono text-sm font-semibold">{edit.path}</h2>
        <button onClick={() => dialog.current?.close()} className="rounded-[8px] px-2 py-1 text-sm hover:bg-bg">Close</button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {data?.current === null ? "New file. Right: proposed content." : "Left: current file. Right: proposed change."}
        {edit.note ? ` ${edit.note}` : ""}
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-[#b42318]">{error}</p>}
      {!data && !error && <div className="mt-3 h-40 animate-pulse rounded-[8px] bg-bg" aria-busy="true" />}
      <div ref={host} className="mt-3 max-h-[70dvh] overflow-auto rounded-[8px] border border-line text-sm" />
    </dialog>
  );
}
