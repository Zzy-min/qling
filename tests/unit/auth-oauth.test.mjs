import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyIdentity,
  tokenCredential,
  ISSUER,
  TOKEN_URL,
} from "../../dist/auth/chatgpt.js";
import { createAuthService } from "../../dist/auth/service.js";
const cipher = {
  encrypt: async (x) => Buffer.from(x).toString("base64"),
  decrypt: async (x) => Buffer.from(x, "base64").toString(),
};
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "key" };
const response = (x) =>
  new Response(JSON.stringify(x), {
    headers: { "Content-Type": "application/json" },
  });
const http = async (url) => {
  if (url === ISSUER + "/.well-known/openid-configuration")
    return response({ issuer: ISSUER, jwks_uri: ISSUER + "/keys" });
  if (url === ISSUER + "/keys") return response({ keys: [jwk] });
  throw Error("Unexpected URL");
};
const sign = (overrides = {}, key = privateKey) =>
  new SignJWT({ nonce: "nonce", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "key" })
    .setSubject("user")
    .setIssuer(overrides.iss ?? ISSUER)
    .setAudience(overrides.aud ?? "client")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
test("OIDC signature, nonce, issuer, audience and granted scopes validated", async () => {
  const good = await sign();
  assert.equal(
    (await verifyIdentity(http, good, "client", "nonce")).subject,
    "user",
  );
  for (const token of [
    await sign({ nonce: "evil" }),
    await sign({ iss: "https://evil.test" }),
    await sign({ aud: "evil" }),
    await sign({}, (await generateKeyPair("RS256")).privateKey),
  ])
    await assert.rejects(
      verifyIdentity(http, token, "client", "nonce"),
      /Invalid ChatGPT/,
    );
  await assert.rejects(
    tokenCredential(
      http,
      {
        access_token: "x",
        id_token: good,
        token_type: "Bearer",
        expires_in: 1000,
        scope: "openid",
      },
      "client",
      "nonce",
    ),
    /Insufficient/,
  );
});
test("PKCE dynamic registration binds callback and saves no connection until explicit commit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-oauth-"));
  let requested;
  const mock = async (url, init) => {
    if (url === TOKEN_URL) {
      const body = init.body;
      assert.equal(body.get("client_id"), "issued");
      assert.equal(
        body.get("redirect_uri"),
        requested.searchParams.get("redirect_uri"),
      );
      assert.ok(body.get("code_verifier"));
      return response({
        access_token: "ACCESS",
        refresh_token: "REFRESH",
        id_token: await sign({
          nonce: requested.searchParams.get("nonce"),
          aud: "issued",
        }),
        token_type: "Bearer",
        expires_in: 3600,
        scope: "resource.invoke chatgpt.tokens.use.direct",
      });
    }
    return http(url, init);
  };
  const s = createAuthService({ cipher, http: mock });
  const result = await s.loginChatGpt({
    stateDir: dir,
    onUrl: (url) => {
      requested = new URL(url);
      assert.equal(
        requested.searchParams.get("client_id"),
        "dynamic_agent_client",
      );
      assert.equal(requested.searchParams.get("agent_name_hint"), "Qling");
      assert.match(
        requested.searchParams.get("ext_agent_host_id"),
        /^urn:uuid:/,
      );
      const callback = new URL(requested.searchParams.get("redirect_uri"));
      callback.search = new URLSearchParams({
        state: requested.searchParams.get("state"),
        code: "code",
        client_id: "issued",
      }).toString();
      void fetch(callback);
    },
  });
  assert.equal(result.credential.accessToken, "ACCESS");
  assert.equal(await s.loadActiveProfile(dir), null);
});
test("invalid state and cancellation preserve current active connection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-oauth-"));
  const s = createAuthService({
    cipher,
    http: async () => {
      throw Error("must not request token");
    },
  });
  const profile = {
    id: "old",
    provider: "xai",
    method: "api_key",
    endpoint: "https://api.x.ai/v1",
    model: "m",
  };
  await s.saveConnection(dir, profile, { apiKey: "OLD" });
  await assert.rejects(
    s.loginChatGpt({
      stateDir: dir,
      onUrl: (url) => {
        const u = new URL(new URL(url).searchParams.get("redirect_uri"));
        u.search = "state=bad&code=code";
        void fetch(u);
      },
    }),
    /state/,
  );
  const controller = new AbortController();
  await assert.rejects(
    s.loginChatGpt({
      stateDir: dir,
      signal: controller.signal,
      onUrl: () => controller.abort(),
    }),
    /cancelled|abort/i,
  );
  assert.equal(await s.resolveProfileCredential(dir, profile), "OLD");
});
test("refresh is single flight and keeps rotating token in protected snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-oauth-"));
  let count = 0;
  const s = createAuthService({
    cipher,
    http: async (url, init) => {
      assert.equal(url, TOKEN_URL);
      assert.equal(init.body.get("refresh_token"), "OLD_REFRESH");
      count++;
      await new Promise((r) => setTimeout(r, 10));
      return response({
        access_token: "NEW",
        refresh_token: "ROTATED",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "resource.invoke chatgpt.tokens.use.direct",
      });
    },
  });
  const p = {
    id: "c",
    provider: "chatgpt",
    method: "chatgpt_oauth",
    endpoint: "https://api.openai.com/v1",
    model: "m",
  };
  await s.saveConnection(dir, p, {
    accessToken: "OLD",
    refreshToken: "OLD_REFRESH",
    expiresAt: 1,
    clientId: "client",
    issuer: ISSUER,
    subject: "user",
    scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
  });
  assert.deepEqual(
    await Promise.all(
      Array.from({ length: 8 }, () => s.resolveProfileCredential(dir, p)),
    ),
    Array(8).fill("NEW"),
  );
  assert.equal(count, 1);
});
test("concurrent rejected-token refresh is single flight even before expiry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-oauth-"));
  let count = 0;
  const s = createAuthService({
    cipher,
    http: async (url, init) => {
      assert.equal(url, TOKEN_URL);
      assert.equal(init.body.get("refresh_token"), "OLD_REFRESH");
      count++;
      await new Promise((r) => setTimeout(r, 10));
      return response({
        access_token: "NEW",
        refresh_token: "ROTATED",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "resource.invoke chatgpt.tokens.use.direct",
      });
    },
  });
  const p = {
    id: "c",
    provider: "chatgpt",
    method: "chatgpt_oauth",
    endpoint: "https://api.openai.com/v1",
    model: "m",
  };
  await s.saveConnection(dir, p, {
    accessToken: "OLD",
    refreshToken: "OLD_REFRESH",
    expiresAt: Date.now()+3600000,
    clientId: "client",
    issuer: ISSUER,
    subject: "user",
    scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
  });
  assert.deepEqual(
    await Promise.all(
      Array.from({ length: 8 }, () => s.resolveProfileCredential(dir, p, {rejectedAccessToken:"OLD"})),
    ),
    Array(8).fill("NEW"),
  );
  assert.equal(count, 1);
});
test("cancellation during JWKS cannot return authorized credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-oauth-"));
  const controller = new AbortController();
  let requested;
  let observedSignal;
  const mock = async (url, init) => {
    if (url === TOKEN_URL)
      return response({
        access_token: "ACCESS",
        id_token: await sign({
          nonce: requested.searchParams.get("nonce"),
          aud: "issued",
        }),
        token_type: "Bearer",
        expires_in: 3600,
        scope: "resource.invoke chatgpt.tokens.use.direct",
      });
    if (url === ISSUER + "/keys") {
      observedSignal = init?.signal;
      controller.abort();
      return response({ keys: [jwk] });
    }
    return http(url, init);
  };
  const s = createAuthService({ cipher, http: mock });
  await assert.rejects(
    s.loginChatGpt({
      stateDir: dir,
      signal: controller.signal,
      onUrl: (url) => {
        requested = new URL(url);
        const callback = new URL(requested.searchParams.get("redirect_uri"));
        callback.search = new URLSearchParams({
          state: requested.searchParams.get("state"),
          code: "code",
          client_id: "issued",
        });
        void fetch(callback);
      },
    }),
  );
  assert.ok(observedSignal?.aborted);
  assert.equal(await s.loadActiveProfile(dir), null);
});
test(
  "pending browser startup settles promptly on cancellation",
  { timeout: 1500 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "qling-oauth-"));
    const controller = new AbortController();
    const s = createAuthService({ cipher, http });
    await assert.rejects(
      s.loginChatGpt({
        stateDir: dir,
        signal: controller.signal,
        onUrl: () => {},
        openBrowser: () => {
          setTimeout(() => controller.abort(), 10);
          return new Promise(() => {});
        },
      }),
      /cancelled|abort/i,
    );
    assert.equal(await s.loadActiveProfile(dir), null);
  },
);

