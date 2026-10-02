import { afterAll, expect, test } from "vitest";
import { openAiResponsesClient } from "../src/providers/openai-responses.js";
import type { StreamEvent } from "../src/providers/types.js";
import { fakeServer, json, sse } from "./fake-provider.js";

const ok = [
  { event: "response.created", data: { type: "response.created", response: { model: "gpt-x" } } },
  { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Hi " } },
  { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "there" } },
  { event: "response.completed", data: { type: "response.completed", response: { model: "gpt-x-2026", usage: { input_tokens: 30, output_tokens: 4 } } } },
];
const fake = await fakeServer({
  "POST /v1/responses": (_q, res) => sse(res, ok),
  "GET /v1/models": (_q, res) => json(res, 200, { data: [{ id: "gpt-x" }] }),
});
afterAll(() => fake.close());

const make = (modelList: "api" | "chatgpt" = "api") =>
  openAiResponsesClient({ baseUrl: `${fake.url}/v1`, token: async () => "tok-123", modelList });
const args = {
  model: "gpt-x",
  instructions: "You are Nova.",
  turns: [{ role: "user" as const, content: "Hello" }, { role: "assistant" as const, content: "Hi" }, { role: "user" as const, content: "Again" }],
  signal: AbortSignal.timeout(5000),
};
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};

test("streams deltas and finishes only on response.completed", async () => {
  expect(await collect(make().stream(args))).toEqual([
    { type: "delta", text: "Hi " },
    { type: "delta", text: "there" },
    { type: "done", usage: { inputTokens: 30, outputTokens: 4 }, model: "gpt-x-2026" },
  ]);
});

test("request body follows ChatGPT plan-usage rules", async () => {
  await collect(make().stream(args));
  const req = fake.requests.at(-1)!;
  expect(req.headers.authorization).toBe("Bearer tok-123");
  const body = req.body as Record<string, unknown>;
  expect(body).toMatchObject({ model: "gpt-x", instructions: "You are Nova.", store: false, stream: true });
  expect(body.input).toEqual([
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
    { role: "user", content: "Again" },
  ]);
  for (const banned of ["temperature", "max_output_tokens", "previous_response_id", "user", "metadata"]) expect(body).not.toHaveProperty(banned);
});

test("response.failed with a ChatGPT usage-limit code maps to usage_limit", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) =>
    sse(res, [ok[1], { event: "response.failed", data: { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } } }]);
  await expect(collect(make().stream(args))).rejects.toMatchObject({ code: "usage_limit" });
});

test("a stream that ends without response.completed is an error", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) => sse(res, [ok[1]]);
  await expect(collect(make().stream(args))).rejects.toMatchObject({ code: "network" });
});

test("response.incomplete is an error that says the reply stopped early", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) =>
    sse(res, [{ event: "response.incomplete", data: { type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } } }]);
  await expect(collect(make().stream(args))).rejects.toThrow(/stopped early/);
});

test("HTTP errors carry the provider's code", async () => {
  fake.routes["POST /v1/responses"] = (_q, res) => json(res, 403, { error: { code: "subscription_sharing_user_not_eligible", message: "no" } });
  await expect(collect(make().stream(args))).rejects.toMatchObject({ code: "not_eligible" });
});

test("API-key model list reads data[].id", async () => {
  expect(await make("api").listModels(AbortSignal.timeout(5000))).toEqual([{ id: "gpt-x", label: "gpt-x" }]);
});

test("ChatGPT model list keeps only visible models with display names", async () => {
  fake.routes["GET /v1/models"] = (_q, res) =>
    json(res, 200, { models: [{ slug: "gpt-a", display_name: "GPT A", visibility: "list" }, { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" }] });
  expect(await make("chatgpt").listModels(AbortSignal.timeout(5000))).toEqual([{ id: "gpt-a", label: "GPT A" }]);
});
