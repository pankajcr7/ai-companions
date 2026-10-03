export type HireSuggestion = { role: string; department: string | null };
export type Suggestion = { goal: string | null; hire: HireSuggestion[]; newProject: boolean; projectName: string | null };

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/** Nova ends a work request with ```json {"suggest":{...}}```; split it from the text the owner reads and copies. */
export function splitSuggestion(content: string): { text: string; suggestion: Suggestion | null } {
  const last = [...content.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1);
  if (!last || last.index === undefined || !/"suggest"\s*:/.test(last[1])) return { text: content, suggestion: null };
  const text = (content.slice(0, last.index) + content.slice(last.index + last[0].length)).trim();
  try {
    const raw = (JSON.parse(last[1]) as { suggest?: { goal?: unknown; hire?: unknown; newProject?: unknown; projectName?: unknown } }).suggest;
    const goal = str(raw?.goal, 4000);
    const hire = (Array.isArray(raw?.hire) ? (raw.hire as { role?: unknown; department?: unknown }[]) : [])
      .map((h) => ({ role: str(h?.role, 60), department: str(h?.department, 60) }))
      .filter((h): h is HireSuggestion => !!h.role)
      .slice(0, 3);
    return { text, suggestion: goal || hire.length ? { goal, hire, newProject: raw?.newProject === true, projectName: str(raw?.projectName, 60) } : null };
  } catch {
    return { text, suggestion: null };
  }
}

/** While a reply streams, hide a suggest block that has started but not finished. */
export function visibleWhileStreaming(text: string): string {
  const i = text.lastIndexOf("```");
  if (i < 0 || (text.slice(0, i).match(/```/g) ?? []).length % 2 === 1) return text; // no fence, or this one closes a block
  const tail = text.slice(i + 3);
  const lang = /^[a-z]*/.exec(tail)?.[0] ?? "";
  if (lang && lang !== "json") return text;
  const start = tail.slice(lang.length).replace(/\s+/g, "").slice(0, 10);
  return '{"suggest"'.startsWith(start) ? text.slice(0, i).trimEnd() : text;
}
