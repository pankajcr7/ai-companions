import { createServer, type Server } from "node:http";

export const FAKE_LLM_PORT = 4199;
// The first run of the launch-posts task is slow so the home test can press Stop mid-task.
let slowNext = true;
export const FAKE_REPLY = ["Hello ", "from the ", "fake model."];

const fence = (v: unknown) => `\`\`\`json\n${JSON.stringify(v)}\n\`\`\``;
export const MATH_EDIT = "// Adds two numbers.\nexport const add = (a: number, b: number) => a + b;\n";

/** Scripted replies for goals, keyed on phrases in the system prompt; plain chat gets FAKE_REPLY. */
function scripted(system: string, user: string): string | null {
  if (system.includes("This goal builds a NEW project")) {
    const id = /id: (\S+)/.exec(user)?.[1] ?? "unknown";
    return fence({ projectName: "Bakery landing page", tasks: [{ agentId: id, title: "Build the landing page", instructions: "Create index.html and style.css.", deliverable: "The page files", criteria: ["Has a heading"], dependsOn: [] }] });
  }
  if (system.includes("Pick the files you need to read") && user.includes("Build the landing page")) return fence({ read: [] });
  if (system.includes("Nova assigned you a task") && user.includes("YOUR TASK:\nBuild the landing page")) {
    const html = '<!doctype html><link rel="stylesheet" href="style.css"><h1>Crumb Bakery</h1><p>Fresh bread daily.</p>';
    return `Built the page.\n\n${fence({ edits: [{ path: "index.html", content: html, note: "Page" }, { path: "style.css", content: "h1 { color: #7a4b2a; }", note: "Styles" }] })}`;
  }
  if (system.includes("Turn the owner's goal into a plan") && user.includes("Write the launch posts")) {
    const id = /id: (\S+)/.exec(user)?.[1] ?? "unknown";
    return fence({ tasks: [{ agentId: id, title: "Write the launch posts", instructions: "Three posts.", deliverable: "Posts", criteria: ["Three posts"], dependsOn: [] }] });
  }
  if (system.includes("Nova assigned you a task") && user.includes("YOUR TASK:\nWrite the launch posts")) return "1. Fresh bread daily\n2. Croissants at 7\n3. Order online";
  if (system.includes("Turn the owner's goal into a plan")) {
    const id = /id: (\S+)/.exec(user)?.[1] ?? "unknown";
    return fence({ tasks: [{ agentId: id, title: "Document the math helper", instructions: "Add a comment above the add helper.", deliverable: "A short note and the edited file", criteria: ["Explains the change"], dependsOn: [] }] });
  }
  if (system.includes("Pick the files you need to read")) return fence({ read: ["sample-app/src/lib/math.ts"] });
  if (system.includes("Review each task result")) return fence({ summary: "Nova checked the work: the helper is documented.", verdicts: [{ position: 0, verdict: "meets", note: "Clear change." }] });
  if (system.includes("Nova assigned you a task")) return `I documented the add helper.\n\n${fence({ edits: [{ path: "sample-app/src/lib/math.ts", content: MATH_EDIT, note: "Document the helper" }] })}`;
  if (system.includes("Write a summary of this project")) return "A small sample app with a math helper.";
  if (system.includes("You are answering questions about a company goal")) {
    return `Here is the documented helper:\n\n\`\`\`ts title=sample-app/src/lib/math.ts\n${MATH_EDIT}\`\`\`\n\n![tracker](http://127.0.0.1:4199/pixel.png?d=secret)`;
  }
  // Nova's own chat (and goal chat, handled above) can hand work to the team; this team has no marketer yet.
  if (system.includes("When the owner asks for work to be done") && /marketing/i.test(user)) {
    return `No one on the team covers marketing yet, so add a marketing companion and I'll plan it with them.\n\n${fence({ suggest: { goal: "Create a launch marketing plan for the app", hire: [{ role: "Marketing lead", department: "Marketing" }] } })}`;
  }
  if (system.includes("When the owner asks for work to be done") && /launch posts/i.test(user)) {
    return `I'll get the team on it.\n\n${fence({ suggest: { goal: "Write the launch posts for the bakery" } })}`;
  }
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
      const slow = system.includes("Nova assigned you a task") && user.includes("YOUR TASK:\nWrite the launch posts") && slowNext;
      if (slow) {
        slowNext = false;
        await new Promise((r) => setTimeout(r, 8000));
      }
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
