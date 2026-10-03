import type { GoalDTO } from "./goals.ts";

const ALIASES: Record<string, string> = { javascript: "js", typescript: "ts", markdown: "md", python: "py", htm: "html", shell: "sh", bash: "sh" };

/** ```ts title=src/app.ts → { language: "ts", title: "src/app.ts" }; ```app.tsx uses the file name as the title. */
export function fenceInfo(className?: string, meta?: string): { language: string; title: string | null } {
  let language = /language-(\S+)/.exec(className ?? "")?.[1]?.toLowerCase() ?? "";
  let title = /(?:title|file|filename)=["']?([^"'\s]+)/.exec(meta ?? "")?.[1] ?? null;
  if (language.includes(".")) {
    title ??= language;
    language = language.split(".").pop() ?? "";
  }
  return { language: ALIASES[language] ?? language, title };
}

const VERDICT = { meets: ", meets criteria", needs_eyes: ", needs your eyes" } as const;

export function goalAsMarkdown(goal: Pick<GoalDTO, "text" | "summary" | "tasks">): string {
  const parts = [`# ${goal.text}`];
  if (goal.summary) parts.push(`## Summary\n\n${goal.summary}`);
  for (const t of goal.tasks) parts.push(`## ${t.position + 1}. ${t.title} (${t.agentName}, ${t.status}${t.verdict ? VERDICT[t.verdict] : ""})\n\n${t.result ?? t.error ?? "No result."}`);
  return parts.join("\n\n");
}
