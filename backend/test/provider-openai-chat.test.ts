import { afterAll, expect, test } from "vitest";
import { openAiChatClient } from "../src/providers/openai-chat.js";
import { ProviderError, type StreamEvent } from "../src/providers/types.js";
import { fakeServer, json, sse } from "./fake-provider.js";

const chunk = (content: string) => JSON.stringify({ model: "fake-1", choices: [{ delta: { content } }] });
const fake = await fakeServer({
  "GET /v1/models": (_q, res) => json(res, 200, { data: [{ id: "fake-1" }, { id: "fake-2" }] }),
  "POST /v1/chat/completions": (_q, res) =>
    sse(res, [chunk("Hel"), chunk("lo"), JSON.stringify({ model: "fake-1", choices: [], usage: { prompt_tokens: 12, completion_tokens: 2 } }), "[DONE]"]),
});
afterAll(() => fake.close());

const client = (path = "/v1") => openAiChatClient({ baseUrl: fake.url + path, apiKey: "sk-test" });
const collect = async (it: AsyncIterable<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
};
const args = { model: "fake-1", instructions: "You are Nova.", turns: [{ role: "user" as const, content: "Hi" }], signal: AbortSignal.timeout(5000) };

test("lists models", async () => {
  expect(await client().listModels(AbortSignal.timeout(5000))).toEqual([
    { id: "fake-1", label: "fake-1" },
    { id: "fake-2", label: "fake-2" },
  ]);
  expect(fake.requests.at(-1)!.headers.authorization).toBe("Bearer sk-test");
});

test("streams text, then usage and the served model", async () => {
  const events = await collect(client().stream(args));
  expect(events).toEqual([
    { type: "delta", text: "Hel" },
    { type: "delta", text: "lo" },
    { type: "done", usage: { inputTokens: 12, outputTokens: 2 }, model: "fake-1" },
  ]);
  const body = fake.requests.at(-1)!.body as { messages: unknown[]; stream: boolean; stream_options: unknown };
  expect(body.stream).toBe(true);
  expect(body.stream_options).toEqual({ include_usage: true });
  expect(body.messages).toEqual([
    { role: "system", content: "You are Nova." },
    { role: "user", content: "Hi" },
  ]);
});

test("a stream without [DONE] is an error, not a finished reply", async () => {
  fake.routes["POST /v1/chat/completions"] = (_q, res) => sse(res, [chunk("Hel")]);
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "network" });
});

test("an unreadable chunk is an error", async () => {
  fake.routes["POST /v1/chat/completions"] = (_q, res) => sse(res, ["{not json", "[DONE]"]);
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "unavailable" });
});

test("status codes map to plain errors", async () => {
  fake.routes["POST /v1/chat/completions"] = (_q, res) => json(res, 401, { error: { message: "bad key" } });
  await expect(collect(client().stream(args))).rejects.toMatchObject({ code: "auth" });
  fake.routes["POST /v1/chat/completions"] = (_q, res) => json(res, 429, { error: { message: "slow down" } });
  const err = await collect(client().stream(args)).catch((e) => e);
  expect(err).toBeInstanceOf(ProviderError);
  expect(err.retryable).toBe(true);
});

test("a missing endpoint is reported as unavailable model or route", async () => {
  await expect(client("/nope").listModels(AbortSignal.timeout(5000))).rejects.toMatchObject({ code: "model_unavailable" });
});
