export type Suggestion = { goal: string | null; hire: { role: string; department: string | null }[]; newProject: boolean; projectName: string | null };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/** Nova's trailing ```json {"suggest":{...}}``` block; mirrors frontend/src/lib/suggest.ts. */
export function parseSuggestion(content: string): Suggestion | null {
  const last = [...content.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1);
  if (!last || !/"suggest"\s*:/.test(last[1])) return null;
  try {
    const raw = (JSON.parse(last[1]) as { suggest?: { goal?: unknown; hire?: unknown; newProject?: unknown; projectName?: unknown } }).suggest;
    const goal = str(raw?.goal, 4000);
    const hire = (Array.isArray(raw?.hire) ? (raw.hire as { role?: unknown; department?: unknown }[]) : [])
      .map((h) => ({ role: str(h?.role, 60), department: str(h?.department, 60) }))
      .filter((h): h is { role: string; department: string | null } => !!h.role)
      .slice(0, 3);
    return goal || hire.length ? { goal, hire, newProject: raw?.newProject === true, projectName: str(raw?.projectName, 60) } : null;
  } catch {
    return null;
  }
}
