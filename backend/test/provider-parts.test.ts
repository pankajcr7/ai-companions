import { afterAll, expect, test } from "vitest";
import { anthropicClient } from "../src/providers/anthropic.js";
import { openAiChatClient } from "../src/providers/openai-chat.js";
import { openAiResponsesClient } from "../src/providers/openai-responses.js";
import { hasMedia, sizeOf, withoutMedia, type ChatTurn } from "../src/providers/types.js";
import { fakeServer, sse } from "./fake-provider.js";

const fake = await fakeServer({
  "POST /v1/chat/completions": (_q, res) => sse(res, [JSON.stringify({ choices: [{ delta: { content: "ok" } }] }), "[DONE]"]),
  "POST /v1/responses": (_q, res) => sse(res, [JSON.stringify({ type: "response.output_text.delta", delta: "ok" }), JSON.stringify({ type: "response.completed", response: { model: "m", usage: {} } })]),
  "POST /v1/messages": (_q, res) =>
    sse(res, [
      { event: "message_start", data: { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } } },
      { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } } },
      { event: "message_stop", data: { type: "message_stop" } },
    ]),
});
afterAll(() => fake.close());

const turns: ChatTurn[] = [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image", mime: "image/png", data: "AAAA" }, { type: "pdf", name: "menu.pdf", data: "JVBE" }] }];
const drain = async (it: AsyncIterable<unknown>) => {
  for await (const _ of it) void _;
};
const last = (path: string) => fake.requests.filter((r) => r.path === path).at(-1)!.body as Record<string, unknown>;

test("OpenAI-compatible chat gets text and image_url parts; PDFs go as text only", async () => {
  await drain(openAiChatClient({ baseUrl: `${fake.url}/v1`, apiKey: "k" }).stream({ model: "m", instructions: "sys", turns, signal: new AbortController().signal }));
  const msg = (last("/v1/chat/completions").messages as { content: unknown }[])[1];
  expect(msg.content).toEqual([{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
});

test("Responses gets input_text, input_image and input_file", async () => {
  await drain(openAiResponsesClient({ baseUrl: `${fake.url}/v1`, token: async () => "t", modelList: "api" }).stream({ model: "m", instructions: "sys", turns, signal: new AbortController().signal }));
  const input = last("/v1/responses").input as { content: unknown }[];
  expect(input[0].content).toEqual([
    { type: "input_text", text: "What is this?" },
    { type: "input_image", image_url: "data:image/png;base64,AAAA" },
    { type: "input_file", filename: "menu.pdf", file_data: "data:application/pdf;base64,JVBE" },
  ]);
});

test("Anthropic gets text, image and document blocks", async () => {
  await drain(anthropicClient({ apiKey: "k", baseURL: fake.url }).stream({ model: "claude", instructions: "sys", turns, signal: new AbortController().signal }));
  const messages = last("/v1/messages").messages as { content: unknown }[];
  expect(messages[0].content).toEqual([
    { type: "text", text: "What is this?" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBE" } },
  ]);
});

test("plain string turns are unchanged; media helpers count and strip pictures", () => {
  expect(hasMedia(turns)).toBe(true);
  expect(hasMedia([{ role: "user", content: "hi" }])).toBe(false);
  expect(sizeOf(turns[0].content)).toBe("What is this?".length + 1500 + 3000);
  expect(withoutMedia(turns)[0].content).toEqual([{ type: "text", text: "What is this?" }, { type: "text", text: "[image attached — this AI model can't see images]" }]);
});
