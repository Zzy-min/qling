import test from "node:test";
import assert from "node:assert/strict";
import { ToolCatalog } from "../../dist/mcp/tool-catalog.js";
import { truncateMcpResult } from "../../dist/mcp/registry.js";
import { MCP_CATALOG_TOOLS } from "../../dist/tools/mcp-catalog.js";

test("MCP tool catalog finds exact capabilities in top five and reduces eager schema surface", () => {
  const tools = Array.from({ length: 100 }, (_, index) => ({
    serverName: "demo",
    name: `capability_${index}`,
    description: `Perform unique operation number ${index}`,
    inputSchema: { type: "object", properties: { value: { type: "string" } } },
  }));
  const catalog = new ToolCatalog();
  catalog.replace(tools);
  let hits = 0;
  for (let index = 0; index < 100; index++) {
    const matches = catalog.search(`capability_${index}`, 5);
    if (matches.some((match) => match.name === `capability_${index}`)) hits++;
  }
  assert.ok(hits >= 90);
  const eagerChars = JSON.stringify(tools).length;
  const searchChars = JSON.stringify(MCP_CATALOG_TOOLS).length;
  assert.ok(searchChars <= eagerChars * 0.2);
});

test("MCP output truncation uses UTF-8 bytes and structured metadata", () => {
  const result = truncateMcpResult(
    { tool_call_id: "x", output: "你".repeat(1000) },
    1024
  );
  assert.equal(result.meta.truncated, true);
  assert.ok(Buffer.byteLength(result.output, "utf8") <= 1024);
  assert.equal(result.meta.originalBytes, 3000);
});
