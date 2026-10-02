import { readSse } from "./sse.js";
import { call, ProviderError, toProviderError, type ProviderClient, type Usage } from "./types.js";

/** OpenAI-compatible /chat/completions (Gemini's OpenAI endpoint, OpenRouter, xAI, DeepSeek, Ollama, custom). */
export function openAiChatClient(opts: { baseUrl: string; apiKey: string | null }): ProviderClient {
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}) };
  return {
    async listModels(signal) {
      const res = await call(`${opts.baseUrl}/models`, { headers, signal });
      const body = (await res.json().catch(() => ({}))) as { data?: { id: string }[] };
      return (body.data ?? []).map((m) => ({ id: m.id, label: m.id }));
    },
    async *stream({ model, instructions, turns, signal }) {
      const res = await call(`${opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, messages: [{ role: "system", content: instructions }, ...turns] }),
      });
      let usage: Usage = { inputTokens: null, outputTokens: null };
      let served = model;
      let finished = false;
      try {
        for await (const { data } of readSse(res.body!)) {
          if (data === "[DONE]") {
            finished = true;
            break;
          }
          const chunk = JSON.parse(data);
          if (chunk.error) throw new ProviderError("unavailable", chunk.error.message ?? "The provider reported an error.");
          if (chunk.model) served = chunk.model;
          const text = chunk.choices?.[0]?.delta?.content;
          if (text) yield { type: "delta", text };
          if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? null, outputTokens: chunk.usage.completion_tokens ?? null };
        }
      } catch (e) {
        throw toProviderError(e, signal);
      }
      if (!finished) throw new ProviderError("network", "The reply was cut off before it finished.");
      yield { type: "done", usage, model: served };
    },
  };
}
