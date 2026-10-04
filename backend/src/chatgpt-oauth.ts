import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { prisma } from "./db.js";
import { testOverride } from "./env.js";
import { ProviderError } from "./providers/types.js";

export const RESOURCE = "https://api.openai.com/v1";
export const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const authBase = () => testOverride("TEST_OPENAI_AUTH_BASE") ?? "https://auth.openai.com";
const issuer = () => testOverride("TEST_OPENAI_ISSUER") ?? "https://auth.openai.com";

export const localLoginEnabled = () => process.env.CHATGPT_LOCAL_LOGIN === "true";
export const redirectUri = () => `http://127.0.0.1:${process.env.PORT ?? 4000}/auth/callback`;

export type ChatgptSecret = {
  clientId: string;
  subject: string;
  email: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
};

export class OAuthError extends Error {
  constructor(
    message: string,
    public pending?: Pending,
  ) {
    super(message);
  }
}
class TokenError extends Error {
  constructor(
    public error: string,
    public status: number,
  ) {
    super(error);
  }
}

// One stable, opaque ID per install, as OpenAI requires. Not a user identifier.
const HOST_FILE = new URL("../data/chatgpt-host-id", import.meta.url);
export async function hostId() {
  try {
    return (await readFile(HOST_FILE, "utf8")).trim();
  } catch {
    const id = `urn:uuid:${randomUUID()}`;
    await mkdir(new URL("./", HOST_FILE), { recursive: true });
    await writeFile(HOST_FILE, id, { mode: 0o600 });
    return id;
  }
}

type Pending = { userId: string; workspaceId: string; slug: string; verifier: string; nonce: string; connectionId: string | null; clientId: string | null; subject: string | null; expires: number };
// ponytail: in-memory, single process; an attempt is lost on restart and the user simply clicks again.
const pending = new Map<string, Pending>();
const b64url = (b: Buffer) => b.toString("base64url");

export async function startAuthorization(p: { userId: string; workspaceId: string; slug: string; connectionId: string | null; clientId: string | null; subject: string | null; idTokenHint?: string }) {
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(32));
  const { idTokenHint, ...rest } = p;
  pending.set(state, { ...rest, verifier, nonce, expires: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({
    client_id: p.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: await hostId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  });
  if (!p.clientId) q.set("agent_name_hint", "Agent Company");
  if (idTokenHint) q.set("id_token_hint", idTokenHint);
  return `${authBase()}/api/accounts/authorize?${q}`;
}

let discovered: { base: string; jwks: ReturnType<typeof createRemoteJWKSet>; revocation: string } | null = null;
async function discovery() {
  if (discovered?.base === authBase()) return discovered;
  const res = await fetch(`${authBase()}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000) });
  const cfg = (await res.json()) as { jwks_uri: string; revocation_endpoint: string };
  discovered = { base: authBase(), jwks: createRemoteJWKSet(new URL(cfg.jwks_uri)), revocation: cfg.revocation_endpoint };
  return discovered;
}

async function tokenRequest(form: Record<string, string>) {
  const res = await fetch(`${authBase()}/api/accounts/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new TokenError(String(body.error ?? res.status), res.status);
  return body as { access_token: string; refresh_token?: string; id_token: string; expires_in: number; scope?: string };
}

export async function completeAuthorization(query: Record<string, string | undefined>) {
  const p = query.state ? pending.get(query.state) : undefined;
  if (!p || p.expires < Date.now()) throw new OAuthError("This ChatGPT sign-in expired. Start again from Settings › AI services.");
  pending.delete(query.state!);
  if (query.error === "access_denied") throw new OAuthError("ChatGPT plan use wasn't allowed, so nothing was connected.", p);
  if (query.error) throw new OAuthError(`ChatGPT sign-in failed (${query.error}).`, p);
  if (p.clientId && query.client_id && query.client_id !== p.clientId) throw new OAuthError("OpenAI returned a different app registration, so nothing was changed.", p);
  const clientId = p.clientId ?? query.client_id;
  if (!clientId) throw new OAuthError("OpenAI didn't finish registering the app. Try again.", p);
  if (!query.code) throw new OAuthError("OpenAI didn't return a sign-in code. Try again.", p);

  let tokens;
  try {
    tokens = await tokenRequest({ grant_type: "authorization_code", client_id: clientId, code: query.code, code_verifier: p.verifier, redirect_uri: redirectUri(), resource: RESOURCE });
  } catch {
    throw new OAuthError("OpenAI didn't accept the sign-in. Try again.", p);
  }
  let claims: JWTPayload;
  try {
    ({ payload: claims } = await jwtVerify(tokens.id_token, (await discovery()).jwks, { issuer: issuer(), audience: clientId }));
  } catch {
    throw new OAuthError("The sign-in response couldn't be verified. Try again.", p);
  }
  if (claims.nonce !== p.nonce) throw new OAuthError("The sign-in response didn't match this attempt. Try again.", p);
  if (p.subject && claims.sub !== p.subject) throw new OAuthError("You signed in with a different ChatGPT account, so nothing was changed.", p);
  const scopes = String(tokens.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(PLAN_SCOPE)) throw new OAuthError("ChatGPT plan use wasn't granted, so nothing was connected.", p);
  const secret: ChatgptSecret = {
    clientId,
    subject: String(claims.sub),
    email: String(claims.email ?? ""),
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? "",
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scopes,
  };
  return { pending: p, secret };
}

const TERMINAL = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
const refreshing = new Map<string, Promise<string>>();

/** Returns a usable access token, refreshing (serialized per connection) when it expires within 5 minutes. */
export function chatgptAccessToken(connectionId: string): Promise<string> {
  const running = refreshing.get(connectionId);
  if (running) return running;
  const job = (async () => {
    const conn = await prisma.providerConnection.findUniqueOrThrow({ where: { id: connectionId } });
    const s = JSON.parse(decryptSecret(conn.secret!)) as ChatgptSecret;
    if (s.expiresAt - Date.now() > 5 * 60_000) return s.accessToken;
    try {
      const t = await tokenRequest({ grant_type: "refresh_token", client_id: s.clientId, refresh_token: s.refreshToken, resource: RESOURCE });
      const next: ChatgptSecret = { ...s, accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expiresAt: Date.now() + t.expires_in * 1000, scopes: t.scope ? t.scope.split(" ") : s.scopes };
      await prisma.providerConnection.update({ where: { id: connectionId }, data: { secret: encryptSecret(JSON.stringify(next)), status: "connected", lastError: null } });
      return next.accessToken;
    } catch (e) {
      if (e instanceof TokenError && TERMINAL.has(e.error)) {
        await prisma.providerConnection.update({ where: { id: connectionId }, data: { status: "reauth", lastError: "Sign in to ChatGPT again" } });
        throw new ProviderError("reauth", "Sign in to ChatGPT again to keep using it.");
      }
      throw new ProviderError("unavailable", "Couldn't renew the ChatGPT session. Try again shortly.");
    }
  })().finally(() => refreshing.delete(connectionId));
  refreshing.set(connectionId, job);
  return job;
}

/** Ends the renewable session. Returns false when revocation couldn't be confirmed. */
export async function revoke(secret: ChatgptSecret): Promise<boolean> {
  try {
    const res = await fetch((await discovery()).revocation, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: secret.refreshToken, token_type_hint: "refresh_token", client_id: secret.clientId }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
