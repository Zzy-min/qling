import test from "node:test";
import assert from "node:assert/strict";
import {
  layerOf,
  isForbiddenEdge,
  LAYER_RANK,
  scanLayers,
} from "../../scripts/dep-layers.mjs";

test("layerOf classifies key paths", () => {
  assert.equal(layerOf("types.ts"), "foundation");
  assert.equal(layerOf("config.ts"), "foundation");
  assert.equal(layerOf("pipeline/hooks.ts"), "core-services");
  assert.equal(layerOf("lsp/ts-service.ts"), "core-services");
  assert.equal(layerOf("mission/manager.ts"), "domain");
  assert.equal(layerOf("tools/lsp.ts"), "agent-runtime");
  assert.equal(layerOf("agent-loop.ts"), "agent-runtime");
  assert.equal(layerOf("tui/shell.ts"), "presentation");
  assert.equal(layerOf("commands/help.ts"), "cli");
  assert.equal(layerOf("index.ts"), "cli");
  assert.equal(layerOf("eval/tasks.ts"), "adapters");
  assert.equal(layerOf("sdk.ts"), "adapters");
});

test("isForbiddenEdge: lower cannot depend on upper", () => {
  assert.equal(isForbiddenEdge("foundation", "cli"), true);
  assert.equal(isForbiddenEdge("cli", "foundation"), false);
  assert.equal(isForbiddenEdge("domain", "agent-runtime"), true);
  assert.equal(isForbiddenEdge("agent-runtime", "domain"), false);
  assert.equal(isForbiddenEdge("foundation", "foundation"), false);
});

test("LAYER_RANK is total order for known layers", () => {
  assert.ok(LAYER_RANK.foundation < LAYER_RANK["core-services"]);
  assert.ok(LAYER_RANK["core-services"] < LAYER_RANK.domain);
  assert.ok(LAYER_RANK.domain < LAYER_RANK["agent-runtime"]);
  assert.ok(LAYER_RANK["agent-runtime"] < LAYER_RANK.cli);
});

test("scanLayers returns structure", async () => {
  const r = await scanLayers();
  assert.ok(r.fileCount > 50);
  assert.ok(r.layerCounts.foundation >= 1);
  assert.ok(Array.isArray(r.edges));
  assert.ok(typeof r.forbiddenCount === "number");
});

test("agent-loop no longer statically depends on dashboard-server (adapters)", async () => {
  const r = await scanLayers();
  const bad = r.forbidden.filter(
    (edge) => edge.from === "agent-loop.ts" && edge.to === "dashboard-server.ts"
  );
  assert.deepEqual(bad, []);
  assert.equal(layerOf("providers/llm-client.ts"), "foundation");
  assert.equal(layerOf("memory/lifecycle.ts"), "domain");
});
