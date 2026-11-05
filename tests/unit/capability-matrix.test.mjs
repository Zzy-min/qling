import test from "node:test";
import assert from "node:assert/strict";
import { getRuntimeCapabilityMatrix, formatRuntimeCapabilityLines } from "../../dist/runtime/capability-matrix.js";

test("runtime capability matrix makes defaults explicit", () => {
  const rows = getRuntimeCapabilityMatrix({});
  assert.equal(rows[0].label, "runtime=legacy");
  assert.equal(rows.find((row) => row.id === "reliability_v2").label, "reliability_v2=off");
  assert.equal(rows.find((row) => row.id === "workflow_runtime").enabled, false);
});

test("runtime capability matrix reflects enabled guards", () => {
  const rows = getRuntimeCapabilityMatrix({
    QLING_RUNTIME_MODE: "actor",
    QLING_FEATURES_RELIABILITY_V2: "true",
    QLING_FEATURES_WORKFLOW_RUNTIME: "1",
  });
  assert.equal(rows[0].label, "runtime=actor");
  assert.equal(rows.find((row) => row.id === "reliability_v2").enabled, true);
  const lines = formatRuntimeCapabilityLines({
    QLING_FEATURES_RELIABILITY_V2: "true",
  });
  assert.match(lines.join("\n"), /reliability_v2=on/);
  assert.doesNotMatch(lines.join("\n"), /workflow_runtime=off/);
});
