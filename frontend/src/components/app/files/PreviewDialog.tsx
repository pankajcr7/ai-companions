"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/** The project's website in a sandboxed frame: scripts run, but in an opaque origin with no access to the app. */
export function PreviewDialog({ projectApi, title, onClose }: { projectApi: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    dialog.current?.showModal();
    api<{ url: string }>(`${projectApi}/preview-token`, { method: "POST" }).then(
      (r) => setUrl(r.url),
      (e) => setError((e as Error).message),
    );
  }, [projectApi]);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="preview-title" className="m-auto h-[min(90dvh,900px)] w-[min(1200px,calc(100vw-24px))] rounded-[16px] border border-line bg-paper p-4 text-ink backdrop:bg-black/50">
      <div className="flex h-full flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="preview-title" className="mr-auto truncate font-semibold">Preview: {title}</h2>
          <button onClick={() => setNonce((n) => n + 1)} disabled={!url} className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">Reload</button>
          {url && <a href={url} target="_blank" rel="noreferrer" className="btn-light rounded-[8px] px-3 py-1.5 text-sm font-semibold">Open in new tab</a>}
          <button onClick={() => dialog.current?.close()} className="rounded-[8px] px-3 py-1.5 text-sm hover:bg-bg">Close</button>
        </div>
        {error && <p role="alert" className="text-sm text-[#b42318]">{error}</p>}
        {!url && !error && <div className="flex-1 animate-pulse rounded-[8px] bg-bg" aria-busy="true" />}
        {url && <iframe key={nonce} src={url} title={`Preview of ${title}`} sandbox="allow-scripts allow-forms" className="min-h-0 w-full flex-1 rounded-[8px] border border-line bg-white" />}
      </div>
    </dialog>
  );
}
