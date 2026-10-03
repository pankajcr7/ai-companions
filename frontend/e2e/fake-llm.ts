import { createServer, type Server } from "node:http";

export const FAKE_LLM_PORT = 4199;
export const FAKE_REPLY = ["Hello ", "from the ", "fake model."];

const fence = (v: unknown) => `\`\`\`json\n${JSON.stringify(v)}\n\`\`\``;
export const MATH_EDIT = "// Adds two numbers.\nexport const add = (a: number, b: number) => a + b;\n";

/** Scripted replies for goals, keyed on phrases in the system prompt; plain chat gets FAKE_REPLY. */
function scripted(system: string, user: string): string | null {
  if (system.includes("Turn the owner's goal into a plan")) {
    const id = /id: (\S+)/.exec(user)?.[1] ?? "unknown";
    return fence({ tasks: [{ agentId: id, title: "Document the math helper", instructions: "Add a comment above the add helper.", deliverable: "A short note and the edited file", criteria: ["Explains the change"], dependsOn: [] }] });
  }
  if (system.includes("Pick the files you need to read")) return fence({ read: ["sample-app/src/lib/math.ts"] });
  if (system.includes("Review each task result")) return fence({ summary: "Nova checked the work: the helper is documented.", verdicts: [{ position: 0, verdict: "meets", note: "Clear change." }] });
  if (system.includes("Nova assigned you a task")) return `I documented the add helper.\n\n${fence({ edits: [{ path: "sample-app/src/lib/math.ts", content: MATH_EDIT, note: "Document the helper" }] })}`;
  if (system.includes("Write a summary of this project")) return "A small sample app with a math helper.";
  return null;
}

export function startFakeLlm(): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "fake-model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { messages?: { role: string; content: string }[] };
      const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
      const user = body.messages?.filter((m) => m.role === "user").at(-1)?.content ?? "";
      const reply = scripted(system, user);
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const text of reply ? [reply] : FAKE_REPLY) res.write(`data: ${JSON.stringify({ model: "fake-model", choices: [{ delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 6 } })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(FAKE_LLM_PORT, "127.0.0.1", () => resolve(server)));
}
