import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPromptEnvelope,
  renderPromptEnvelope,
} from "../../dist/harness/prompt-envelope.js";
import {
  ToolCapabilityRegistry,
  classifyToolInvocation,
} from "../../dist/harness/tool-capability.js";
import {
  EvidenceLedger,
  evaluateOutcomeContract,
} from "../../dist/harness/evidence.js";

test("prompt envelope keeps stable prefix hash independent from dynamic context", () => {
  const first = buildPromptEnvelope({
    stableSections: [{ id: "base", content: "follow project rules", source: "system" }],
    scopedRules: [{ id: "agents", content: "run tests", source: "AGENTS.md", priority: 100 }],
    dynamicContext: "time=10 tokens=10",
    memoryContext: "preference: concise",
    evidenceDigest: "build pending",
  });
  const second = buildPromptEnvelope({
    stableSections: [{ id: "base", content: "follow project rules", source: "system" }],
    scopedRules: [{ id: "agents", content: "run tests", source: "AGENTS.md", priority: 100 }],
    dynamicContext: "time=20 tokens=20",
    memoryContext: "preference: concise",
    evidenceDigest: "build passed",
  });

  assert.equal(first.stableHash, second.stableHash);
  assert.notEqual(renderPromptEnvelope(first), renderPromptEnvelope(second));
  assert.match(renderPromptEnvelope(first), /<stable_prefix sha256=/);
  assert.ok(first.provenance.some((item) => item.source === "AGENTS.md"));
});

test("prompt envelope redacts credential-shaped content from diagnostic rendering", () => {
  const envelope = buildPromptEnvelope({
    stableSections: [{ id: "base", content: "token=sk-abcdefghijklmnop", source: "system" }],
    dynamicContext: "Authorization: Bearer secret-value-123456",
  });
  const rendered = renderPromptEnvelope(envelope, { diagnostics: true });
  assert.doesNotMatch(rendered, /sk-abcdefghijklmnop|secret-value-123456/);
  assert.match(rendered, /\[REDACTED\]/);
});

test("tool capability evaluates bash arguments instead of trusting the tool name", () => {
  const read = classifyToolInvocation({ name: "bash", arguments: { command: "pwd" } });
  const write = classifyToolInvocation({ name: "bash", arguments: { command: "git add src/a.ts" } });
  const external = classifyToolInvocation({ name: "bash", arguments: { command: "git push origin main" } });

  assert.deepEqual({ sideEffect: read.sideEffect, risk: read.risk }, { sideEffect: "none", risk: "low" });
  assert.equal(write.sideEffect, "workspace");
  assert.equal(write.risk, "medium");
  assert.equal(external.sideEffect, "external");
  assert.equal(external.risk, "critical");
  assert.equal(external.permission, "ask");
});

test("git read-looking commands and inherited environment fail closed", () => {
  for (const command of ["git status --short", "git branch -D victim", "git diff --output=owned.txt", "dir \\\\attacker.example\\share", "ls /etc"]) {
    const capability = classifyToolInvocation({ name: "bash", arguments: { command } });
    assert.notEqual(capability.sideEffect, "none");
    assert.equal(capability.permission, "ask");
  }
  const inherited = classifyToolInvocation({ name: "bash", arguments: { command: "pwd", env_allowlist: ["OPTS"] } });
  assert.notEqual(inherited.sideEffect, "none");
});

test("diagnostic redaction handles quoted keys and URI credentials", () => {
  const envelope = buildPromptEnvelope({
    stableSections: [{ id: "base", content: '{"GITHUB_TOKEN":"abcdefghijklmnop"}', source: "system" }],
    dynamicContext: "DATABASE_URL=postgres://user:password@host/db",
  });
  const rendered = renderPromptEnvelope(envelope, { diagnostics: true });
  assert.doesNotMatch(rendered, /abcdefghijklmnop|user:password/);
});

test("tool registry searches available tools and fails closed for unknown metadata", () => {
  const registry = new ToolCapabilityRegistry([
    { name: "read", description: "read local files", parameters: {}, readOnly: true },
    { name: "deploy", description: "deploy to production", parameters: {} },
  ]);
  assert.deepEqual(registry.search("local file").map((item) => item.name), ["read"]);
  const unknown = registry.get("deploy");
  assert.equal(unknown.risk, "high");
  assert.equal(unknown.permission, "ask");
});

test("outcome contract requires fresh passing deterministic evidence", () => {
  const ledger = new EvidenceLedger({ now: () => 10_000 });
  ledger.record({
    claim: "build succeeds",
    source: "command",
    commandOrTool: "npm run build",
    verdict: "pass",
    scope: "workspace",
    observedAt: 9_500,
    deterministic: true,
  });
  const contract = {
    objective: "ship change",
    deliverables: [{ id: "build", claim: "build succeeds", required: true, maxAgeMs: 1_000 }],
    prohibitedSideEffects: ["external"],
    budget: { maxFailures: 4 },
  };
  assert.equal(evaluateOutcomeContract(contract, ledger.list(), { now: 10_000 }).status, "achieved");
  assert.equal(evaluateOutcomeContract(contract, ledger.list(), { now: 11_000 }).status, "active");
});

test("deterministic failure cannot be overridden by an LLM judge pass", () => {
  const evidence = [
    {
      id: "ev-fail",
      claim: "file exists",
      source: "filesystem",
      verdict: "fail",
      scope: "workspace",
      observedAt: 100,
      deterministic: true,
      redacted: false,
    },
    {
      id: "ev-judge",
      claim: "file exists",
      source: "llm_judge",
      verdict: "pass",
      scope: "workspace",
      observedAt: 200,
      deterministic: false,
      redacted: false,
    },
  ];
  const result = evaluateOutcomeContract({
    objective: "create file",
    deliverables: [{ id: "file", claim: "file exists", required: true }],
    prohibitedSideEffects: [],
    budget: {},
  }, evidence, { now: 300 });
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /deterministic evidence failed/i);
});

test("compound shell commands fail closed instead of inheriting a read-only prefix", () => {
  const capability = classifyToolInvocation({ name: "bash", arguments: { command: "git status; echo changed > file.txt" } });
  assert.notEqual(capability.sideEffect, "none");
  assert.equal(capability.permission, "ask");
});

test("environment injection and cmd variable expansion disable the read-only bash fast path", () => {
  const capability = classifyToolInvocation({ name: "bash", arguments: { command: "git status %X%", env_inject: { X: "& del victim" } } });
  assert.notEqual(capability.sideEffect, "none");
  assert.equal(capability.permission, "ask");
});

test("LLM-only evidence requires an explicit deliverable opt-in", () => {
  const evidence = [{ id: "judge", claim: "subjective quality", source: "llm_judge", observedAt: 100, verdict: "pass", scope: "task", deterministic: false, redacted: false }];
  const base = { objective: "quality", prohibitedSideEffects: [], budget: {} };
  assert.equal(evaluateOutcomeContract({ ...base, deliverables: [{ id: "q", claim: "subjective quality", required: true }] }, evidence, { now: 100 }).status, "active");
  assert.equal(evaluateOutcomeContract({ ...base, deliverables: [{ id: "q", claim: "subjective quality", required: true, allowLlmJudge: true }] }, evidence, { now: 100 }).status, "achieved");
});
