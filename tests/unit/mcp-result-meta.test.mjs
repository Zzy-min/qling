import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMcpResult } from "../../dist/mcp/client.js";

test("MCP summary keeps text preview and image metadata without base64", () => {
  const summary = summarizeMcpResult("demo", "inspect", {
    content: [
      { type: "text", text: "hello world" },
      { type: "image", mimeType: "image/png", data: Buffer.from("abc").toString("base64") },
    ],
    structuredContent: { ok: true, rows: 3 },
  });
  assert.equal(summary.server, "demo");
  assert.equal(summary.tool, "inspect");
  assert.equal(summary.content[0].type, "text");
  assert.equal(summary.content[0].preview, "hello world");
  assert.equal(summary.content[1].type, "image");
  assert.equal(summary.content[1].mimeType, "image/png");
  assert.equal(summary.content[1].bytes, 3);
  assert.deepEqual(summary.structuredContent, { ok: true, rows: 3 });
});

test("MCP summary caps oversized structuredContent", () => {
  const summary = summarizeMcpResult("demo", "huge", {
    structuredContent: { blob: "x".repeat(20_000) },
  });
  assert.equal(summary.structuredContent.truncated, true);
  assert.ok(summary.structuredContent.bytes > 16 * 1024);
});
