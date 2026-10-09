import { safeFetch, UnsafeUrlError, type SafeInit } from "../safe-fetch.js";

export type Part = { type: "text"; text: string } | { type: "image"; mime: string; data: string } | { type: "pdf"; name: string; data: string };
export type ChatTurn = { role: "user" | "assistant"; content: string | Part[] };
export const textOf = (c: ChatTurn["content"]) => (typeof c === "string" ? c : c.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n"));
/** History budgets count a picture as 1,500 characters and a PDF as 3,000. */
export const sizeOf = (c: ChatTurn["content"]) => (typeof c === "string" ? c.length : c.reduce((n, p) => n + (p.type === "text" ? p.text.length : p.type === "image" ? 1500 : 3000), 0));
export const hasMedia = (turns: ChatTurn[]) => turns.some((t) => typeof t.content !== "string" && t.content.some((p) => p.type !== "text"));
export const withoutMedia = (turns: ChatTurn[]): ChatTurn[] =>
  turns.map((t) => (typeof t.content === "string" ? t : { ...t, content: t.content.flatMap((p): Part[] => (p.type === "text" ? [p] : p.type === "image" ? [{ type: "text", text: "[image attached — this AI model can't see images]" }] : [])) }));
const dataUrl = (mime: string, data: string) => `data:${mime};base64,${data}`;
type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export const toChatParts = (c: ChatTurn["content"]): string | ChatPart[] =>
  typeof c === "string" ? c : c.flatMap((p): ChatPart[] => (p.type === "text" ? [{ type: "text", text: p.text }] : p.type === "image" ? [{ type: "image_url", image_url: { url: dataUrl(p.mime, p.data) } }] : []));
export const toResponsesParts = (c: ChatTurn["content"]) =>
  typeof c === "string" ? c : c.map((p) => (p.type === "text" ? { type: "input_text", text: p.text } : p.type === "image" ? { type: "input_image", image_url: dataUrl(p.mime, p.data) } : { type: "input_file", filename: p.name, file_data: dataUrl("application/pdf", p.data) }));
export const toAnthropicParts = (c: ChatTurn["content"]) =>
  typeof c === "string" ? c : c.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : p.type === "image" ? { type: "image" as const, source: { type: "base64" as const, media_type: p.mime as "image/png", data: p.data } } : { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: p.data } }));
export type Usage = { inputTokens: number | null; outputTokens: number | null };
export type StreamEvent = { type: "delta"; text: string } | { type: "done"; usage: Usage; model: string };
export type ModelInfo = { id: string; label: string };
export type StreamArgs = { model: string; instructions: string; turns: ChatTurn[]; signal: AbortSignal };

export interface ProviderClient {
  listModels(signal: AbortSignal): Promise<ModelInfo[]>;
  stream(args: StreamArgs): AsyncIterable<StreamEvent>;
}

export type ProviderErrorCode =
  | "auth" | "reauth" | "rate_limited" | "usage_limit" | "not_eligible" | "model_unavailable"
  | "unsupported" | "refused" | "bad_request" | "unavailable" | "timeout" | "network";

const RETRYABLE: ProviderErrorCode[] = ["rate_limited", "unavailable", "network", "timeout"];

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
  get retryable() {
    return RETRYABLE.includes(this.code);
  }
}

const BY_CODE: Record<string, [ProviderErrorCode, string]> = {
  subscription_sharing_usage_limit_exceeded: ["usage_limit", "ChatGPT usage limit reached. Review it in ChatGPT settings."],
  subscription_sharing_user_not_eligible: ["not_eligible", "ChatGPT plan use isn't available for this account or workspace."],
  subscription_sharing_unsupported_capability: ["unsupported", "This request uses something ChatGPT plan usage doesn't support."],
  subscription_sharing_route_not_supported: ["unsupported", "This request isn't supported with ChatGPT plan usage."],
  subscription_sharing_invalid_user: ["reauth", "Sign in to ChatGPT again to keep using it."],
  subscription_sharing_usage_unavailable: ["unavailable", "ChatGPT usage couldn't be checked right now. Try again shortly."],
  subscription_sharing_user_unavailable: ["unavailable", "ChatGPT is temporarily unavailable. Try again shortly."],
  invalid_api_key: ["auth", "The provider rejected the key."],
  insufficient_quota: ["usage_limit", "This provider account is out of credits or over its quota."],
  rate_limit_exceeded: ["rate_limited", "Rate limited by the provider. Try again shortly."],
  model_not_found: ["model_unavailable", "That model isn't available on this connection."],
};

export function errorFromStatus(status: number, message: string, code?: string): ProviderError {
  const known = code ? BY_CODE[code] : undefined;
  if (known) return new ProviderError(known[0], known[1], status);
  if (status === 401) return new ProviderError("auth", "The provider rejected the key.", status);
  if (status === 403) return new ProviderError("auth", message || "The provider refused access.", status);
  if (status === 404) return new ProviderError("model_unavailable", "That model or endpoint isn't available on this connection.", status);
  if (status === 429) return new ProviderError("rate_limited", "Rate limited by the provider. Try again shortly.", status);
  if (status >= 500) return new ProviderError("unavailable", "The provider is having trouble right now.", status);
  return new ProviderError("bad_request", message || `The provider returned an error (${status}).`, status);
}

/** Normalises fetch/stream failures. A user abort is returned unchanged so callers can tell it apart. */
export function toProviderError(e: unknown, signal?: AbortSignal): unknown {
  if (e instanceof ProviderError) return e;
  if (signal?.aborted) return e;
  const cause = (e as { cause?: unknown })?.cause;
  if (e instanceof UnsafeUrlError || cause instanceof UnsafeUrlError) return new ProviderError("bad_request", ((cause ?? e) as Error).message);
  const code = String((cause as { code?: string })?.code ?? (e as { code?: string })?.code ?? "");
  if (/TIMEOUT/.test(code) || (e as Error)?.name === "TimeoutError") return new ProviderError("timeout", "The provider took too long to respond.");
  if (/redirect/i.test(String((cause as Error)?.message ?? ""))) return new ProviderError("bad_request", "The provider redirected the request, which isn't allowed.");
  if (e instanceof SyntaxError) return new ProviderError("unavailable", "The provider sent a reply that couldn't be read.");
  return new ProviderError("network", "Couldn't reach the provider.");
}

export async function call(url: string, init: SafeInit) {
  let res;
  try {
    res = await safeFetch(url, init);
  } catch (e) {
    throw toProviderError(e, init.signal);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } | string; message?: string } | null;
    const err = typeof body?.error === "object" ? body.error : undefined;
    throw errorFromStatus(res.status, err?.message ?? body?.message ?? "", err?.code);
  }
  return res;
}
