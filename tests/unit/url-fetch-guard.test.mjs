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
      QINGLING_GUARD_ENABLED: "true",
      QINGLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES: JSON.stringify([
        "https://allowlisted.example/",
      ]),
      QINGLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "true",
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
      QINGLING_GUARD_ENABLED: "true",
      QINGLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES: JSON.stringify(["http://"]),
      QINGLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "true",
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
