import type { FastifyInstance } from "fastify";
import { client, signUp } from "./helpers.js";
import { fakeServer, json, sse, type FakeRequest } from "./fake-provider.js";

type Body = { messages: { role: string; content: string }[] };
export type Reply = string | { status: number; message: string };
export type Script = (system: string, user: string, body: Body) => Reply | Promise<Reply>;

// Requests without a chat body (such as GET /v1/models) read as empty.
const messagesOf = (q: FakeRequest) => (q.body as Body | undefined)?.messages ?? [];
export const systemOf = (q: FakeRequest) => messagesOf(q).find((m) => m.role === "system")?.content ?? "";
export const userOf = (q: FakeRequest) => messagesOf(q).filter((m) => m.role === "user").at(-1)?.content ?? "";
export const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

/** An OpenAI-compatible fake whose replies come from a script that sees the system and last user message. */
export async function fakeLLM() {
  let script: Script = () => "ok";
  const server = await fakeServer({
    "GET /v1/models": (_q, res) => json(res, 200, { data: [{ id: "fake-1" }] }),
    "POST /v1/chat/completions": async (q, res) => {
      const reply = await script(systemOf(q), userOf(q), q.body as Body);
      if (typeof reply !== "string") return json(res, reply.status, { error: { message: reply.message } });
      sse(res, [JSON.stringify({ model: "fake-1", choices: [{ delta: { content: reply } }] }), JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }), "[DONE]"]);
    },
  });
  return { ...server, setScript: (s: Script) => void (script = s) };
}

/** A workspace with a custom connection to the fake and every AI companion assigned to it. */
export async function company(app: FastifyInstance, llm: { url: string }, template = "starter") {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Goal Co", template })).json().id as string;
  const cid = (await req("POST", `/api/workspaces/${id}/connections`, { kind: "custom", label: "Fake", baseUrl: `${llm.url}/v1` })).json().id as string;
  const snap = (await req("GET", `/api/workspaces/${id}`)).json();
  const agents = snap.agents.filter((a: { kind: string }) => a.kind === "ai") as { id: string; name: string; isHead: boolean }[];
  for (const a of agents) await req("PATCH", `/api/workspaces/${id}/agents/${a.id}`, { connectionId: cid, model: "fake-1" });
  return { req, id, cid, cookie, agents, nova: agents.find((a) => a.isHead)!, others: agents.filter((a) => !a.isHead) };
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting; last value: ${JSON.stringify(v).slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
