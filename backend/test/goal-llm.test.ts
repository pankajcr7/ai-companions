import { afterAll, expect, test } from "vitest";
import { z } from "zod";
import { CallError, complete, completeJson, readiness, type Actor } from "../src/goals/llm.js";
import { fakeLLM, fence } from "./goal-helpers.js";

const llm = await fakeLLM();
afterAll(() => llm.close());
const actor = (over: Partial<Actor> = {}): Actor => ({
  id: "a1",
  name: "Sana",
  kind: "ai",
  status: "active",
  model: "fake-1",
  connection: { id: "c1", kind: "custom", baseUrl: `${llm.url}/v1`, secret: null, status: "connected" },
  ...over,
});
const signal = () => AbortSignal.timeout(30_000);

test("readiness explains what's missing", () => {
  expect(readiness(actor())).toBeNull();
  expect(readiness(actor({ model: null }))).toBe("Sana has no AI model");
  expect(readiness(actor({ status: "paused" }))).toBe("Sana is paused");
  expect(readiness(actor({ kind: "human" }))).toBe("Sana is a human collaborator");
  expect(readiness(actor({ connection: { id: "c1", kind: "chatgpt", baseUrl: null, secret: null, status: "reauth" } }))).toBe("Sana's ChatGPT sign-in needs renewing");
});

test("complete collects the reply and logs one step", async () => {
  llm.setScript(() => "Hello there");
  const steps: unknown[] = [];
  const call = await complete(actor(), "Be brief", [{ role: "user", content: "Hi" }], signal(), async (s) => void steps.push(s));
  expect(call).toEqual({ text: "Hello there", model: "fake-1", inputTokens: 10, outputTokens: 5 });
  expect(steps).toEqual([expect.objectContaining({ agentId: "a1", model: "fake-1", inputTokens: 10, outputTokens: 5, errorCode: null })]);
});

test("a provider error becomes a CallError with its code, and is logged", async () => {
  llm.setScript(() => ({ status: 401, message: "bad key" }));
  const steps: { errorCode: string | null }[] = [];
  const err = await complete(actor(), "x", [{ role: "user", content: "Hi" }], signal(), async (s) => void steps.push(s)).catch((e) => e);
  expect(err).toBeInstanceOf(CallError);
  expect(err.code).toBe("auth");
  expect(steps[0].errorCode).toBe("auth");
  await expect(complete(actor({ model: null }), "x", [], signal())).rejects.toMatchObject({ code: "unassigned", message: "Sana has no AI model" });
});

test("completeJson repairs once with the validation error", async () => {
  const schema = z.object({ read: z.array(z.string()).max(2) });
  let n = 0;
  llm.setScript(() => (++n === 1 ? fence({ read: ["a", "b", "c"] }) : fence({ read: ["a"] })));
  const before = llm.requests.length;
  const out = await completeJson(actor(), "Pick", "FILES", schema, signal());
  expect(out.value).toEqual({ read: ["a"] });
  expect(out.calls).toHaveLength(2);
  const second = llm.requests[before + 1].body as { messages: { role: string; content: string }[] };
  expect(second.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  expect(second.messages.at(-1)!.content).toMatch(/couldn't be used: read/);
});

test("completeJson gives up after one repair", async () => {
  llm.setScript(() => "I refuse to write JSON");
  await expect(completeJson(actor(), "Pick", "FILES", z.object({ read: z.array(z.string()) }), signal())).rejects.toMatchObject({ code: "bad_output" });
});

test("a model that refuses pictures gets the message again without them, and the call says so", async () => {
  llm.setScript((_s, _u, body) => (JSON.stringify(body).includes("image_url") ? { status: 400, message: "image input is not supported for this model" } : "Read it as text."));
  const call = await complete(actor(), "x", [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image", mime: "image/png", data: "AAAA" }] }], signal());
  expect(call).toMatchObject({ text: "Read it as text.", visionFallback: true });
  const sent = JSON.stringify(llm.requests.at(-1)!.body);
  expect(sent).toContain("this AI model can't see images");
  expect(sent).not.toContain("image_url");
});
