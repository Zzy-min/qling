// Local ACP streaming probe. No network.
// Drives QlingAcpServer with an in-memory SDK client and a mock agent that
// emits 20 text deltas, 50ms apart. Records TTFT, chunk fan-out, whether the
// joined chunks equal the full text, what a second overlapping prompt does,
// and whether initialize advertises loadSession.
import { performance } from "node:perf_hooks";
import { EventEmitter } from "node:events";
import * as acp from "@agentclientprotocol/sdk";

import { QlingAcpServer } from "../dist/cli/acp-server.js";

const SEGMENTS = Array.from({ length: 20 }, (_, index) => `p${String(index).padStart(2, "0")}|`);
const FULL_TEXT = SEGMENTS.join("");
const INTERVAL_MS = 50;

class StreamingMockAgent extends EventEmitter {
  constructor() {
    super();
    this.id = "eval-acp-stream";
    this.messages = [];
    this.runCount = 0;
  }

  async waitForInit() {}

  getSessionId() {
    return this.id;
  }

  addUserMessage(content) {
    this.messages.push(content);
  }

  setChannel() {}

  setPlanMode() {}

  setPermissionMode() {}

  subscribeExecutionEvents() {
    return () => {};
  }

  cancelActiveRun() {
    return false;
  }

  async shutdown() {}

  async run() {
    this.runCount += 1;
    if (this.runCount > 1) {
      await delay(20);
      return "SECOND";
    }
    let text = "";
    for (const segment of SEGMENTS) {
      await delay(INTERVAL_MS);
      text += segment;
      this.emit("response_delta", segment);
    }
    return text;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const agent = new StreamingMockAgent();
const textChunks = [];
let capture = false;
let captureStartedAt = 0;

const server = new QlingAcpServer(() => agent);
const clientApp = acp.client({ name: "qling-acp-stream-eval" })
  .onNotification(acp.methods.client.session.update, (ctx) => {
    const update = ctx.params.update;
    if (!capture || update.sessionUpdate !== "agent_message_chunk") return;
    const text = update.content && update.content.type === "text" ? update.content.text : "";
    textChunks.push({
      at: performance.now(),
      text: typeof text === "string" ? text : "",
    });
  })
  .onRequest(acp.methods.client.session.requestPermission, () => ({
    outcome: { outcome: "selected", optionId: "allow_once" },
  }));

const connection = clientApp.connect(server.createApp());
try {
  const initialized = await connection.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  const created = await connection.agent.request(acp.methods.agent.session.new, {
    cwd: process.cwd(),
    mcpServers: [],
  });

  capture = true;
  captureStartedAt = performance.now();
  const firstPrompt = connection.agent.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "stream" }],
  });
  await delay(0);
  const secondPrompt = connection.agent.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "second" }],
  }).then(
    (result) => (result.stopReason === "end_turn" ? "queued-ok" : "error"),
    () => "error",
  );

  await firstPrompt;
  capture = false;
  const finishedAt = performance.now();
  const concurrentPromptResult = await secondPrompt;
  const joined = textChunks.map((chunk) => chunk.text).join("");
  const firstChunkMs = textChunks.length > 0
    ? Math.round(textChunks[0].at - captureStartedAt)
    : null;

  process.stdout.write(JSON.stringify({
    firstChunkMs,
    chunkCount: textChunks.length,
    totalMs: Math.round(finishedAt - captureStartedAt),
    fullTextMatches: joined === FULL_TEXT,
    concurrentPromptResult,
    loadSessionSupported: initialized.agentCapabilities?.loadSession === true,
  }));
} finally {
  capture = false;
  connection.close();
  await server.shutdown();
}
