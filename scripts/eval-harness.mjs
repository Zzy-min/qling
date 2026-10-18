import assert from "node:assert/strict";
import { classifyToolInvocation } from "../dist/harness/tool-capability.js";
import { evaluateOutcomeContract } from "../dist/harness/evidence.js";

const read = classifyToolInvocation({ name: "bash", arguments: { command: "pwd" } });
const gitRead = classifyToolInvocation({ name: "bash", arguments: { command: "git status --short" } });
const write = classifyToolInvocation({ name: "bash", arguments: { command: "Remove-Item -Recurse target" } });
assert.equal(read.sideEffect, "none");
assert.notEqual(gitRead.sideEffect, "none");
assert.notEqual(write.sideEffect, "none");
const outcome = evaluateOutcomeContract(
  { objective: "build", deliverables: [{ id: "build", claim: "build passes", required: true }], prohibitedSideEffects: [], budget: {} },
  [{ id: "e1", claim: "build passes", source: "command", observedAt: Date.now(), verdict: "pass", scope: "workspace", deterministic: true, redacted: false }]
);
assert.equal(outcome.status, "achieved");
console.log(JSON.stringify({ eval: "harness", passed: 4, evidence: { executor: "component", model: "none", verifier: "assertion", claim: "Validates capability classification and deterministic evidence evaluation.", limitations: ["Does not execute tools or an Agent trajectory."] }, readRisk: read.risk, gitReadRisk: gitRead.risk, writeRisk: write.risk }));
