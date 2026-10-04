import { afterAll, expect, test } from "vitest";
import { loadSearchKey } from "../src/harness/web.js";
import { fakeServer } from "./fake-provider.js";
import { client, makeApp, signUp } from "./helpers.js";

const app = await makeApp();
const tavily = await fakeServer({
  "POST /search": (q, res) => void (q.headers.authorization === "Bearer tvly-good-key-1234" ? res.writeHead(200, { "content-type": "application/json" }).end('{"results":[]}') : res.writeHead(401).end("{}")),
});
process.env.TAVILY_URL = tavily.url;
afterAll(async () => {
  await tavily.close();
  await app.close();
});

test("admins add, see the hint of, and remove the web search key; it is checked first and never returned", async () => {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const id = (await req("POST", "/api/workspaces", { name: "Search Co", template: "starter" })).json().id as string;
  expect((await req("GET", `/api/workspaces/${id}/search-key`)).json()).toEqual({ key: null });
  const bad = await req("PUT", `/api/workspaces/${id}/search-key`, { apiKey: "tvly-wrong" });
  expect(bad.statusCode).toBe(400);
  expect(bad.json().error.message).toMatch(/rejected/i);
  const ok = await req("PUT", `/api/workspaces/${id}/search-key`, { apiKey: "tvly-good-key-1234" });
  expect(ok.statusCode).toBe(200);
  expect(ok.json()).toEqual({ provider: "tavily", hint: "tvl…1234" });
  expect(JSON.stringify((await req("GET", `/api/workspaces/${id}/search-key`)).json())).not.toContain("good-key");
  expect(await loadSearchKey(id)).toBe("tvly-good-key-1234");
  expect((await req("DELETE", `/api/workspaces/${id}/search-key`)).statusCode).toBe(204);
  expect(await loadSearchKey(id)).toBeNull();
});
