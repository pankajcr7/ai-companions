import { afterAll, expect, test } from "vitest";
import { anthropicClient } from "../src/providers/anthropic.js";
import type { StreamEvent } from "../src/providers/types.js";
import { fakeServer, json, sse } from "./fake-provider.js";

function messageEvents(text: string[], stop = "end_turn", extra: Record<string, unknown> = {}) {
  return [
    { event: "message_start", data: { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 21, output_tokens: 1 } } } },
    { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
    ...text.map((t) => ({ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } } })),
    { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
    { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null, ...extra }, usage: { output_tokens: 7 } } },
    { event: "message_stop", data: { type: "message_stop" } },
  ];
}

const fake = await fakeServer({
  "POST /v1/messages": (_q, res) => sse(res, messageEvents(["Hello", " owner"])),
  "GET /v1/models": (_q, res) => json(res, 200, { data: [{ type: "model", id: "claude-test", display_name: "Claude Test", created_at: "2026-01-01T00:00:00Z" }], has_more: false, first_id: "claude-test", last_id: "claude-test" }),
});
afterAll(() => fake.close());

const client = () => anthropicClient({ apiKey: "sk-ant-test", baseURL: fake.url });
const args = { model: "claude-test", instructions: "You are Nova.", turns: [{ role: "user" as const, content: "Hi" }], signal: AbortSignal.timeout(5000) };
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

test("streams text and reports final usage", async () => {
  expect(await collect(client().stream(args))).toEqual([
    { type: "delta", text: "Hello" },
    { type: "delta", text: " owner" },
    { type: "done", usage: { inputTokens: 21, outputTokens: 7 }, model: "claude-test" },
  ]);
  const req = fake.requests.at(-1)!;
  expect(req.headers["x-api-key"]).toBe("sk-ant-test");
  expect(req.body).toMatchObject({ model: "claude-test", max_tokens: 16000, system: "You are Nova.", messages: [{ role: "user", content: "Hi" }] });
  expect(req.body).not.toHaveProperty("thinking");
});

test("a refusal becomes a 'refused' error", async () => {
  fake.routes["POST /v1/messages"] = (_q, res) => sse(res, messageEvents([], "refusal"));
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "refused" });
});

test("SDK errors map to provider errors", async () => {
  fake.routes["POST /v1/messages"] = (_q, res) => json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "auth" });
  fake.routes["POST /v1/messages"] = (_q, res) => json(res, 429, { type: "error", error: { type: "rate_limit_error", message: "slow" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "rate_limited" });
  fake.routes["POST /v1/messages"] = (_q, res) => json(res, 404, { type: "error", error: { type: "not_found_error", message: "model" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "model_unavailable" });
});

test("lists models with display names", async () => {
  expect(await client().listModels(AbortSignal.timeout(5000))).toEqual([{ id: "claude-test", label: "Claude Test" }]);
});
