"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Paperclip, X } from "@phosphor-icons/react";
import { fitWithin, MAX_FILES, needsViewCopy, refusal } from "@/lib/attachments";
import type { AttachmentDTO } from "@/lib/types";

export type PickedItem = { key: string; name: string; size: number; previewUrl: string | null; status: "uploading" | "done" | "error"; progress: number; id?: string; error?: string };

/** A smaller copy of a big photo for the AI to look at; the original still goes to the project. */
async function viewCopy(file: File): Promise<Blob | null> {
  // GIFs get a still copy too: the AI only needs one frame, and animated GIFs are often too big to send.
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return null;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp || !needsViewCopy(file.size, bmp.width, bmp.height)) return null;
  const { w, h } = fitWithin(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", 0.85));
}

function upload(path: string, file: File, view: Blob | null, onProgress: (p: number) => void): Promise<AttachmentDTO> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { error?: { message?: string } } & Partial<AttachmentDTO> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status < 300) resolve(body as AttachmentDTO);
      else reject(new Error(body.error?.message ?? "The upload didn't work. Try again."));
    };
    xhr.onerror = () => reject(new Error("Can't reach the server. Check your connection and try again."));
    const form = new FormData();
    form.append("file", file, file.name);
    if (view) form.append("view", view, "view.webp");
    xhr.send(form);
  });
}

/** Files picked, dropped or pasted for the next message: uploads start at once, Send waits for them. */
export function useAttachments(uploadPath: string | undefined) {
  const [items, setItems] = useState<PickedItem[]>([]);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const live = urls.current;
    return () => live.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  const patch = (key: string, p: Partial<PickedItem>) => setItems((all) => all.map((i) => (i.key === key ? { ...i, ...p } : i)));

  // How many items are picked right now, without reading state inside an updater (uploads must start exactly once).
  const count = useRef(0);
  const add = useCallback(
    (files: File[]) => {
      if (!uploadPath || !files.length) return;
      const room = MAX_FILES - count.current;
      const next = files.map((file, n) => {
        const key = `${Date.now()}-${n}-${Math.random().toString(16).slice(2)}`;
        const previewUrl = file.type.startsWith("image/") && file.type !== "image/svg+xml" ? URL.createObjectURL(file) : null;
        if (previewUrl) urls.current.add(previewUrl);
        const error = n >= room ? `Up to ${MAX_FILES} files per message` : refusal(file);
        const item: PickedItem = { key, name: file.name, size: file.size, previewUrl, status: error ? "error" : "uploading", progress: 0, error: error ?? undefined };
        return { item, file };
      });
      count.current += next.length;
      setItems((current) => [...current, ...next.map((n) => n.item)]);
      for (const { item, file } of next) {
        if (item.status !== "uploading") continue;
        void viewCopy(file)
          .then((view) => upload(uploadPath, file, view, (progress) => patch(item.key, { progress })))
          .then((a) => patch(item.key, { status: "done", progress: 1, id: a.id }))
          .catch((e: Error) => patch(item.key, { status: "error", error: e.message }));
      }
    },
    [uploadPath],
  );
  const remove = (key: string) => {
    count.current = Math.max(0, count.current - 1);
    setItems((all) => {
      const gone = all.find((i) => i.key === key);
      if (gone?.previewUrl) {
        URL.revokeObjectURL(gone.previewUrl);
        urls.current.delete(gone.previewUrl);
      }
      return all.filter((i) => i.key !== key);
    });
  };
  const clear = () => {
    count.current = 0;
    setItems([]);
  };
  return { items, add, remove, clear, uploading: items.some((i) => i.status === "uploading"), ids: items.filter((i) => i.status === "done" && i.id).map((i) => i.id!) };
}

export function AttachButton({ onFiles, disabled, label }: { onFiles: (files: File[]) => void; disabled?: boolean; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Attach files"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} aria-label="Add files" title="Add files (or paste / drop them)" className={label ? "chat-attach-button" : "grid size-10 shrink-0 place-items-center rounded-[10px] border border-line hover:bg-bg disabled:opacity-50"}>
        <Paperclip size={18} />{label && <span>{label}</span>}
      </button>
    </>
  );
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function AttachmentChips({ items, onRemove }: { items: PickedItem[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-2">
      {items.map((i) => (
        <li key={i.key} aria-label={i.name} className={`flex max-w-56 items-center gap-2 rounded-[10px] border px-2 py-1.5 text-xs ${i.status === "error" ? "border-[#e8b4ae] bg-[#fde8e6]" : "border-line bg-paper"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- private uploads and local previews, not optimisable */}
          {i.previewUrl ? <img src={i.previewUrl} alt="" className="size-8 shrink-0 rounded-[6px] object-cover" /> : <FileText size={22} className="shrink-0 text-muted" />}
          <span className="min-w-0">
            <span className="block truncate font-medium">{i.name}</span>
            <span className={`block truncate ${i.status === "error" ? "text-[#7a1b12]" : "text-muted"}`}>{i.status === "error" ? i.error : i.status === "uploading" ? `Uploading ${Math.round(i.progress * 100)}%` : kb(i.size)}</span>
          </span>
          <button type="button" onClick={() => onRemove(i.key)} aria-label={`Remove ${i.name}`} className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-bg">
            <X size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
