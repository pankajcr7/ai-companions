import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeEach, expect, test } from "vitest";
import { chatgptAccessToken, type ChatgptSecret } from "../src/chatgpt-oauth.js";
import { decryptSecret, encryptSecret } from "../src/crypto.js";
import { prisma } from "../src/db.js";
import { clientFor } from "../src/providers/index.js";
import { client, makeApp, signUp } from "./helpers.js";
import { fakeServer, json } from "./fake-provider.js";

const ISSUER = "https://auth.openai.com";
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
let tokenReply: (form: Record<string, string>) => [number, unknown] = () => [500, {}];
let nonceSeen = "";

const idToken = (clientId: string, nonce: string, sub = "user-sub-1") =>
  new SignJWT({ email: "asha@example.com", nonce })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(clientId)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

const auth = await fakeServer({
  "GET /.well-known/openid-configuration": (_q, res) => json(res, 200, { issuer: ISSUER, jwks_uri: `${auth.url}/jwks`, revocation_endpoint: `${auth.url}/revoke` }),
  "GET /jwks": (_q, res) => json(res, 200, { keys: [jwk] }),
  "POST /api/accounts/oauth/token": (q, res) => {
    const [status, body] = tokenReply(q.body as Record<string, string>);
    json(res, status, body);
  },
  "POST /revoke": (_q, res) => {
    res.writeHead(200).end();
  },
  "GET /v1/models": (q, res) => json(res, q.headers.authorization === "Bearer access-2" || q.headers.authorization === "Bearer access-1" ? 200 : 401, { models: [{ slug: "gpt-a", display_name: "GPT A", visibility: "list" }] }),
});
const app = await makeApp();
afterAll(async () => {
  await auth.close();
  await app.close();
});
beforeEach(() => {
  process.env.TEST_OPENAI_AUTH_BASE = auth.url;
  process.env.TEST_OPENAI_ISSUER = ISSUER;
  process.env.TEST_OPENAI_BASE_URL = `${auth.url}/v1`;
  process.env.CHATGPT_LOCAL_LOGIN = "true";
  process.env.FRONTEND_URL = "http://localhost:3000";
  tokenReply = (form) => [200, { access_token: "access-1", refresh_token: "refresh-1", id_token: "", expires_in: 3600, scope: "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke", ...form }];
});

async function owner() {
  const { cookie } = await signUp(app);
  const req = client(app, cookie);
  const ws = (await req("POST", "/api/workspaces", { name: "Plan Co", template: "head-only" })).json() as { id: string; slug: string };
  return { req, ...ws };
}

async function signInFlow(req: ReturnType<typeof client>, id: string, opts: { scope?: string; callback?: Record<string, string>; badNonce?: boolean } = {}) {
  const start = await req("POST", `/api/workspaces/${id}/connections/chatgpt/start`, {});
  const url = new URL(start.json().url);
  const state = url.searchParams.get("state")!;
  nonceSeen = url.searchParams.get("nonce")!;
  tokenReply = (form) => [
    200,
    {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: opts.scope ?? "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
      id_token: "pending",
      _form: form,
    },
  ];
  const clientId = "oaiapp_test123";
  const token = await idToken(clientId, opts.badNonce ? "wrong" : nonceSeen);
  const base = tokenReply;
  tokenReply = (form) => {
    const [s, b] = base(form);
    return [s, { ...(b as object), id_token: token }];
  };
  const q = new URLSearchParams({ code: "code-1", state, client_id: clientId, ...opts.callback });
  return { start, url, cb: await app.inject({ method: "GET", url: `/auth/callback?${q}` }) };
}

