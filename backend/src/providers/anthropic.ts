import Anthropic from "@anthropic-ai/sdk";
import { errorFromStatus, ProviderError, type ProviderClient } from "./types.js";

function mapError(e: unknown, signal: AbortSignal): unknown {
  if (e instanceof ProviderError) return e;
  if (signal.aborted || e instanceof Anthropic.APIUserAbortError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError("timeout", "The provider took too long to respond.");
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError("network", "Couldn't reach Anthropic.");
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: string } } | undefined;
    return errorFromStatus(e.status ?? 500, body?.error?.message ?? e.message);
  }
  return new ProviderError("unavailable", "Anthropic sent a reply that couldn't be read.");
}

/** Claude through the official SDK. baseURL is only set by tests. */
export function anthropicClient(opts: { apiKey: string; baseURL?: string }): ProviderClient {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0, timeout: 300_000 });
  return {
    async listModels(signal) {
      try {
        const out = [];
        for await (const m of client.models.list({}, { signal })) out.push({ id: m.id, label: m.display_name });
        return out;
      } catch (e) {
        throw mapError(e, signal);
      }
    },
    async *stream({ model, instructions, turns, signal }) {
      try {
        const stream = client.messages.stream({ model, max_tokens: 16000, system: instructions, messages: turns }, { signal });
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { type: "delta", text: ev.delta.text };
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          throw new ProviderError("refused", message.stop_details?.explanation || "Claude declined this request.");
        }
        yield { type: "done", usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }, model: message.model };
      } catch (e) {
        throw mapError(e, signal);
      }
    },
  };
}
