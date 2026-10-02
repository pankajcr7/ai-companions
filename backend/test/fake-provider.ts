import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeRequest = { method: string; path: string; headers: IncomingMessage["headers"]; body: unknown; raw: string };
export type Handler = (req: FakeRequest, res: ServerResponse) => void | Promise<void>;

/** A tiny HTTP server. Routes are "METHOD /path"; every request is recorded. */
export async function fakeServer(routes: Record<string, Handler>) {
  const requests: FakeRequest[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString();
    const type = req.headers["content-type"] ?? "";
    const body = !raw ? undefined : type.includes("json") ? JSON.parse(raw) : type.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : raw;
    const path = (req.url ?? "/").split("?")[0];
    const record = { method: req.method ?? "GET", path, headers: req.headers, body, raw };
    requests.push(record);
    const handler = routes[`${record.method} ${path}`];
    if (!handler) return void res.writeHead(404, { "content-type": "application/json" }).end('{"error":{"message":"not found"}}');
    await handler(record, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    routes,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** Writes server-sent events. Strings become `data: <string>`; objects are JSON with an optional event name. */
export function sse(res: ServerResponse, events: (string | { event?: string; data: unknown })[], opts: { end?: boolean } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) {
    if (typeof e === "string") res.write(`data: ${e}\n\n`);
    else res.write(`${e.event ? `event: ${e.event}\n` : ""}data: ${JSON.stringify(e.data)}\n\n`);
  }
  if (opts.end !== false) res.end();
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}
