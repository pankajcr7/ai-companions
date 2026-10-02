import { createServer, type Server } from "node:http";

export const FAKE_LLM_PORT = 4199;
export const FAKE_REPLY = ["Hello ", "from the ", "fake model."];

export function startFakeLlm(): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "fake-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      req.resume();
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const text of FAKE_REPLY) res.write(`data: ${JSON.stringify({ model: "fake-model", choices: [{ delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 6 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(FAKE_LLM_PORT, "127.0.0.1", () => resolve(server)));
}