test("start builds the documented authorization URL", async () => {
  const { req, id } = await owner();
  const { url } = await signInFlow(req, id);
  const p = url.searchParams;
  expect(url.origin + url.pathname).toBe(`${auth.url}/api/accounts/authorize`);
  expect(p.get("client_id")).toBe("dynamic_agent_client");
  expect(p.get("agent_name_hint")).toBe("Agent Company");
  expect(p.get("ext_agent_host_id")).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  expect(p.get("response_type")).toBe("code");
  expect(p.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
  expect(p.get("scope")).toBe("openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
  expect(p.get("resource")).toBe("https://api.openai.com/v1");
  expect(p.get("code_challenge_method")).toBe("S256");
  expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("successful sign-in saves an encrypted ChatGPT connection and redirects to the providers page", async () => {
  const { req, id, slug } = await owner();
  const { cb } = await signInFlow(req, id);
  expect(cb.statusCode).toBe(302);
  expect(cb.headers.location).toBe(`http://localhost:3000/w/${slug}/providers?connected=chatgpt`);
  const conn = await prisma.providerConnection.findFirstOrThrow({ where: { workspaceId: id, kind: "chatgpt" } });
  expect(conn).toMatchObject({ hint: "asha@example.com", status: "connected" });
  expect(conn.secret).not.toContain("access-1");
  const secret = JSON.parse(decryptSecret(conn.secret!)) as ChatgptSecret;
  expect(secret).toMatchObject({ clientId: "oaiapp_test123", subject: "user-sub-1", accessToken: "access-1", refreshToken: "refresh-1" });
  const exchange = auth.requests.find((r) => r.path === "/api/accounts/oauth/token")!.body as Record<string, string>;
  expect(exchange).toMatchObject({ grant_type: "authorization_code", client_id: "oaiapp_test123", code: "code-1", resource: "https://api.openai.com/v1" });
  expect(exchange.code_verifier).toBeTruthy();
});

test.each([
  ["declined consent", { callback: { error: "access_denied" } }, /wasn't allowed/],
  ["missing plan scope", { scope: "openid email profile" }, /wasn't granted/],
  ["wrong nonce", { badNonce: true }, /didn't match/],
])("%s saves nothing and explains why", async (_name, opts, message) => {
  const { req, id } = await owner();
  const { cb } = await signInFlow(req, id, opts);
  expect(cb.statusCode).toBe(302);
  expect(decodeURIComponent(cb.headers.location as string)).toMatch(message);
  expect(await prisma.providerConnection.count({ where: { workspaceId: id } })).toBe(0);
});

test("unknown state is rejected", async () => {
  const cb = await app.inject({ method: "GET", url: "/auth/callback?code=x&state=nope" });
  expect(cb.statusCode).toBe(302);
  expect(decodeURIComponent(cb.headers.location as string)).toMatch(/expired/);
});

test("disabled local login explains the hosted limitation", async () => {
  const { req, id } = await owner();
  process.env.CHATGPT_LOCAL_LOGIN = "false";
  const res = await req("POST", `/api/workspaces/${id}/connections/chatgpt/start`, {});
  expect(res.statusCode).toBe(400);
  expect(res.json().error.message).toMatch(/local or self-hosted/);
});

async function savedConnection(id: string, expiresIn: number) {
  const secret: ChatgptSecret = { clientId: "oaiapp_x", subject: "s", email: "a@b.c", idToken: "id", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + expiresIn, scopes: ["chatgpt.tokens.use.direct"] };
  return prisma.providerConnection.create({ data: { workspaceId: id, kind: "chatgpt", label: "ChatGPT", secret: encryptSecret(JSON.stringify(secret)), hint: "a@b.c", createdById: (await prisma.membership.findFirstOrThrow({ where: { workspaceId: id } })).userId } });
}

test("an access token close to expiry is refreshed and the new tokens are saved", async () => {
  const { id } = await owner();
  const conn = await savedConnection(id, 60_000);
  tokenReply = () => [200, { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600, scope: "chatgpt.tokens.use.direct" }];
  expect(await chatgptAccessToken(conn.id)).toBe("access-2");
  const refresh = auth.requests.filter((r) => r.path === "/api/accounts/oauth/token").at(-1)!.body as Record<string, string>;
  expect(refresh).toMatchObject({ grant_type: "refresh_token", client_id: "oaiapp_x", refresh_token: "refresh-1", resource: "https://api.openai.com/v1" });
  expect(refresh).not.toHaveProperty("scope");
  const saved = JSON.parse(decryptSecret((await prisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } })).secret!));
  expect(saved).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
});

test("a terminal refresh error marks the connection as needing sign-in", async () => {
  const { id } = await owner();
  const conn = await savedConnection(id, 0);
  tokenReply = () => [400, { error: "invalid_grant" }];
  await expect(chatgptAccessToken(conn.id)).rejects.toMatchObject({ code: "reauth" });
  expect((await prisma.providerConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe("reauth");
});

test("ChatGPT models come from the account's catalog", async () => {
  const { id } = await owner();
  const conn = await savedConnection(id, 3_600_000);
  expect(await clientFor(conn).listModels(AbortSignal.timeout(5000))).toEqual([{ id: "gpt-a", label: "GPT A" }]);
});

test("removing a ChatGPT connection revokes the refresh token", async () => {
  const { req, id } = await owner();
  const conn = await savedConnection(id, 3_600_000);
  const res = await req("DELETE", `/api/workspaces/${id}/connections/${conn.id}`);
  expect(res.json()).toEqual({ revoked: true });
  const rev = auth.requests.filter((r) => r.path === "/revoke").at(-1)!.body as Record<string, string>;
  expect(rev).toEqual({ token: "refresh-1", token_type_hint: "refresh_token", client_id: "oaiapp_x" });
});
