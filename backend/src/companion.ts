import { sizeOf, type ChatTurn } from "./providers/types.js";

export function companionIntro(agent: { name: string; role: string; workingStyle: string }, company: string, department: string | null) {
  return [`You are ${agent.name}, the ${agent.role}${department ? ` in the ${department} department` : ""} at ${company}.`, agent.workingStyle ? `Your working style: ${agent.workingStyle}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function companionInstructions(agent: { name: string; role: string; workingStyle: string }, company: string, department: string | null) {
  return [
    companionIntro(agent, company, department),
    "You are an AI companion in this company's workspace. You can talk and help think things through. You cannot take actions, browse, or open files yet; if asked, say so plainly.",
    "Keep answers clear and concise unless asked for more detail.",
  ].join("\n");
}

/** Keeps the newest turns within maxChars (always the last one), and starts on a user turn. */
export function trimTurns(turns: ChatTurn[], maxChars: number): ChatTurn[] {
  const out: ChatTurn[] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    total += sizeOf(turns[i].content);
    if (total > maxChars && out.length) break;
    out.unshift(turns[i]);
  }
  while (out.length > 1 && out[0].role !== "user") out.shift();
  return out;
}
