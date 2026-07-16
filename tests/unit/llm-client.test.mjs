import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { LlmHttpClient } from "../../dist/providers/llm-client.js";

function startFakeServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

test("LlmHttpClient parses tool calls and provider usage", async () => {
  const fake = await startFakeServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      assert.match(req.url ?? "", /chat\/completions/);
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, "test-model");
      assert.equal(parsed.messages[0].role, "system");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "hello",
                tool_calls: [
                  {
                    id: "c1",
                    function: { name: "read", arguments: { path: "a.ts" } },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        })
      );
    });
  });

  try {
    const client = new LlmHttpClient({
      endpoint: fake.base + "/v1",
      apiKey: "k",
      timeoutMs: 5000,
      provider: "fake",
    });
    const result = await client.chatCompletions({
      model: "test-model",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "read",
          description: "read file",
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    assert.equal(result.content, "hello");
    assert.equal(result.tool_calls?.[0]?.function.name, "read");
    assert.equal(result.usage?.totalTokens, 5);
  } finally {
    await fake.close();
  }
});

test("LlmHttpClient aborts an in-flight request without transport retries", async () => {
  let requests = 0;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const fake = await startFakeServer((_req, _res) => {
    requests++;
    markStarted();
  });
  try {
    const client = new LlmHttpClient({
      endpoint: fake.base + "/v1",
      apiKey: "k",
      timeoutMs: 5000,
      provider: "fake",
    });
    const controller = new AbortController();
    const pending = client.chatCompletions({
      model: "test-model",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "wait" }],
      tools: [],
      signal: controller.signal,
    });
    await Promise.race([
      started,
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("request did not start")), 500)),
    ]);
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === "AgentRunCanceledError");
    assert.equal(requests, 1);
  } finally {
    await fake.close();
  }
});
