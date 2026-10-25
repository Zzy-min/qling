import test from "node:test";
import assert from "node:assert/strict";

import { ToolCapabilityRegistry, selectToolsForRequest } from "../../dist/harness/tool-capability.js";

test("tool capability search ranks exact and rare terms above generic descriptions", () => {
  const registry = new ToolCapabilityRegistry([
    { name: "generic_search", description: "Search files and source text", parameters: {}, readOnly: true },
    { name: "impact_analysis", description: "Find callers, tests, and affected files for a code symbol", parameters: {}, readOnly: true },
    { name: "web_search", description: "Search the public web", parameters: {}, readOnly: true },
  ]);
  const results = registry.search("affected tests callers", 3);
  assert.equal(results[0]?.name, "impact_analysis");
});

test("request tool selection keeps the coding core and loads relevant low-frequency tools", () => {
  const definitions = [
    { name: "read", description: "read files", parameters: {}, readOnly: true },
    { name: "repo_map", description: "repository map", parameters: {}, readOnly: true },
    { name: "tool_search", description: "search tools", parameters: {}, readOnly: true },
    { name: "browser_act", description: "automate an interactive browser page", parameters: {} },
    { name: "vision_analyze", description: "analyze a local image", parameters: {}, readOnly: true },
  ];
  const selected = selectToolsForRequest(definitions, "use browser automation", 2).map((tool) => tool.name);
  assert.ok(selected.includes("read"));
  assert.ok(selected.includes("repo_map"));
  assert.ok(selected.includes("tool_search"));
  assert.ok(selected.includes("browser_act"));
  assert.ok(!selected.includes("vision_analyze"));
});
