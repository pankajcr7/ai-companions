"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadSimple, PencilLine, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { PhoneScreen } from "@/lib/screens";

const W = 390;
const H = 844;
const SCALE = 0.5;

/** The project's preview address up to its token, so every screen can share one link. */
function usePreviewPrefix(base: string, first: string | undefined) {
  const [prefix, setPrefix] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!first) return;
    let cancelled = false;
    api<{ url: string }>(`${base}/preview-token`, { method: "POST", body: { path: first } }).then(
      (r) => { if (!cancelled) setPrefix(`${r.url.split("/").slice(0, 4).join("/")}/`); },
      (e: Error) => { if (!cancelled) setError(e.message); },
    );
    return () => { cancelled = true; };
  }, [base, first]);
  return { prefix, error };
}

const src = (prefix: string, path: string) => prefix + path.split("/").map(encodeURIComponent).join("/");

/** A screen in a phone frame. A thumbnail ignores clicks so the button around it gets them; the full-size view is interactive. */
function Phone({ url, title, scale, interactive = false }: { url: string; title: string; scale: number; interactive?: boolean }) {
  return (
    <div style={{ width: W * scale, height: H * scale }} className="overflow-hidden rounded-[28px] border-[3px] border-[#1f2328] bg-white shadow-sm">
      <iframe src={url} title={title} loading="lazy" sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" style={{ width: W, height: H, transform: `scale(${scale})`, transformOrigin: "top left", border: 0, pointerEvents: interactive ? "auto" : "none" }} />
    </div>
  );
}

/** Every app screen side by side in a phone frame; click one for full size. */
export function PhoneScreens({ base, screens, onAsk }: { base: string; screens: PhoneScreen[]; onAsk?: (path: string) => void }) {
  const { prefix, error } = usePreviewPrefix(base, screens[0]?.path);
  const [open, setOpen] = useState<PhoneScreen | null>(null);
  if (error) return <p role="alert" className="p-4 text-sm">{error}</p>;
  if (!prefix) return <div className="studio-preview-loading" aria-busy="true" aria-label="Loading screens" />;
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${W * SCALE}px, 1fr))` }}>
        {screens.map((s) => (
          <figure key={s.path} className="flex flex-col items-center gap-2">
            <figcaption className="text-sm font-semibold">{s.name}</figcaption>
            <button onClick={() => setOpen(s)} aria-label={`Open ${s.name} full size`} className="rounded-[30px]">
              <Phone url={src(prefix, s.path)} title={`${s.name} screen`} scale={SCALE} />
            </button>
            {onAsk && <button onClick={() => onAsk(s.path)} aria-label={`Ask for changes to ${s.name}`} className="studio-secondary text-xs"><PencilLine size={13} />Ask for changes</button>}
          </figure>
        ))}
      </div>
      <a href={`${base}/download.zip`} className="studio-secondary self-start"><DownloadSimple size={15} />Download screens</a>
      {open && <FullSize url={src(prefix, open.path)} name={open.name} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FullSize({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const scale = typeof window === "undefined" ? 1 : Math.min(1, (window.innerHeight - 120) / H);
  return (
    // React passes "close" up its tree: stop it here so the gallery dialog around this one stays open.
    <dialog ref={dialog} aria-label={name} onClose={(e) => { e.stopPropagation(); onClose(); }} className="rounded-[16px] bg-paper p-4 backdrop:bg-black/50">
      <div className="mb-3 flex items-center justify-between gap-4"><h2 className="font-semibold">{name}</h2><button onClick={() => dialog.current?.close()} aria-label="Close" className="studio-icon-button"><X size={18} /></button></div>
      <Phone url={url} title={`${name} screen, full size`} scale={scale} interactive />
    </dialog>
  );
}

/** The gallery in its own dialog, for the project page. */
export function PhoneScreensDialog({ base, screens, onClose }: { base: string; screens: PhoneScreen[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} aria-label="Phone screens" onClose={onClose} className="w-[min(1100px,95vw)] rounded-[16px] bg-paper p-0 backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-semibold">Phone screens</h2><button onClick={() => dialog.current?.close()} aria-label="Close" className="studio-icon-button"><X size={18} /></button></div>
      <PhoneScreens base={base} screens={screens} />
    </dialog>
  );
}
