import assert from "node:assert/strict";
import { buildPromptEnvelope, redactPromptDiagnostics } from "../dist/harness/prompt-envelope.js";

const a = buildPromptEnvelope({ stableSections: [{ id: "base", source: "builtin", content: "safe rules" }], dynamicContext: "run=1" });
const b = buildPromptEnvelope({ stableSections: [{ id: "base", source: "builtin", content: "safe rules" }], dynamicContext: "run=2" });
assert.equal(a.stableHash, b.stableHash);
assert.doesNotMatch(redactPromptDiagnostics("Authorization: Bearer secret-token-value"), /secret-token-value/);
console.log(JSON.stringify({ eval: "context", passed: 2, evidence: { executor: "component", model: "none", verifier: "assertion", claim: "Validates stable-prefix hashing and diagnostic redaction.", limitations: ["Does not measure token reduction or task success after compaction."] }, stableHash: a.stableHash }));
