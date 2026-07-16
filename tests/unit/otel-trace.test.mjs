import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { createOtelTraceBridge, genericToolKind } from "../../dist/execution/otel-trace.js";

const ENABLED_ENV = {
  QLING_METRICS_OTEL_ENABLED: "true",
  QLING_OTEL_EXPORT_CONFIRM: "metadata-only",
  QLING_METRICS_OTEL_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
  QLING_METRICS_OTEL_BATCH_DELAY_MS: "50",
};

test("disabled OTEL does not need an exporter", async () => {
  const result = await createOtelTraceBridge({
    sessionId: "session-secret",
    version: "1.2.2",
    env: {},
  });
  assert.equal(result.config.state, "off");
  assert.equal(result.bridge, null);
});

test("OTEL exports only fixed metadata and preserves run/tool parenting", async () => {
  const exporter = new InMemorySpanExporter();
  const { bridge } = await createOtelTraceBridge({
    sessionId: "session-CANARY",
    version: "1.2.2",
    env: ENABLED_ENV,
    exporter,
  });
  assert.ok(bridge);

  const taskCanary = "TASK_CANARY_DO_NOT_EXPORT";
  const pathCanary = "C:/Users/private/PATH_CANARY";
  bridge.record({ runId: "run-1", type: "run_started", timestamp: Date.now(), stage: taskCanary });
  bridge.record({
    runId: "run-1",
    toolCallId: "tool-1",
    type: "tool_started",
    timestamp: Date.now(),
    tool: `patch_${pathCanary}`,
  });
  bridge.record({
    runId: "run-1",
    toolCallId: "tool-1",
    type: "tool_completed",
    timestamp: Date.now(),
    status: "succeeded",
    tool: `patch_${pathCanary}`,
  });
  bridge.record({
    runId: "run-1",
    type: "run_completed",
    timestamp: Date.now(),
    status: "succeeded",
    category: taskCanary,
  });
  await bridge.flush();

  const spans = exporter.getFinishedSpans();
  assert.equal(spans.length, 2);
  const run = spans.find((span) => span.name === "qling.run");
  const tool = spans.find((span) => span.name === "qling.tool");
  assert.ok(run);
  assert.ok(tool);
  assert.equal(tool.parentSpanContext?.spanId, run.spanContext().spanId);
  assert.equal(tool.attributes["qling.tool.kind"], "write");
  const payload = JSON.stringify(spans.map((span) => ({ name: span.name, attributes: span.attributes })));
  assert.doesNotMatch(payload, /CANARY|C:\/Users|patch_/);
  assert.match(payload, /"qling\.failure\.category":"other"/);
  await bridge.shutdown();
});

test("exporter failure disables later sends without failing shutdown", async () => {
  let calls = 0;
  let disabled = 0;
  const exporter = {
    export(_spans, callback) {
      calls += 1;
      callback({ code: 1, error: new Error("RAW_CANARY") });
    },
    async shutdown() {},
  };
  const { bridge } = await createOtelTraceBridge({
    sessionId: "session",
    version: "1.2.2",
    env: ENABLED_ENV,
    exporter,
    onDisabled: () => { disabled += 1; },
  });
  bridge.record({ runId: "a", type: "run_started", timestamp: Date.now() });
  bridge.record({ runId: "a", type: "run_completed", timestamp: Date.now(), status: "failed" });
  await bridge.shutdown();
  assert.equal(calls, 1);
  assert.equal(disabled, 1);
});

test("tool names collapse to a fixed generic kind", () => {
  assert.equal(genericToolKind("read_file_C:/private"), "read");
  assert.equal(genericToolKind("totally-secret-custom-tool"), "other");
});

test("real OTLP/HTTP exporter sends protobuf to the configured local trace path without canaries", async () => {
  let requestPath = "";
  let requestBody = Buffer.alloc(0);
  const received = new Promise((resolve) => {
    const server = createServer((request, response) => {
      requestPath = request.url ?? "";
      const chunks = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        requestBody = Buffer.concat(chunks);
        response.writeHead(200, { "content-type": "application/x-protobuf" });
        response.end();
        resolve();
      });
    });
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const { bridge } = await createOtelTraceBridge({
        sessionId: "session-NETWORK_CANARY",
        version: "1.2.2",
        env: {
          ...ENABLED_ENV,
          QLING_METRICS_OTEL_ENDPOINT: `http://127.0.0.1:${address.port}/v1/traces`,
        },
      });
      bridge.record({ runId: "net", type: "run_started", timestamp: Date.now() });
      bridge.record({
        runId: "net",
        toolCallId: "net-tool",
        type: "tool_started",
        timestamp: Date.now(),
        tool: "shell_SECRET_COMMAND_CANARY",
      });
      bridge.record({
        runId: "net",
        toolCallId: "net-tool",
        type: "tool_completed",
        timestamp: Date.now(),
        status: "succeeded",
      });
      bridge.record({ runId: "net", type: "run_completed", timestamp: Date.now(), status: "succeeded" });
      await bridge.shutdown();
      server.close();
    });
  });
  await received;
  assert.equal(requestPath, "/v1/traces");
  assert.ok(requestBody.length > 0);
  assert.doesNotMatch(requestBody.toString("utf8"), /CANARY|SECRET_COMMAND/);
  assert.match(requestBody.toString("utf8"), /qling\.run/);
});
