import { decryptSecret } from "../crypto.js";
import { testOverride } from "../env.js";
import type { ProviderKind } from "../generated/prisma/client.js";
import { anthropicClient } from "./anthropic.js";
import { openAiChatClient } from "./openai-chat.js";
import { openAiResponsesClient } from "./openai-responses.js";
import { ProviderError, type ProviderClient } from "./types.js";

export const PRESETS = {
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  ollama: "http://127.0.0.1:11434/v1",
} as const;

export type ConnectionLike = { id: string; kind: ProviderKind; baseUrl: string | null; secret: string | null };

export const openaiBase = () => testOverride("TEST_OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
const geminiBase = () => testOverride("TEST_GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai";

export function clientFor(conn: ConnectionLike): ProviderClient {
  const secret = conn.secret ? decryptSecret(conn.secret) : null;
  switch (conn.kind) {
    case "openai":
      return openAiResponsesClient({ baseUrl: openaiBase(), token: async () => secret ?? "", modelList: "api" });
    case "anthropic":
      return anthropicClient({ apiKey: secret ?? "", baseURL: testOverride("TEST_ANTHROPIC_BASE_URL") });
    case "gemini":
      return openAiChatClient({ baseUrl: geminiBase(), apiKey: secret });
    case "custom":
      return openAiChatClient({ baseUrl: conn.baseUrl ?? "", apiKey: secret });
    case "chatgpt":
      throw new ProviderError("unsupported", "ChatGPT connections are not available yet.");
  }
}
