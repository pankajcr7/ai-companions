import type { GoalStatus } from "./goals.ts";

export type OutputKind = "website" | "image" | "document" | "code" | "file";
export type ProjectOverview = {
  cover: { path: string; revision: number; kind: OutputKind } | null;
  goal: { id: string; text: string; status: GoalStatus; done: number; total: number; pendingEdits: number; agentIds: string[] } | null;
};

export function outputKind(path: string): OutputKind {
  if (/\.html?$/i.test(path)) return "website";
  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(path)) return "image";
  if (/\.(md|txt|csv|pdf|docx?|xlsx?|pptx?)$/i.test(path)) return "document";
  if (/\.(tsx?|jsx?|css|json|py|sql|ya?ml)$/i.test(path)) return "code";
  return "file";
}

export function projectState(overview?: ProjectOverview): { label: string; kind: string } {
  const g = overview?.goal;
  if (!g) return { label: "Ready to work", kind: "ready" };
  if (["planning", "running", "reviewing"].includes(g.status)) return { label: "Working", kind: "working" };
  if (g.status === "awaiting_approval" || g.pendingEdits > 0) return { label: "Needs your review", kind: "review" };
  if (g.status === "done") return { label: "Finished", kind: "done" };
  return { label: g.status === "failed" ? "Needs attention" : "Paused", kind: "paused" };
}

// Thumbnail HTML never runs code or makes network requests. The full preview is opened explicitly.
export function staticPreview(html: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><style>html{overflow:hidden}body{pointer-events:none}</style>${html}`;
}

export function friendlyDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently updated" : `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
