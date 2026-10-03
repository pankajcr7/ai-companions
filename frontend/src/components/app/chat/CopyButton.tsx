"use client";

import { useState } from "react";

/** Copies text; says so when the browser refuses (for example on a plain-HTTP network address). */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }
  return (
    <button type="button" onClick={copy} aria-live="polite" className={`rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium hover:underline ${className}`}>
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy, select the text instead" : label}
    </button>
  );
}
