"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { BRAND_TEMPLATE, BRIEF_TEMPLATE, type ProjectSummaryInfo } from "@/lib/projects";

export function SummaryBox({ base, summary, editable, hasBrief, hasBrand, onChanged, onOpenFile }: {
  base: string;
  summary: ProjectSummaryInfo | null;
  editable: boolean;
  hasBrief: boolean;
  hasBrand: boolean;
  onChanged: () => Promise<unknown>;
  onOpenFile: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function summarize() {
    setBusy(true);
    setError("");
    try {
      await api(`${base}/summarize`, { method: "POST" });
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(path: string, content: string) {
    setError("");
    try {
      await api(`${base}/files`, { method: "PUT", body: { path, content, baseRevision: 0 } });
      await onChanged();
      onOpenFile(path);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <details className="border-b border-line p-2 text-sm" open={!summary}>
      <summary className="cursor-pointer font-medium">
        Project summary
        {summary?.stale && <span className="ml-2 rounded-full bg-[#fff4d6] px-2 py-0.5 text-xs text-[#5c4300]">Out of date</span>}
      </summary>
      {summary ? (
        <>
          <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{summary.text}</p>
          <p className="mt-1 text-xs text-muted">Written {new Date(summary.summarizedAt).toLocaleString()}</p>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">Nova can read the project and write a summary every companion uses.</p>
      )}
      {editable && (
        <button disabled={busy} onClick={summarize} className="btn-light mt-2 rounded-[8px] px-2.5 py-1 text-xs font-semibold disabled:opacity-60">
          {busy ? "Nova is reading your project..." : summary ? "Refresh summary" : "Read my project"}
        </button>
      )}
      <p className="mt-3 text-xs text-muted">Every companion also reads <span className="font-mono">.company/brief.md</span> and <span className="font-mono">.company/brand.md</span> when they exist.</p>
      {editable && (!hasBrief || !hasBrand) && (
        <div className="mt-1 flex gap-2">
          {!hasBrief && <button onClick={() => create(".company/brief.md", BRIEF_TEMPLATE)} className="text-xs underline">Create brief</button>}
          {!hasBrand && <button onClick={() => create(".company/brand.md", BRAND_TEMPLATE)} className="text-xs underline">Create brand kit</button>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[#b42318]">{error}</p>}
    </details>
  );
}
