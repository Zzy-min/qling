import test from "node:test";
import assert from "node:assert/strict";

import { runUrlFetch } from "../../dist/tools/url-fetch.js";
import { redactText } from "../../dist/guard.js";

async function withEnv(patch, fn) {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const value = patch[key];
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("url_fetch: missing url returns coded error", async () => {
  const result = await runUrlFetch({ url: "" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[URL_FETCH_MISSING_URL\]/);
});

test("url_fetch: prefix policy denies non-allowlisted target", async () => {
  await withEnv(
    {
      QLING_GUARD_ENABLED: "true",
      QLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES: JSON.stringify([
        "https://allowlisted.example/",
      ]),
      QLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "true",
    },
    async () => {
      const result = await runUrlFetch({ url: "https://example.com/data" });
      assert.equal(result.is_error, true);
      assert.match(result.output, /^Error: \[URL_FETCH_GUARD_BLOCKED\]/);
    }
  );
});

test("url_fetch: private host is blocked before network call", async () => {
  await withEnv(
    {
      QLING_GUARD_ENABLED: "true",
      QLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES: JSON.stringify(["http://"]),
      QLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "true",
    },
    async () => {
      const result = await runUrlFetch({ url: "http://127.0.0.1:65535/ping" });
      assert.equal(result.is_error, true);
      assert.match(result.output, /^Error: \[URL_FETCH_GUARD_BLOCKED\]/);
      assert.match(result.output, /private ip host blocked/i);
    }
  );
});

test("guard redaction masks secrets", () => {
  const guard = {
    enabled: true,
    network: {
      url_fetch: {
        allowed_url_prefixes: ["https://"],
        deny_private_ips: true,
        follow_redirects: false,
      },
    },
    redaction: {
      enabled: true,
      patterns: ["SECRET_[A-Z0-9_]+"],
    },
    audit: {
      jsonl_path: "./tmp-guard-audit.jsonl",
    },
  };
  const redacted = redactText("token=sk-abcdef1234567890 SECRET_KEY_XYZ", guard);
  assert.doesNotMatch(redacted, /sk-abcdef/);
  assert.doesNotMatch(redacted, /SECRET_KEY_XYZ/);
  assert.match(redacted, /\[REDACTED\]/);
});

test("redirects are checked before following and oversized bodies are canceled", async () => {
  const oldFetch = globalThis.fetch;
  try {
    await withEnv({ QLING_GUARD_ENABLED: "true", QLING_GUARD_NETWORK_MODE: "guarded", QLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES: '["https://allowed.invalid/"]', QLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "false", QLING_GUARD_NETWORK_URL_FETCH_FOLLOW_REDIRECTS: "true" }, async () => {
      const requested = [];
      globalThis.fetch = async (url, init) => {
        requested.push(String(url));
        assert.equal(init.redirect, "manual");
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
      };
      const redirected = await runUrlFetch({ url: "https://allowed.invalid/start" });
      assert.equal(redirected.is_error, true);
      assert.match(redirected.output, /REDIRECT_BLOCKED/);
      assert.deepEqual(requested, ["https://allowed.invalid/start"]);
      let canceled = false;
      globalThis.fetch = async () => new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { canceled = true; },
      }), { headers: { "content-type": "text/plain" } });
      const oversized = await runUrlFetch({ url: "https://allowed.invalid/large" });
      assert.equal(oversized.is_error, true);
      assert.equal(canceled, true);
    });
  } finally { globalThis.fetch = oldFetch; }
});
