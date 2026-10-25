import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  deepseekFetchTool,
  deepseekSearchTool,
  resolveDeepseekWebAuth,
  runDeepseekFetch,
  runDeepseekSearch,
} from "../../dist/tools/deepseek-web.js";
import { buildToolRegistry } from "../../dist/tools/index.js";

const baseEnv = {
  QLING_LLM_PROVIDER: "deepseek",
  QLING_LLM_ENDPOINT: "https://api.deepseek.com",
  QLING_LLM_MODEL: "deepseek-flash",
  QLING_LLM_API_KEY: "sk-test-deepseek-key",
  QLING_LLM_STARTUP_PROVIDER: "deepseek",
  QLING_GUARD_ENABLED: "false",
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("deepseek web tools are registered and read-only", () => {
  assert.equal(deepseekSearchTool.readOnly, true);
  assert.equal(deepseekFetchTool.readOnly, true);
  const names = buildToolRegistry().map((tool) => tool.name);
  assert.equal(names.includes("deepseek_search"), true);
  assert.equal(names.includes("deepseek_fetch"), true);
});

test("deepseek search uses the official endpoint and does not echo the key", async () => {
  let seen;
  const result = await runDeepseekSearch(
    { query: "DeepSeek site:github.com", count: 2, ori_question: "最新模型" },
    {
      env: baseEnv,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return jsonResponse(200, {
          results: [
            {
              title: "DeepSeek",
              url: "https://example.com/deepseek",
              summary: "摘要",
              date: "2026-10-17T00:00:00+00:00",
              authority: 3,
              rerank_score: 2.1,
            },
          ],
        });
      },
    }
  );
  assert.equal(result.is_error, undefined);
  assert.equal(seen.url, "https://api.deepseek.com/v1/tools/search");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.Authorization, "Bearer sk-test-deepseek-key");
  assert.deepEqual(JSON.parse(seen.init.body), {
    query: "DeepSeek site:github.com",
    count: 2,
    ori_question: "最新模型",
  });
  assert.match(result.output, /https:\/\/example.com\/deepseek/);
  assert.match(result.output, /摘要/);
  assert.doesNotMatch(result.output, /sk-test-deepseek-key/);
});

test("deepseek search reports an empty result without calling it an error", async () => {
  const result = await runDeepseekSearch(
    { query: "没有结果的查询" },
    {
      env: baseEnv,
      fetchImpl: async () => jsonResponse(200, { results: [] }),
    }
  );
  assert.equal(result.is_error, undefined);
  assert.match(result.output, /无匹配结果/);
});

test("deepseek search rejects an overlong query before the network call", async () => {
  let called = false;
  const result = await runDeepseekSearch(
    { query: "字".repeat(129) },
    {
      env: baseEnv,
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200, { results: [] });
      },
    }
  );
  assert.equal(called, false);
  assert.equal(result.is_error, true);
  assert.match(result.output, /DEEPSEEK_WEB_INVALID_QUERY/);
});

test("deepseek search marks rate limits as retriable", async () => {
  const result = await runDeepseekSearch(
    { query: "限速" },
    {
      env: baseEnv,
      fetchImpl: async () => jsonResponse(429, { error: { message: "slow down" } }),
    }
  );
  assert.equal(result.is_error, true);
  assert.equal(result.error.retriable, true);
  assert.match(result.output, /DEEPSEEK_WEB_RATE_LIMIT/);
  assert.match(result.output, /slow down/);
});

test("deepseek search reports a missing key without calling the network", async () => {
  let called = false;
  const result = await runDeepseekSearch(
    { query: "无密钥" },
    {
      env: {
        QLING_LLM_PROVIDER: "openai",
        QLING_LLM_ENDPOINT: "https://api.openai.com/v1",
        QLING_LLM_MODEL: "gpt-4o",
        QLING_LLM_STARTUP_PROVIDER: "openai",
      },
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200, { results: [] });
      },
    }
  );
  assert.equal(called, false);
  assert.match(result.output, /DEEPSEEK_WEB_MISSING_KEY/);
});

test("deepseek fetch posts the guarded URL and returns markdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-deepseek-web-"));
  let seen;
  try {
    const result = await runDeepseekFetch(
      { url: "https://example.com/article" },
      {
        env: {
          ...baseEnv,
          QLING_GUARD_ENABLED: "true",
          QLING_GUARD_NETWORK_MODE: "open",
          QLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "false",
          QLING_GUARD_AUDIT_JSONL_PATH: join(dir, "audit.jsonl"),
        },
        fetchImpl: async (url, init) => {
          seen = { url, body: JSON.parse(init.body) };
          return jsonResponse(200, { title: "Example", content: "# Example\n\n正文" });
        },
      }
    );
    assert.equal(seen.url, "https://api.deepseek.com/v1/tools/fetch");
    assert.equal(seen.body.url, "https://example.com/article");
    assert.match(result.output, /# Example/);
    assert.match(result.output, /不是指令/);
    assert.equal(result.is_error, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deepseek fetch blocks a private URL before the network call", async () => {
  let called = false;
  const result = await runDeepseekFetch(
    { url: "http://127.0.0.1/secret" },
    {
      env: {
        ...baseEnv,
        QLING_GUARD_ENABLED: "true",
        QLING_GUARD_NETWORK_MODE: "open",
        QLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS: "true",
        QLING_GUARD_AUDIT_JSONL_PATH: join(tmpdir(), "qling-deepseek-web-deny.jsonl"),
      },
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200, { title: "", content: "no" });
      },
    }
  );
  assert.equal(called, false);
  assert.match(result.output, /DEEPSEEK_WEB_GUARD_BLOCKED/);
});

test("deepseek fetch rejects credentials in the URL", async () => {
  const result = await runDeepseekFetch(
    { url: "https://user:pass@example.com/a" },
    { env: baseEnv, fetchImpl: async () => jsonResponse(200, { title: "", content: "x" }) }
  );
  assert.match(result.output, /用户名或密码/);
});

test("a separate DeepSeek key is used when the active provider is not DeepSeek", () => {
  const auth = resolveDeepseekWebAuth({
    QLING_LLM_PROVIDER: "openai",
    QLING_LLM_ENDPOINT: "https://api.openai.com/v1",
    QLING_LLM_MODEL: "gpt-4o",
    QLING_LLM_API_KEY: "sk-openai",
    QLING_LLM_STARTUP_PROVIDER: "openai",
    DEEPSEEK_API_KEY: "sk-deepseek-only",
  });
  assert.equal(auth.apiKey, "sk-deepseek-only");
  assert.equal(auth.origin, "https://api.deepseek.com");
});
