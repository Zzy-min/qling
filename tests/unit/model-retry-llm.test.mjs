import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { LlmHttpClient, ProviderHttpError } from "../../dist/providers/llm-client.js";

function startFakeServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(() => done());
        }),
      });
    });
  });
}

function clientFor(base) {
  return new LlmHttpClient({
    endpoint: `${base}/v1`,
    apiKey: "test-key",
    timeoutMs: 5000,
    provider: "fake",
  });
}

async function expectStreamError(handler, check) {
  const fake = await startFakeServer(handler);
  try {
    const client = clientFor(fake.base);
    await assert.rejects(
      client.chatCompletions({
        model: "test-model",
        systemPrompt: "sys",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        stream: true,
      }),
      (error) => {
        assert.ok(error instanceof ProviderHttpError);
        check(error);
        assert.doesNotMatch(error.message, /test-key/);
        return true;
      },
    );
  } finally {
    await fake.close();
  }
}

test("model-retry llm: socket destroy mid-SSE is a retriable stream_interrupted", async () => {
  let requests = 0;
  await expectStreamError((req, res) => {
    requests++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"aa"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{\\"pa"}}]}}]}\n\n');
    req.socket.destroy();
  }, (error) => {
    assert.equal(error.code, "stream_interrupted");
    assert.equal(error.retriable, true);
    assert.equal(error.status, undefined);
    assert.match(error.message, /tool_call_fragment=/);
  });
  assert.equal(requests, 1);
});

test("model-retry llm: upstream SSE error frame is retriable", async () => {
  await expectStreamError((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"error":{"message":"grok gateway upstream stream error"}}\n\n');
    res.end();
  }, (error) => {
    assert.equal(error.code, "upstream_stream_error");
    assert.equal(error.retriable, true);
    assert.match(error.message, /grok gateway upstream stream error/);
  });
});

test("model-retry llm: SSE auth error frame is not retriable", async () => {
  let requests = 0;
  await expectStreamError((_req, res) => {
    requests++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"error":{"message":"bad key","type":"authentication_error","code":"authentication_error"}}\n\n');
    res.end();
  }, (error) => {
    assert.equal(error.retriable, false);
    assert.equal(error.code, "authentication_error");
  });
  assert.equal(requests, 1);
});

test("model-retry llm: EOF without DONE or finish_reason is interrupted", async () => {
  await expectStreamError((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
    res.end();
  }, (error) => {
    assert.equal(error.code, "stream_interrupted");
    assert.equal(error.retriable, true);
  });
});

test("model-retry llm: finish_reason without DONE is success", async () => {
  const fake = await startFakeServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n');
    res.end();
  });
  try {
    const result = await clientFor(fake.base).chatCompletions({
      model: "test-model",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      stream: true,
    });
    assert.equal(result.content, "ok");
    assert.equal(result.finishReason, "stop");
    assert.equal(result.streamed, true);
  } finally {
    await fake.close();
  }
});

test("model-retry llm: 429 carries Retry-After and 401 is not retriable", async () => {
  for (const status of [429, 401]) {
    let requests = 0;
    const fake = await startFakeServer((_req, res) => {
      requests++;
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Retry-After": "2",
        "X-Request-Id": `req-${status}`,
      });
      res.end(JSON.stringify({ error: { message: "nope", code: status === 429 ? "rate_limit" : "authentication_error" } }));
    });
    try {
      await assert.rejects(
        clientFor(fake.base).chatCompletions({
          model: "test-model",
          systemPrompt: "sys",
          messages: [{ role: "user", content: "hi" }],
          tools: [],
        }),
        (error) => {
          assert.ok(error instanceof ProviderHttpError);
          assert.equal(error.status, status);
          assert.equal(error.retriable, status === 429);
          assert.equal(error.retryAfterMs, 2000);
          assert.equal(error.requestId, `req-${status}`);
          return true;
        },
      );
      assert.equal(requests, 1);
    } finally {
      await fake.close();
    }
  }
});

test("model-retry llm: idle timeout aborts as stream_interrupted", async () => {
  const previous = process.env.QLING_LLM_STREAM_IDLE_MS;
  process.env.QLING_LLM_STREAM_IDLE_MS = "200";
  const fake = await startFakeServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
  });
  const started = Date.now();
  try {
    await assert.rejects(
      clientFor(fake.base).chatCompletions({
        model: "test-model",
        systemPrompt: "sys",
        messages: [{ role: "user", content: "wait" }],
        tools: [],
        stream: true,
      }),
      (error) => {
        assert.ok(error instanceof ProviderHttpError);
        assert.equal(error.code, "stream_interrupted");
        assert.equal(error.retriable, true);
        return true;
      },
    );
    assert.ok(Date.now() - started >= 150);
  } finally {
    if (previous === undefined) delete process.env.QLING_LLM_STREAM_IDLE_MS;
    else process.env.QLING_LLM_STREAM_IDLE_MS = previous;
    await fake.close();
  }
});
