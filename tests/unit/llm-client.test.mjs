import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { LlmHttpClient, ProviderHttpError } from "../../dist/providers/llm-client.js";

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

test("LlmHttpClient preserves sanitized provider HTTP metadata without hidden retries", async () => {
  for (const status of [504, 401]) {
    let requests = 0;
    const fake = await startFakeServer((_req, res) => {
      requests++;
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Retry-After": "2",
        "X-Request-Id": `request-${status}`,
      });
      res.end(JSON.stringify({ error: { code: `E${status}`, message: "Bearer top-secret-token" } }));
    });
    try {
      const client = new LlmHttpClient({
        endpoint: fake.base + "/v1",
        apiKey: "x",
        timeoutMs: 1000,
        provider: "fake",
      });
      await assert.rejects(
        client.chatCompletions({
          model: "test-model",
          systemPrompt: "sys",
          messages: [{ role: "user", content: "hi" }],
          tools: [],
        }),
        (error) => {
          assert.ok(error instanceof ProviderHttpError);
          assert.equal(error.status, status);
          assert.equal(error.requestId, `request-${status}`);
          assert.equal(error.retriable, status === 504);
          assert.equal(error.retryAfterMs, 2000);
          assert.doesNotMatch(error.message, /top-secret-token/);
          return true;
        }
      );
      assert.equal(requests, 1);
    } finally {
      await fake.close();
    }
  }
});

test("LlmHttpClient streams text deltas while accumulating complete tool JSON", async () => {
  const fake = await startFakeServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      assert.equal(JSON.parse(body).stream, true);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"lo","tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{\\"pa"}}]}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\\":\\\"a.ts\\\"}"}}]}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n');
      res.end("data: [DONE]\n\n");
    });
  });
  try {
    const deltas = [];
    const client = new LlmHttpClient({ endpoint: fake.base + "/v1", apiKey: "k", timeoutMs: 5000, provider: "fake" });
    const result = await client.chatCompletions({
      model: "test-model",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      stream: true,
      onTextDelta: (delta) => deltas.push(delta),
    });
    assert.deepEqual(deltas, ["Hel", "lo"]);
    assert.equal(result.content, "Hello");
    assert.equal(result.streamed, true);
    assert.equal(result.tool_calls[0].function.name, "read");
    assert.equal(result.tool_calls[0].function.arguments, '{"path":"a.ts"}');
    assert.equal(result.usage.totalTokens, 5);
  } finally {
    await fake.close();
  }
});

test("LlmHttpClient falls back once before any delta when streaming is unsupported", async () => {
  let requests = 0;
  const fake = await startFakeServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests++;
      const parsed = JSON.parse(body);
      if (parsed.stream) {
        res.writeHead(415, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "stream unsupported" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "fallback" } }] }));
    });
  });
  try {
    let fallbacks = 0;
    const client = new LlmHttpClient({ endpoint: fake.base + "/v1", apiKey: "k", timeoutMs: 5000, provider: "fake" });
    const result = await client.chatCompletions({
      model: "test-model",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      stream: true,
      onStreamFallback: () => fallbacks++,
    });
    assert.equal(result.content, "fallback");
    assert.equal(result.streamed, false);
    assert.equal(requests, 2);
    assert.equal(fallbacks, 1);
  } finally {
    await fake.close();
  }
});

test("LlmHttpClient aborts an active SSE stream immediately", async () => {
  let requests = 0;
  let markDelta;
  const deltaSeen = new Promise((resolve) => { markDelta = resolve; });
  const fake = await startFakeServer((_req, res) => {
    requests++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  });
  try {
    const controller = new AbortController();
    const client = new LlmHttpClient({ endpoint: fake.base + "/v1", apiKey: "k", timeoutMs: 5000, provider: "fake" });
    const pending = client.chatCompletions({
      model: "test-model",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "wait" }],
      tools: [],
      stream: true,
      signal: controller.signal,
      onTextDelta: () => markDelta(),
    });
    await deltaSeen;
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === "AgentRunCanceledError");
    assert.equal(requests, 1);
  } finally {
    await fake.close();
  }
});

test("LlmHttpClient does not retry a generic 400 as a stream capability fallback", async () => {
  let requests = 0;
  const fake = await startFakeServer((_req, res) => {
    requests++;
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid model" } }));
  });
  try {
    const client = new LlmHttpClient({ endpoint: fake.base + "/v1", apiKey: "k", timeoutMs: 5000, provider: "fake" });
    await assert.rejects(client.chatCompletions({
      model: "bad-model",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      stream: true,
    }), (error) => error instanceof ProviderHttpError && error.status === 400);
    assert.equal(requests, 1);
  } finally {
    await fake.close();
  }
});
