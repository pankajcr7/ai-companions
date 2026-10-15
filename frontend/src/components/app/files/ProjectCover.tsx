"use client";

import { useEffect, useRef, useState } from "react";
import { Code, FileText, FolderSimple, Globe, ImageSquare } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { staticPreview, type ProjectOverview } from "@/lib/studio";
import { useWorkspace } from "@/lib/workspace";

export function ProjectCover({ projectId, cover, title }: { projectId: string; cover?: ProjectOverview["cover"]; title: string }) {
  const { wsPath } = useWorkspace();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [source, setSource] = useState<{ key: string; text: string } | null>(null);
  const path = cover?.path ?? "";
  const key = `${projectId}:${path}:${cover?.revision ?? 0}`;
  const url = wsPath(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`);
  const kind = cover?.kind;
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "160px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !path || kind === "image" || !/\.(html?|md|txt|csv|tsx?|jsx?|css|json|py)$/i.test(path)) return;
    let cancelled = false;
    api<{ content: string }>(url).then((r) => { if (!cancelled) setSource({ key, text: r.content }); }, () => {});
    return () => { cancelled = true; };
  }, [visible, path, kind, url, key]);
  const text = source?.key === key ? source.text : null;
  const Icon = kind === "website" ? Globe : kind === "image" ? ImageSquare : kind === "document" ? FileText : kind === "code" ? Code : FolderSimple;
  return <div ref={ref} className="studio-project-cover" data-kind={kind ?? "empty"}>
    {visible && kind === "image" ? <>
      {/* eslint-disable-next-line @next/next/no-img-element -- private project assets */}
      <img loading="lazy" src={wsPath(`/projects/${projectId}/download?path=${encodeURIComponent(path)}&v=${cover?.revision}`)} alt={title} />
    </> : text && kind === "website" ? <div className="studio-website-thumbnail" aria-hidden="true"><iframe title={`Thumbnail of ${title}`} srcDoc={staticPreview(text)} sandbox="" tabIndex={-1} /></div>
      : text ? <div className="studio-document-thumbnail" aria-hidden="true"><span><Icon size={15} />{path.split("/").pop()}</span><pre>{text.slice(0, 1200)}</pre></div>
      : <div className="studio-cover-placeholder"><Icon size={36} weight="duotone" /><span>{kind === "website" ? "Website" : kind === "image" ? "Image" : kind === "document" ? "Document" : kind === "code" ? "Code & files" : "Room for your next idea"}</span></div>}
    {kind && <span className="studio-cover-kind"><Icon size={12} />{kind}</span>}
  </div>;
}
