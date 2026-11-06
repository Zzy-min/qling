import { createServer } from "node:http";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { atomicWrite, authPath, privateDir, readJson } from "./store.js";
import type { AuthCredential, AuthProfile } from "./types.js";
import { CHATGPT_ENDPOINT } from "./types.js";
export const ISSUER = "https://auth.openai.com";
export const TOKEN_URL = ISSUER + "/api/accounts/oauth/token";
export const SCOPES =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export type HttpFetch = typeof fetch;
export async function authJson(
  http: HttpFetch,
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  try {
    init?.signal?.throwIfAborted();
    const r = await http(url, {
      ...init,
      redirect: "error",
      signal: init?.signal ?? AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error();
    const data = (await r.json()) as Record<string, unknown>;
    init?.signal?.throwIfAborted();
    return data;
  } catch {
    init?.signal?.throwIfAborted();
    throw Error("Authentication request failed; sign in again");
  }
}
export async function verifyIdentity(
  http: HttpFetch,
  token: string,
  clientId: string,
  nonce?: string,
  signal?: AbortSignal,
): Promise<{
  subject: string;
  issuer: string;
}> {
  signal?.throwIfAborted();
  const d = await authJson(http, ISSUER + "/.well-known/openid-configuration", {
    signal,
  });
  if (d.issuer !== ISSUER || typeof d.jwks_uri !== "string")
    throw Error("Invalid official identity discovery");
  const uri = new URL(d.jwks_uri);
  if (uri.origin !== ISSUER || uri.username || uri.password)
    throw Error("Untrusted identity key origin");
  const keys = await authJson(http, uri.href, { signal });
  try {
    const { payload } = await jwtVerify(
      token,
      createLocalJWKSet(keys as unknown as JSONWebKeySet),
      {
        issuer: ISSUER,
        audience: clientId,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "iat", "exp", ...(nonce ? ["nonce"] : [])],
      },
    );
    if (!payload.sub || (nonce && payload.nonce !== nonce)) throw Error();
    signal?.throwIfAborted();
    return { subject: payload.sub, issuer: ISSUER };
  } catch {
    signal?.throwIfAborted();
    throw Error(
      "Invalid ChatGPT ID token identity, signature, nonce or lifetime",
    );
  }
}
export async function tokenCredential(
  http: HttpFetch,
  data: Record<string, unknown>,
  clientId: string,
  nonce?: string,
  previous?: AuthCredential,
  signal?: AbortSignal,
): Promise<AuthCredential> {
  const scopes =
    typeof data.scope === "string" ? data.scope.split(/\s+/) : previous?.scopes;
  if (
    !scopes?.includes("chatgpt.tokens.use.direct") ||
    !scopes.includes("resource.invoke")
  )
    throw Error("Insufficient ChatGPT granted scopes");
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    data.token_type !== "Bearer" ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  )
    throw Error("Invalid ChatGPT token response");
  let identity = previous
    ? { subject: previous.subject, issuer: previous.issuer }
    : undefined;
  if (typeof data.id_token === "string")
    identity = await verifyIdentity(
      http,
      data.id_token,
      clientId,
      nonce,
      signal,
    );
  else if (nonce) throw Error("Missing ChatGPT ID token");
  if (
    !identity?.subject ||
    (previous?.subject && previous.subject !== identity.subject)
  )
    throw Error("ChatGPT identity mismatch");
  signal?.throwIfAborted();
  return {
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : previous?.refreshToken,
    idToken:
      typeof data.id_token === "string" ? data.id_token : previous?.idToken,
    clientId,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes,
    subject: identity.subject,
    issuer: ISSUER,
  };
}
export async function refreshChatGpt(
  http: HttpFetch,
  c: AuthCredential,
  signal?: AbortSignal,
): Promise<AuthCredential> {
  if (!c.clientId || !c.refreshToken || c.issuer !== ISSUER)
    throw Error("needs_login: ChatGPT session cannot refresh");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: c.clientId,
    refresh_token: c.refreshToken,
    resource: CHATGPT_ENDPOINT,
  });
  const data = await authJson(http, TOKEN_URL, {
    method: "POST",
    body,
    signal,
  });
  return tokenCredential(http, data, c.clientId, undefined, c, signal);
}
export interface ChatGptLoginOptions {
  stateDir: string;
  signal?: AbortSignal;
  onUrl: (url: string) => void;
  openBrowser?: (url: string) => Promise<void>;
}
export async function authorizeChatGpt(
  options: ChatGptLoginOptions,
  http: HttpFetch = fetch,
  previous?: AuthCredential,
): Promise<{
  profile: AuthProfile;
  credential: AuthCredential;
}> {
  const timeoutController = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  signal?.throwIfAborted();
  const dir = authPath(options.stateDir);
  await privateDir(dir);
  const hostPath = join(dir, "host.json");
  const host = await readJson(hostPath, { id: `urn:uuid:${randomUUID()}` });
  if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(host.id))
    throw Error("Invalid host identity");
  await atomicWrite(hostPath, JSON.stringify(host));
  const state = randomBytes(32).toString("base64url"),
    nonce = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  let complete!: (u: URL) => void, reject!: (e: Error) => void;
  const callback = new Promise<URL>((resolve, r) => {
    complete = resolve;
    reject = r;
  });
  // Attach immediately so cancellation before browser startup never causes an unhandled rejection.
  void callback.catch(() => {});
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/auth/callback") {
      res.writeHead(404).end();
      return;
    }
    if (
      url.searchParams.getAll("state").length !== 1 ||
      url.searchParams.get("state") !== state
    ) {
      res.writeHead(400).end("Invalid login state");
      reject(Error("Invalid OAuth state"));
      return;
    }
    res
      .writeHead(200, {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store",
      })
      .end("Return to Qling to finish sign-in.");
    complete(url);
  });
  let rejectInterrupted!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = reject;
  });
  void interrupted.catch(() => {});
  const abort = () => {
    const error = Error(
      timeoutController.signal.aborted ? "Login timed out" : "Login cancelled",
    );
    reject(error);
    rejectInterrupted(error);
  };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => timeoutController.abort(), 300000);
  timer.unref();
  try {
    await new Promise<void>((resolve, r) => {
      server.once("error", r);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Cannot start login callback");
    const redirect = `http://127.0.0.1:${address.port}/auth/callback`;
    const url = new URL(ISSUER + "/api/accounts/authorize");
    const clientId = previous?.clientId;
    const params = {
      client_id: clientId || "dynamic_agent_client",
      ext_agent_host_id: host.id,
      response_type: "code",
      redirect_uri: redirect,
      scope: SCOPES,
      resource: CHATGPT_ENDPOINT,
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    };
    // Omit the optional ID token hint: onUrl may print the URL for manual browser use.
    url.search = new URLSearchParams(params).toString();
    if (!clientId) url.searchParams.set("agent_name_hint", "Qling");
    signal?.throwIfAborted();
    options.onUrl(url.href);
    if (options.openBrowser)
      await Promise.race([options.openBrowser(url.href), interrupted]);
    const result = await callback;
    signal?.throwIfAborted();
    if (result.searchParams.has("error"))
      throw Error("ChatGPT authorization denied or cancelled");
    const issued = result.searchParams.get("client_id") || clientId;
    if (
      !issued ||
      issued === "dynamic_agent_client" ||
      (clientId && issued !== clientId)
    )
      throw Error("Invalid issued ChatGPT client ID");
    const code = result.searchParams.get("code");
    if (!code || result.searchParams.getAll("code").length !== 1)
      throw Error("Invalid authorization callback");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: issued,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: CHATGPT_ENDPOINT,
    });
    const data = await authJson(http, TOKEN_URL, {
      method: "POST",
      body,
      signal,
    });
    const credential = await tokenCredential(
      http,
      data,
      issued,
      nonce,
      previous,
      signal,
    );
    signal.throwIfAborted();
    return {
      profile: {
        id: randomUUID(),
        provider: "chatgpt",
        method: "chatgpt_oauth",
        endpoint: CHATGPT_ENDPOINT,
        model: "gpt-5.4",
      },
      credential,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    server.close();
    server.closeAllConnections();
  }
}
