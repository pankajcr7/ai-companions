import { readSse } from "./sse.js";
import { call, errorFromStatus, ProviderError, toProviderError, type ProviderClient, type Usage } from "./types.js";

/**
 * OpenAI Responses API. Used for OpenAI API keys and for ChatGPT plan usage (same endpoint).
 * The body sticks to fields ChatGPT plan usage accepts: store false, stream true, no sampling or output caps.
 */
export function openAiResponsesClient(opts: { baseUrl: string; token: () => Promise<string>; modelList: "api" | "chatgpt" }): ProviderClient {
  const headers = async () => ({ "content-type": "application/json", authorization: `Bearer ${await opts.token()}` });
  return {
    async listModels(signal) {
      const res = await call(`${opts.baseUrl}/models`, { headers: await headers(), signal });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { id: string }[];
        models?: { slug: string; display_name?: string; visibility?: string }[];
      };
      if (opts.modelList === "chatgpt") {
        return (body.models ?? []).filter((m) => m.visibility === "list").map((m) => ({ id: m.slug, label: m.display_name ?? m.slug }));
      }
      return (body.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    },
    async *stream({ model, instructions, turns, signal }) {
      const res = await call(`${opts.baseUrl}/responses`, {
        method: "POST",
        headers: await headers(),
        signal,
        body: JSON.stringify({ model, instructions, input: turns.map((t) => ({ role: t.role, content: t.content })), store: false, stream: true }),
      });
      let usage: Usage = { inputTokens: null, outputTokens: null };
      let served = model;
      let completed = false;
      try {
        for await (const { data } of readSse(res.body!)) {
          const ev = JSON.parse(data);
          switch (ev.type) {
            case "response.output_text.delta":
              if (ev.delta) yield { type: "delta", text: ev.delta };
              break;
            case "response.completed":
              completed = true;
              served = ev.response?.model ?? served;
              usage = { inputTokens: ev.response?.usage?.input_tokens ?? null, outputTokens: ev.response?.usage?.output_tokens ?? null };
              break;
            case "response.failed": {
              const err = ev.response?.error ?? {};
              throw errorFromStatus(err.code === "rate_limit_exceeded" ? 429 : 500, err.message ?? "", err.code);
            }
            case "response.incomplete":
              throw new ProviderError("unavailable", `The reply stopped early (${ev.response?.incomplete_details?.reason ?? "unknown reason"}).`);
            case "error":
              throw errorFromStatus(500, ev.message ?? ev.error?.message ?? "", ev.code ?? ev.error?.code);
          }
          if (completed) break;
        }
      } catch (e) {
        throw toProviderError(e, signal);
      }
      if (!completed) throw new ProviderError("network", "The reply was cut off before it finished.");
      yield { type: "done", usage, model: served };
    },
  };
}
