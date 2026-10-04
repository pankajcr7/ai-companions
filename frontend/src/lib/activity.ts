export type ToolUseDTO = { name: string; label: string; ok: boolean; ms: number; chars: number };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Read 2 files · Searched 1 time · 1 suggested change" for a finished reply. */
export function activitySummary(uses: ToolUseDTO[], suggestions: number): string {
  const count = (name: string) => uses.filter((u) => u.name === name).length;
  const reads = new Set(uses.filter((u) => u.name === "read_file").map((u) => u.label)).size;
  const parts = [
    reads ? `Read ${plural(reads, "file", "files")}` : "",
    count("list_files") ? "Looked through files" : "",
    count("search") ? `Searched ${plural(count("search"), "time", "times")}` : "",
    count("web_search") ? `Searched the web ${plural(count("web_search"), "time", "times")}` : "",
    count("open_url") ? `Opened ${plural(count("open_url"), "page", "pages")}` : "",
    suggestions ? plural(suggestions, "suggested change", "suggested changes") : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function liveLabel(e: { name: string; label: string }): string {
  const what: Record<string, string> = { read_file: "📄 Reading", search: "🔍 Searching", open_url: "🌐 Opening", web_search: "🌐 Searching the web for", write_file: "✏️ Writing", list_files: "📁 Looking through" };
  return `${what[e.name] ?? "Using"} ${e.label}…`;
}
