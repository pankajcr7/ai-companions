import type { ChatMessageDTO } from "./types";

/**
 * True once the server's copy of a stopped reply has arrived: the newest message is an assistant
 * reply that wasn't the newest before sending. Works even when history is capped at 50.
 */
export function replyArrived(messages: ChatMessageDTO[], lastIdBeforeSend: string | null): boolean {
  const last = messages.at(-1);
  return !!last && last.role === "assistant" && last.id !== lastIdBeforeSend;
}
