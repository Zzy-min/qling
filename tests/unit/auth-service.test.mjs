import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthService } from "../../dist/auth/service.js";
import { parseGrokStore } from "../../dist/auth/grok.js";
const cipher = {
  encrypt: async (x) => Buffer.from(x).toString("base64"),
  decrypt: async (x) => Buffer.from(x, "base64").toString(),
};
const profile = {
  id: "a",
  provider: "xai",
  method: "api_key",
  endpoint: "https://api.x.ai/v1",
  model: "grok-build",
};
test("isolated vault metadata and detached logout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-auth-"));
  const s = createAuthService({ cipher });
  await s.saveConnection(dir, profile, { apiKey: "SECRET" });
  assert.deepEqual(await s.loadActiveProfile(dir), profile);
  assert.equal(await s.resolveProfileCredential(dir, profile), "SECRET");
  assert.ok(
    !(await readFile(join(dir, "auth", "connections.json"), "utf8")).includes(
      "SECRET",
    ),
  );
  await assert.rejects(
    s.resolveProfileCredential(dir, { ...profile, provider: "openai" }),
    /mismatch/,
  );
  await s.logoutProfile(dir, "openai");
  assert.ok(await s.loadActiveProfile(dir));
  await s.logoutProfile(dir);
  assert.equal(await s.loadActiveProfile(dir), null);
});
test("failed activation leaves previous connection usable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-auth-"));
  let fail = false;
  const s = createAuthService({
    cipher: {
      ...cipher,
      encrypt: async (x) => {
        if (fail) throw Error("write failed");
        return cipher.encrypt(x);
      },
    },
  });
  await s.saveConnection(dir, profile, { apiKey: "OLD" });
  fail = true;
  await assert.rejects(
    s.saveConnection(dir, { ...profile, id: "b" }, { apiKey: "NEW" }),
  );
  assert.equal(await s.resolveProfileCredential(dir, profile), "OLD");
});
test("Grok parser accepts official sessions and rejects API keys, foreign issuers and expired", () => {
  const session = {
    key: "SESSION",
    auth_mode: "oidc",
    oidc_issuer: "https://auth.x.ai",
    oidc_client_id: "official",
    create_time: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };
  assert.equal(
    parseGrokStore({ "https://auth.x.ai::official": session }).accessToken,
    "SESSION",
  );
  assert.throws(
    () =>
      parseGrokStore({ "xai::api_key": { ...session, auth_mode: "api_key" } }),
    /needs_login/,
  );
  assert.throws(
    () =>
      parseGrokStore({
        "https://foreign::id": { ...session, oidc_issuer: "https://evil.test" },
      }),
    /needs_login/,
  );
  assert.throws(
    () =>
      parseGrokStore({
        "https://auth.x.ai::official": { ...session, expires_at: "2020-01-01" },
      }),
    /needs_login/,
  );
});
test("managed origins cannot be overridden", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-auth-"));
  const s = createAuthService({ cipher });
  await assert.rejects(
    s.saveConnection(
      dir,
      {
        ...profile,
        provider: "chatgpt",
        method: "chatgpt_oauth",
        endpoint: "https://evil.test",
      },
      { accessToken: "secret" },
    ),
    /official/,
  );
});
test("logout retires owned secret snapshots but never touches official Grok store", async () => {
  const { readdir, writeFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "qling-auth-"));
  const s = createAuthService({ cipher });
  const fakeOfficial = join(dir, "official-grok.json");
  await writeFile(fakeOfficial, "OFFICIAL");
  await s.saveConnection(dir, profile, { apiKey: "OLD" });
  await s.saveConnection(dir, profile, { apiKey: "NEW" });
  assert.equal(
    (await readdir(join(dir, "auth"))).filter((n) =>
      n.startsWith("credential-"),
    ).length,
    1,
  );
  await s.logoutProfile(dir);
  assert.equal(
    (await readdir(join(dir, "auth"))).filter((n) =>
      n.startsWith("credential-"),
    ).length,
    0,
  );
  assert.equal(await readFile(fakeOfficial, "utf8"), "OFFICIAL");
});
test("native cipher roundtrips synthetic credentials", async () => {
  const { platformCipher } = await import("../../dist/auth/store.js");
  const encrypted = await platformCipher.encrypt("SYNTHETIC-TEST-ONLY");
  assert.ok(!encrypted.includes("SYNTHETIC-TEST-ONLY"));
  assert.equal(await platformCipher.decrypt(encrypted), "SYNTHETIC-TEST-ONLY");
});
test("Grok expiry requires explicit supported metadata without lifetime assumptions", () => {
  const session = {
    key: "SESSION",
    auth_mode: "oidc",
    oidc_issuer: "https://auth.x.ai",
    oidc_client_id: "official",
    create_time: new Date().toISOString(),
  };
  const store = (e) => ({ "https://auth.x.ai::official": e });
  assert.throws(() => parseGrokStore(store(session)), /needs_login/);
  assert.throws(
    () =>
      parseGrokStore(store({ ...session, expires_at: Date.now() + 3600000 })),
    /needs_login/,
  );
  for (const expiry of ["2030-01-01T00:00:00Z", "2030-01-01T01:00:00+01:00"])
    assert.equal(
      parseGrokStore(store({ ...session, expires_at: expiry })).expiresAt,
      Date.parse("2030-01-01T00:00:00Z"),
    );
});