test('fresh authorization permits B after A without inheriting A scopes or refresh token', async () => {
  const dir=await mkdtemp(join(tmpdir(),'qling-fresh-grant-'));
  const old={accessToken:'A',refreshToken:'A-REFRESH',clientId:'client',subject:'A',issuer:ISSUER,scopes:['resource.invoke','chatgpt.tokens.use.direct'],expiresAt:Date.now()+3600000};
  const p={id:'A',provider:'chatgpt',method:'chatgpt_oauth',endpoint:'https://api.openai.com/v1',model:'m'};
  let requested, omitScope=false;
  const mock=async(url,init)=>{
    if(url===TOKEN_URL){
      assert.equal(init.body.get('grant_type'),'authorization_code');
      const id=await new SignJWT({nonce:requested.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'key'}).setSubject('B').setIssuer(ISSUER).setAudience('client').setIssuedAt().setExpirationTime('1h').sign(privateKey);
      return response({access_token:'B',id_token:id,token_type:'Bearer',expires_in:3600,...(!omitScope?{scope:'resource.invoke chatgpt.tokens.use.direct'}:{})});
    }
    return http(url,init);
  };
  const service=createAuthService({cipher,http:mock});
  await service.saveConnection(dir,p,old);
  const login=()=>service.loginChatGpt({stateDir:dir,onUrl:url=>{
    requested=new URL(url);
    assert.equal(requested.searchParams.get('client_id'),'client');
    const callback=new URL(requested.searchParams.get('redirect_uri'));
    callback.search=new URLSearchParams({state:requested.searchParams.get('state'),code:'code',client_id:'client'});
    void fetch(callback);
  }});
  const fresh=await login();
  assert.equal(fresh.credential.subject,'B');
  assert.equal(fresh.credential.refreshToken,undefined);
  assert.equal(await service.resolveProfileCredential(dir,p),'A');
  omitScope=true;
  await assert.rejects(login(),/Insufficient.*scopes/);
  assert.equal(await service.resolveProfileCredential(dir,p),'A');
  const tokenB=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:'key'}).setSubject('B').setIssuer(ISSUER).setAudience('client').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  await assert.rejects(tokenCredential(http,{access_token:'B',id_token:tokenB,token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'},'client',undefined,old),/identity mismatch/);
});
